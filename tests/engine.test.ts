import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/lib/db/index";
import { changes, courses, items, snapshots } from "../src/lib/db/schema";
import { DemoProvider } from "../src/lib/providers/demo";
import type { ItemInput, ProviderResult, ScopeResult, SyncProvider } from "../src/lib/providers/types";
import { getProviderStatus, runSync } from "../src/lib/sync/engine";

const t = (iso: string) => new Date(iso);
const lab = (due: string): ItemInput => ({
  kind: "assignment", externalId: "7", courseRef: "42", title: "Lab 3 report", htmlUrl: "https://x/7",
  dueAt: t(due), fields: { submission_state: "unsubmitted" },
});
const file = (id: string): ItemInput => ({ kind: "file", externalId: id, courseRef: "42", title: `${id}.pdf`, htmlUrl: null, fields: { size: 1 } });
const scope = (key: string, list: ItemInput[], extra: Partial<ScopeResult> = {}): ScopeResult => ({ key, status: "ok", trackRemovals: "all", items: list, ...extra });

/** A provider whose next result (or failure) is set by the test. */
class Fake implements SyncProvider {
  readonly id = "fake";
  readonly label = "Fake";
  next: ProviderResult | Error = { scopes: [] };
  async fetch(): Promise<ProviderResult> {
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}
const course = [{ externalId: "42", name: "Kvantfysik F 1FA535", shortName: "Kvantfysik F", code: "1FA535", term: "HT2026", htmlUrl: null }];

describe("sync engine", () => {
  let db: Db;
  let p: Fake;
  const radar = () => db.select().from(changes).all();
  const live = () => db.select().from(items).all().filter((i) => !i.deletedAt);

  beforeEach(async () => {
    db = createDb(":memory:");
    p = new Fake();
    p.next = { courses: course, scopes: [scope("a", [lab("2026-11-14T22:59:00Z")]), scope("f", [file("f1"), file("f2")])] };
    await runSync(db, p, { now: t("2026-11-10T08:00:00Z") });
  });

  it("stores a silent baseline on first sync", () => {
    expect(live()).toHaveLength(3);
    expect(db.select().from(snapshots).all()).toHaveLength(3);
    expect(db.select().from(courses).all()).toHaveLength(1);
    expect(radar()).toHaveLength(0);
  });

  it("is idempotent: an identical second sync writes nothing new", async () => {
    const r = await runSync(db, p, { now: t("2026-11-10T08:20:00Z") });
    expect(r.status).toBe("ok");
    expect([r.stats.added, r.stats.updated, r.stats.removed]).toEqual([0, 0, 0]);
    expect(db.select().from(snapshots).all()).toHaveLength(3);
    expect(radar()).toHaveLength(0);
  });

  it("records a moved deadline with before/after, keeps history, and triages it", async () => {
    p.next = { courses: course, scopes: [scope("a", [lab("2026-11-18T22:59:00Z")]), scope("f", [file("f1"), file("f2")])] };
    await runSync(db, p, { now: t("2026-11-11T08:00:00Z") });
    const [c] = radar();
    expect(c).toMatchObject({ type: "updated", kind: "assignment", triage: "action", courseId: "fake:42", htmlUrl: "https://x/7" });
    expect(c.diffs).toEqual([{ field: "due_at", before: "2026-11-14T22:59:00.000Z", after: "2026-11-18T22:59:00.000Z" }]);
    expect(db.select().from(snapshots).where(eq(snapshots.itemId, "fake:assignment:7")).all()).toHaveLength(2);
    expect(live().find((i) => i.id === "fake:assignment:7")?.dueAt?.toISOString()).toBe("2026-11-18T22:59:00.000Z");
  });

  it("records added and removed items after the baseline", async () => {
    p.next = { courses: course, scopes: [scope("a", [lab("2026-11-14T22:59:00Z")]), scope("f", [file("f1"), file("f3")])] };
    const r = await runSync(db, p, { now: t("2026-11-11T08:00:00Z") });
    expect([r.stats.added, r.stats.removed]).toEqual([1, 1]);
    expect(radar().map((c) => `${c.type}:${c.title}`).sort()).toEqual(["added:f3.pdf", "removed:f2.pdf"]);
    expect(live().map((i) => i.id).sort()).toEqual(["fake:assignment:7", "fake:file:f1", "fake:file:f3"]);
  });

  it("baselines a scope that appears later without flooding the radar", async () => {
    p.next = { courses: course, scopes: [scope("a", [lab("2026-11-14T22:59:00Z")]), scope("f", [file("f1"), file("f2")]), scope("pages", [file("p1"), file("p2")])] };
    await runSync(db, p, { now: t("2026-11-11T08:00:00Z") });
    expect(radar()).toHaveLength(0);
    expect(live()).toHaveLength(5);
  });

  it("keeps a failed scope's items untouched and reports a partial sync", async () => {
    p.next = { courses: course, scopes: [scope("a", [lab("2026-11-18T22:59:00Z")]), scope("f", [], { status: "error", error: "HTTP 500" })] };
    const r = await runSync(db, p, { now: t("2026-11-11T08:00:00Z") });
    expect(r.status).toBe("partial");
    expect(r.error).toContain("HTTP 500");
    expect(live().filter((i) => i.kind === "file")).toHaveLength(2); // not removed
    expect(radar().map((c) => c.type)).toEqual(["updated"]); // the healthy scope still synced
  });

  it("does not count an unavailable feature as a failure", async () => {
    p.next = { courses: course, scopes: [scope("a", [lab("2026-11-14T22:59:00Z")]), scope("f", [], { status: "unavailable", error: "403" })] };
    const r = await runSync(db, p, { now: t("2026-11-11T08:00:00Z") });
    expect(r.status).toBe("ok");
    expect(live()).toHaveLength(3);
  });

  it("keeps last-good data and reports stale when the provider fails entirely", async () => {
    p.next = new Error("Invalid access token.");
    const r = await runSync(db, p, { now: t("2026-11-11T08:00:00Z") });
    expect(r.status).toBe("error");
    expect(live()).toHaveLength(3);
    const [s] = getProviderStatus(db, ["fake"]);
    expect(s.stale).toBe(true);
    expect(s.lastOkAt?.toISOString()).toBe("2026-11-10T08:00:00.000Z");
    expect(s.lastRun?.error).toBe("Invalid access token.");
  });

  it("does not emit radar entries for scopes marked radar:false, but still stores them", async () => {
    const planner = (title: string) => scope("planner", [{ ...file("p"), title }], { radar: false, trackRemovals: "none" });
    p.next = { scopes: [planner("one")] };
    await runSync(db, p, { now: t("2026-11-11T08:00:00Z") });
    p.next = { scopes: [planner("two")] };
    await runSync(db, p, { now: t("2026-11-11T09:00:00Z") });
    expect(radar()).toHaveLength(0);
    expect(live().find((i) => i.id === "fake:file:p")?.title).toBe("two");
  });

  it("marks courses that disappear as inactive instead of deleting them", async () => {
    p.next = { courses: [], scopes: [] };
    await runSync(db, p, { now: t("2026-11-11T08:00:00Z") });
    expect(db.select().from(courses).all()).toMatchObject([{ id: "fake:42", active: false }]);
  });
});

describe("demo data", () => {
  it("produces the radar entries the demo promises", async () => {
    const db = createDb(":memory:");
    const now = new Date("2026-11-12T09:00:00Z");
    await runSync(db, new DemoProvider(0, now), { now: new Date(now.getTime() - 2 * 86_400_000) });
    const r = await runSync(db, new DemoProvider(1, now), { now });
    expect(r.status).toBe("ok");
    expect([r.stats.added, r.stats.updated, r.stats.removed]).toEqual([7, 5, 0]);
    const rows = db.select().from(changes).all();
    const find = (kind: string, type: string, title: RegExp) => rows.find((c) => c.kind === kind && c.type === type && title.test(c.title));
    expect(find("assignment", "updated", /Lab 3/)?.triage).toBe("action");
    expect(find("assignment", "updated", /Lab 3/)?.diffs.map((d) => d.field)).toEqual(["due_at"]);
    expect(find("announcement", "added", /labbgrupper/)?.triage).toBe("action");
    expect(find("submission_comment", "added", /Lab 2/)?.triage).toBe("action");
    expect(find("appointment_group", "added", /Lab 4/)?.triage).toBe("action");
    expect(find("file", "added", /Övningar_v46/)?.triage).toBe("fyi");
    expect(find("file", "updated", /Kurs-PM/)?.diffs.map((d) => d.field)).toEqual(["modified_at", "size"]);
    expect(find("schedule_event", "updated", /Elektromagnetism/)?.diffs.map((d) => d.field)).toEqual(["location"]);
  });
});
