import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import type { Db } from "../db";
import { changes, courseAliases, courses, items, scopes, snapshots, syncRuns, type SyncStats } from "../db/schema";
import type { ProviderResult, ScopeResult, SyncProvider } from "../providers/types";
import { triage } from "../radar/triage";
import { diffScope, normalize, type Existing, type Normalized } from "./diff";

const COLORS = ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#65a30d", "#c026d3", "#475569"];

export type SyncSummary = {
  runId: number;
  provider: string;
  status: "ok" | "partial" | "error";
  error: string | null;
  stats: SyncStats;
};

/**
 * One provider run.
 *
 * Guarantees:
 * - Idempotent: running twice against unchanged data writes no snapshots and no Radar rows.
 * - Fail-safe: if the provider throws, nothing is modified and last-good data stays in place.
 *   If a single scope fails, only that scope is skipped; its items are neither updated nor removed.
 * - The first successful fetch of a scope is a silent baseline, so connecting an account
 *   does not flood the Radar with hundreds of "new" items.
 */
export async function runSync(db: Db, provider: SyncProvider, opts: { now?: Date } = {}): Promise<SyncSummary> {
  const now = opts.now ?? new Date();
  const stats: SyncStats = { scopesOk: 0, scopesUnavailable: 0, scopesError: 0, items: 0, added: 0, updated: 0, removed: 0 };
  const [run] = db.insert(syncRuns).values({ provider: provider.id, startedAt: now, status: "running" }).returning().all();

  const finish = (status: SyncSummary["status"], error: string | null): SyncSummary => {
    db.update(syncRuns).set({ status, error, stats, finishedAt: opts.now ?? new Date() }).where(eq(syncRuns.id, run.id)).run();
    return { runId: run.id, provider: provider.id, status, error, stats };
  };

  let result: ProviderResult;
  try {
    const knownCourses = db
      .select({ id: courses.id, provider: courses.provider, code: courses.code, name: courses.name, shortName: courses.shortName })
      .from(courses)
      .where(eq(courses.active, true))
      .all();
    const aliases = new Map(db.select().from(courseAliases).all().map((a) => [a.alias, a.courseId]));
    result = await provider.fetch({ now, knownCourses, aliases });
  } catch (err) {
    return finish("error", err instanceof Error ? err.message : String(err));
  }
  stats.requests = result.requests;

  try {
    db.transaction((tx) => {
      if (result.courses) upsertCourses(tx as unknown as Db, provider.id, result.courses, now);
      for (const scope of result.scopes) applyScope(tx as unknown as Db, provider.id, run.id, scope, now, stats);
    });
  } catch (err) {
    return finish("error", `Could not store sync result: ${err instanceof Error ? err.message : String(err)}`);
  }

  const errors = result.scopes.filter((s) => s.status === "error");
  if (errors.length === 0) return finish("ok", null);
  const message = errors.slice(0, 3).map((s) => `${s.key}: ${s.error ?? "error"}`).join("; ") + (errors.length > 3 ? ` (+${errors.length - 3})` : "");
  return finish(stats.scopesOk === 0 ? "error" : "partial", message);
}

function upsertCourses(db: Db, provider: string, list: NonNullable<ProviderResult["courses"]>, now: Date) {
  const used = db.select({ color: courses.color }).from(courses).all().length;
  const ids: string[] = [];
  list.forEach((c, i) => {
    const id = `${provider}:${c.externalId}`;
    ids.push(id);
    const values = { name: c.name, shortName: c.shortName, code: c.code, term: c.term, htmlUrl: c.htmlUrl, active: true, lastSeenAt: now, ...(c.teachers ? { teachers: c.teachers } : {}) };
    db.insert(courses)
      .values({ id, provider, externalId: c.externalId, color: COLORS[(used + i) % COLORS.length], firstSeenAt: now, ...values })
      .onConflictDoUpdate({ target: courses.id, set: values })
      .run();
  });
  // Courses that are no longer returned (term ended, unenrolled) are kept but marked inactive.
  const stale = ids.length ? and(eq(courses.provider, provider), notInArray(courses.id, ids)) : eq(courses.provider, provider);
  db.update(courses).set({ active: false }).where(stale).run();
}

function applyScope(db: Db, provider: string, runId: number, scope: ScopeResult, now: Date, stats: SyncStats) {
  const key = `${provider}|${scope.key}`;
  const prior = db.select().from(scopes).where(eq(scopes.key, key)).get();

  if (scope.status !== "ok") {
    if (scope.status === "error") stats.scopesError++;
    else stats.scopesUnavailable++;
    db.insert(scopes)
      .values({ key, provider, lastStatus: scope.status, lastError: scope.error ?? null })
      .onConflictDoUpdate({ target: scopes.key, set: { lastStatus: scope.status, lastError: scope.error ?? null } })
      .run();
    return; // leave this scope's items exactly as they were
  }

  stats.scopesOk++;
  const baseline = !prior?.baselineAt;
  const emit = !baseline && scope.radar !== false;

  const existingRows = db.select().from(items).where(eq(items.scope, key)).all();
  const existing: Existing[] = existingRows.map((r) => ({
    id: r.id, hash: r.hash, comparable: r.comparable, deletedAt: r.deletedAt, when: r.startAt ?? r.dueAt,
  }));
  const incoming = scope.items.map((i) => normalize(provider, scope.key, i));
  const diff = diffScope(existing, incoming, { trackRemovals: scope.trackRemovals, now });
  stats.items += incoming.length;

  const row = (n: Normalized) => ({
    provider: n.provider, kind: n.kind, externalId: n.externalId, scope: n.scope, courseId: n.courseId, title: n.title,
    htmlUrl: n.htmlUrl, startAt: n.startAt, endAt: n.endAt, dueAt: n.dueAt, allDay: n.allDay, location: n.location,
    bodyText: n.bodyText, fields: n.fields, comparable: n.comparable, raw: n.raw, hash: n.hash,
    lastSeenAt: now, changedAt: now, deletedAt: null,
  });
  const snapshot = (n: Normalized) =>
    db.insert(snapshots).values({ itemId: n.id, syncRunId: runId, capturedAt: now, hash: n.hash, comparable: n.comparable, raw: n.raw }).run();
  const record = (n: { id: string; courseId: string | null; kind: string; title: string; htmlUrl: string | null; comparable: Record<string, unknown> },
                  type: "added" | "updated" | "removed", diffs: { field: string; before: unknown; after: unknown }[]) => {
    if (!emit) return;
    db.insert(changes).values({
      itemId: n.id, courseId: n.courseId, provider, kind: n.kind, type, title: n.title, htmlUrl: n.htmlUrl, diffs,
      triage: triage({ type, kind: n.kind, title: n.title, comparable: n.comparable, diffs, now }),
      detectedAt: now, syncRunId: runId,
    }).run();
  };

  for (const n of diff.created) {
    db.insert(items).values({ id: n.id, firstSeenAt: now, ...row(n) }).onConflictDoUpdate({ target: items.id, set: row(n) }).run();
    snapshot(n);
    record(n, "added", []);
    if (!baseline) stats.added++;
  }
  for (const { item: n, diffs } of diff.updated) {
    db.update(items).set(row(n)).where(eq(items.id, n.id)).run();
    snapshot(n);
    record(n, "updated", diffs);
    stats.updated++;
  }
  // Unchanged content: only refresh bookkeeping (and the raw payload, which may carry fresh URLs).
  // The course link is not part of the content hash, so re-linking never shows up as a "change".
  const priorCourse = new Map(existingRows.map((r) => [r.id, r.courseId]));
  for (const n of diff.unchanged) {
    if (priorCourse.get(n.id) !== n.courseId) db.update(items).set({ courseId: n.courseId }).where(eq(items.id, n.id)).run();
  }
  const unchangedIds = diff.unchanged.map((n) => n.id);
  for (let i = 0; i < unchangedIds.length; i += 500) {
    db.update(items).set({ lastSeenAt: now }).where(inArray(items.id, unchangedIds.slice(i, i + 500))).run();
  }
  if (diff.removed.length) {
    const byId = new Map(existingRows.map((r) => [r.id, r]));
    for (const e of diff.removed) {
      const r = byId.get(e.id)!;
      db.update(items).set({ deletedAt: now, changedAt: now }).where(eq(items.id, e.id)).run();
      record(r, "removed", []);
      stats.removed++;
    }
  }

  const state = { lastStatus: "ok" as const, lastError: null, lastOkAt: now, itemCount: incoming.length, baselineAt: prior?.baselineAt ?? now };
  db.insert(scopes).values({ key, provider, ...state }).onConflictDoUpdate({ target: scopes.key, set: state }).run();
}

export type ProviderStatus = {
  provider: string;
  lastRun: typeof syncRuns.$inferSelect | null;
  lastOkAt: Date | null;
  /** true when the most recent attempt did not fully succeed: views are showing older data. */
  stale: boolean;
};

export function getProviderStatus(db: Db, providerIds: string[]): ProviderStatus[] {
  return providerIds.map((provider) => {
    const runs = db.select().from(syncRuns).where(eq(syncRuns.provider, provider)).orderBy(desc(syncRuns.id)).limit(50).all();
    const finished = runs.filter((r) => r.status !== "running");
    const lastRun = finished[0] ?? null;
    const lastOk = finished.find((r) => r.status === "ok") ?? null;
    return { provider, lastRun, lastOkAt: lastOk?.finishedAt ?? null, stale: lastRun !== null && lastRun.status !== "ok" };
  });
}
