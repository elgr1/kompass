import { createHash } from "node:crypto";
import type { FieldDiff } from "../db/schema";
import type { ItemInput, ScopeResult } from "../providers/types";
import { stableStringify } from "../text";

/** Pure diff logic: no database, no network. Everything here is unit-tested. */

export type Normalized = {
  id: string;
  provider: string;
  kind: string;
  externalId: string;
  scope: string;
  courseId: string | null;
  title: string;
  htmlUrl: string | null;
  startAt: Date | null;
  endAt: Date | null;
  dueAt: Date | null;
  allDay: boolean;
  location: string | null;
  bodyText: string | null;
  fields: Record<string, unknown>;
  comparable: Record<string, unknown>;
  raw: unknown;
  hash: string;
};

export type Existing = {
  id: string;
  hash: string;
  comparable: Record<string, unknown>;
  deletedAt: Date | null;
  /** start or due time, used by the "future" removal rule */
  when: Date | null;
};

const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * The flat record that defines "the content" of an item. Two fetches with an equal
 * comparable are the same version; any difference becomes a Radar diff.
 * Empty values are dropped so that `null` vs missing never counts as a change.
 */
export function buildComparable(input: ItemInput): Record<string, unknown> {
  const c: Record<string, unknown> = {
    ...(input.fields ?? {}),
    title: input.title,
    start_at: input.startAt?.toISOString(),
    end_at: input.endAt?.toISOString(),
    due_at: input.dueAt?.toISOString(),
    all_day: input.allDay ? true : undefined,
    location: input.location,
    body: input.bodyText,
  };
  for (const k of Object.keys(c)) if (empty(c[k]) || c[k] === false) delete c[k];
  return c;
}

export const hashComparable = (c: Record<string, unknown>) =>
  createHash("sha256").update(stableStringify(c)).digest("hex");

export function normalize(provider: string, scopeKey: string, input: ItemInput): Normalized {
  const comparable = buildComparable(input);
  const ref = input.courseRef ?? null;
  return {
    id: `${provider}:${input.kind}:${input.externalId}`,
    provider,
    kind: input.kind,
    externalId: input.externalId,
    scope: `${provider}|${scopeKey}`,
    courseId: ref === null ? null : ref.includes(":") ? ref : `${provider}:${ref}`,
    title: input.title,
    htmlUrl: input.htmlUrl ?? null,
    startAt: input.startAt ?? null,
    endAt: input.endAt ?? null,
    dueAt: input.dueAt ?? null,
    allDay: Boolean(input.allDay),
    location: input.location ?? null,
    bodyText: input.bodyText ?? null,
    fields: input.fields ?? {},
    comparable,
    raw: input.raw ?? null,
    hash: hashComparable(comparable),
  };
}

export function diffComparable(before: Record<string, unknown>, after: Record<string, unknown>): FieldDiff[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const out: FieldDiff[] = [];
  for (const field of keys) {
    const b = before[field] ?? null;
    const a = after[field] ?? null;
    if (stableStringify(b) !== stableStringify(a)) out.push({ field, before: b, after: a });
  }
  return out;
}

export type ScopeDiff = {
  /** New items, and items that had been removed and came back. */
  created: Normalized[];
  updated: { item: Normalized; diffs: FieldDiff[] }[];
  unchanged: Normalized[];
  removed: Existing[];
};

export function diffScope(
  existing: Existing[],
  incoming: Normalized[],
  opts: { trackRemovals: ScopeResult["trackRemovals"]; now: Date },
): ScopeDiff {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const seen = new Map<string, Normalized>();
  for (const item of incoming) seen.set(item.id, item); // a duplicate id in one fetch: last one wins

  const out: ScopeDiff = { created: [], updated: [], unchanged: [], removed: [] };
  for (const item of seen.values()) {
    const prev = byId.get(item.id);
    if (!prev || prev.deletedAt) out.created.push(item);
    else if (prev.hash === item.hash) out.unchanged.push(item);
    else out.updated.push({ item, diffs: diffComparable(prev.comparable, item.comparable) });
  }

  if (opts.trackRemovals !== "none") {
    for (const prev of existing) {
      if (prev.deletedAt || seen.has(prev.id)) continue;
      if (opts.trackRemovals === "future" && !(prev.when && prev.when.getTime() > opts.now.getTime())) continue;
      out.removed.push(prev);
    }
  }
  return out;
}
