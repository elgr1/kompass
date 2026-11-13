import { describe, expect, it } from "vitest";
import { createDb } from "../src/lib/db/index";
import { courses, items, timeEntries } from "../src/lib/db/schema";
import { createFromTemplate } from "../src/lib/notes/store";
import { courseHealth, estimateAccuracy, minutesByWeek, reviewStreak } from "../src/lib/stats/logic";
import { acknowledgeFeedback, buildRetrospective, currentStreak, getFeedback, healthByCourse, weeklyTime } from "../src/lib/stats/store";

describe("analytics", () => {
  it("sums time per week and course", () => {
    const w = minutesByWeek([{ key: "c1", monday: "2026-11-09", minutes: 60 }, { key: "c1", monday: "2026-11-09", minutes: 30 }, { key: "", monday: "2026-11-09", minutes: 15 }, { key: "c2", monday: "2026-11-02", minutes: 45 }], ["2026-11-02", "2026-11-09", "2026-11-16"]);
    expect(w.map((x) => x.total)).toEqual([45, 105, 0]);
    expect(w[1].byKey.get("c1")).toBe(90);
  });

  it("reports how good the estimates were", () => {
    const a = estimateAccuracy([
      { title: "Lab 1", estimateMin: 360, actualMin: 540 }, { title: "Inl 1", estimateMin: 300, actualMin: 300 }, { title: "Inl 2", estimateMin: 300, actualMin: 330 },
      { title: "Quiz", estimateMin: 60, actualMin: 15 }, { title: "Ignored", estimateMin: 60, actualMin: 3 },
    ]);
    expect(a).toMatchObject({ n: 4, medianRatio: 1.05, within25: 50 });
    expect(a.worst.map((w) => w.title).slice(0, 2)).toEqual(["Quiz", "Lab 1"]); // furthest off first, in either direction
    expect(estimateAccuracy([])).toEqual({ n: 0, medianRatio: null, within25: null, worst: [] });
  });

  it("counts the weekly-review streak, forgiving a week that is still in progress", () => {
    const weeks = new Set(["2026-10-26", "2026-11-02", "2026-11-09"]);
    expect(reviewStreak(weeks, "2026-11-09")).toBe(3);
    expect(reviewStreak(weeks, "2026-11-16")).toBe(3); // this week's not done yet: streak still alive
    expect(reviewStreak(weeks, "2026-11-23")).toBe(0); // a whole week was skipped
    expect(reviewStreak(new Set(["2026-10-26", "2026-11-09"]), "2026-11-09")).toBe(1);
  });

  it("scores course health, weighting missed hand-ins most", () => {
    expect(courseHealth({ missing: 0, unstartedSoon: 0, unreadAction: 0, newFeedback: 0 })).toEqual({ score: 100, level: "ok", reasons: [] });
    expect(courseHealth({ missing: 0, unstartedSoon: 1, unreadAction: 0, newFeedback: 1 })).toMatchObject({ score: 80, level: "ok" });
    expect(courseHealth({ missing: 1, unstartedSoon: 0, unreadAction: 1, newFeedback: 0 })).toMatchObject({ score: 60, level: "watch", reasons: [{ reason: "missing", n: 1 }, { reason: "radar", n: 1 }] });
    expect(courseHealth({ missing: 2, unstartedSoon: 2, unreadAction: 5, newFeedback: 9 })).toMatchObject({ score: 0, level: "behind" });
  });
});

describe("analytics on stored data", () => {
  const now = new Date("2026-11-13T09:00:00Z");
  function seed() {
    const db = createDb(":memory:");
    db.insert(courses).values({ id: "canvas:1", provider: "canvas", externalId: "1", name: "Reglerteknik I", shortName: "Reglerteknik I", color: "#000", firstSeenAt: now, lastSeenAt: now }).run();
    const item = (id: string, kind: string, title: string, fields: Record<string, unknown>, dueAt: Date | null = null, bodyText = "") =>
      db.insert(items).values({ id, provider: "canvas", kind, externalId: id, scope: "s", courseId: "canvas:1", title, htmlUrl: null, dueAt, bodyText, fields, comparable: {}, hash: "h", firstSeenAt: now, lastSeenAt: now, changedAt: now }).run();
    item("a1", "assignment", "Inl 1", { submission_state: "graded", grade: "G" }, new Date("2026-11-05T22:59:00Z"));
    item("a2", "assignment", "Inl 2", { submission_state: "unsubmitted", missing: true }, new Date("2026-11-10T22:59:00Z"));
    item("a3", "assignment", "Inl 3", { submission_state: "unsubmitted" }, new Date("2026-11-17T22:59:00Z"));
    item("c1", "submission_comment", "Inl 1", { author: "Lärare", created_at: "2026-11-08T10:00:00Z" }, null, "Bra jobbat.");
    const log = (workKey: string, start: string, minutes: number) => db.insert(timeEntries).values({ workKey, title: "x", courseId: "canvas:1", workType: "problem_set", startedAt: new Date(start), endedAt: new Date(new Date(start).getTime() + minutes * 60_000) }).run();
    log("a1", "2026-11-03T10:00:00Z", 450);
    log("a3", "2026-11-12T10:00:00Z", 30);
    return db;
  }

  it("computes weekly time, health and feedback from the database", () => {
    const db = seed();
    expect(weeklyTime(db, now, 2).map((w) => [w.monday, w.total])).toEqual([["2026-11-02", 450], ["2026-11-09", 30]]);
    // one missed hand-in (-30) and one unacknowledged comment (-5); Inl 3 is due soon but already started
    expect(healthByCourse(db, now).get("canvas:1")).toMatchObject({ score: 65, level: "watch", reasons: [{ reason: "missing", n: 1 }, { reason: "feedback", n: 1 }] });
    expect(getFeedback(db).map((f) => [f.title, f.acknowledged])).toEqual([["Inl 1", false]]);
    acknowledgeFeedback(db, "c1");
    expect(getFeedback(db)[0].acknowledged).toBe(true);
    expect(healthByCourse(db, now).get("canvas:1")?.score).toBe(70);
  });

  it("writes a period retrospective with real numbers and tracks the review streak", () => {
    const db = seed();
    expect(currentStreak(db, now)).toBe(0);
    createFromTemplate(db, "weekly_review", "sv", {}, now);
    expect(currentStreak(db, now)).toBe(1);
    const r = buildRetrospective(db, "2026-11-01", "2026-11-13", "sv", now);
    expect(r.title).toBe("Periodsammanfattning 1 nov – 13 nov 2026");
    expect(r.content).toContain("Totalt loggat: **8 h**");
    expect(r.content).toContain("| Reglerteknik I | 8 |");
    expect(r.content).toContain("Inlämnade eller rättade: **1** av 2");
    expect(r.content).toContain("Saknas: **1**");
    expect(r.content).toContain("medianen **1.5×** estimatet"); // 450 min against the 300-min default
    expect(r.content).toContain("Veckogenomgångar gjorda: **1**");
    expect(buildRetrospective(db, "2026-11-01", "2026-11-13", "en", now).content).toContain("Total logged: **8 h**");
  });
});
