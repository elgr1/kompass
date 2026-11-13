import { describe, expect, it } from "vitest";
import { guessType, learnMultipliers, multiplierFor } from "../src/lib/plan/estimate";
import { buildExamSessions } from "../src/lib/plan/exam";
import { pickNext, type Candidate } from "../src/lib/plan/next";
import { atMinutes, capacityMin, DEFAULT_SETTINGS, freeSlots, placeSessions, proposeBlocks, type Interval, type SchedItem } from "../src/lib/plan/schedule";
import { spreadByDay, weekLoads } from "../src/lib/plan/workload";
import { fmtTime, dateKey } from "../src/lib/time";

const S = DEFAULT_SETTINGS; // 08–18, lunch 12–13, Mon–Fri, max 300 min/day, 90-min blocks, 15-min gaps
const at = (day: string, hhmm: string): Date => {
  const [h, m] = hhmm.split(":").map(Number);
  return atMinutes(day, h * 60 + m);
};
const iv = (day: string, a: string, b: string): Interval => ({ start: at(day, a), end: at(day, b) });
const show = (xs: Interval[]) => xs.map((x) => `${fmtTime(x.start)}-${fmtTime(x.end)}`);
const MON = "2026-11-16";

describe("estimates", () => {
  it("guesses the kind of work from Swedish and English titles", () => {
    expect(guessType("Lab 3: rapport (Franck–Hertz)", "assignment")).toBe("lab_report");
    expect(guessType("Pre-lab 1: Diffraction", "assignment")).toBe("prelab");
    expect(guessType("Inlämningsuppgift 1", "assignment")).toBe("problem_set");
    expect(guessType("Project", "assignment")).toBe("project");
    expect(guessType("Dugga 2: Väteatomen", "assignment")).toBe("quiz");
    expect(guessType("Seminar 2", "assignment")).toBe("assignment");
    expect(guessType("Läs kapitel 4", "task")).toBe("reading");
    expect(guessType("Anmäl labbgrupp", "signup")).toBe("admin");
    expect(guessType("Köp labbrock", "task")).toBe("other");
  });

  it("learns personal multipliers from finished work, per course first, then per type", () => {
    const s = (courseId: string, type: "lab_report" | "reading", est: number, act: number) => ({ courseId, type, estimateMin: est, actualMin: act });
    const m = learnMultipliers([s("c1", "lab_report", 360, 540), s("c1", "lab_report", 360, 468), s("c2", "lab_report", 360, 360), s("c1", "reading", 120, 60)]);
    expect(multiplierFor(m, "c1", "lab_report")).toBe(1.4); // median of 1.5 and 1.3
    expect(multiplierFor(m, "c2", "lab_report")).toBe(1.3); // one sample for c2: fall back to the type (1.5, 1.3, 1.0)
    expect(multiplierFor(m, "c1", "reading")).toBe(1); // a single sample proves nothing
    expect(multiplierFor(m, null, "project")).toBe(1);
  });

  it("clamps wild ratios and ignores trivial logs", () => {
    const m = learnMultipliers([
      { courseId: "c", type: "quiz", estimateMin: 60, actualMin: 600 }, { courseId: "c", type: "quiz", estimateMin: 60, actualMin: 480 },
      { courseId: "c", type: "quiz", estimateMin: 60, actualMin: 5 },
    ]);
    expect(multiplierFor(m, "c", "quiz")).toBe(3);
  });
});

describe("free slots", () => {
  it("is the study window minus lunch on an empty weekday, and nothing on a non-study day", () => {
    expect(show(freeSlots(MON, S, []))).toEqual(["08:00-12:00", "13:00-18:00"]);
    expect(freeSlots("2026-11-21", S, [])).toEqual([]); // Saturday
  });

  it("carves out classes with a gap either side and drops slivers", () => {
    expect(show(freeSlots(MON, S, [iv(MON, "10:15", "12:00"), iv(MON, "13:15", "15:00")]))).toEqual(["08:00-10:00", "15:15-18:00"]);
    expect(show(freeSlots(MON, S, [iv(MON, "08:15", "10:00"), iv(MON, "10:15", "12:00")]))).toEqual(["13:00-18:00"]);
  });

  it("respects 'not before' and caps daily capacity", () => {
    expect(show(freeSlots(MON, S, [], at(MON, "14:30")))).toEqual(["14:30-18:00"]);
    expect(capacityMin(MON, S, [])).toBe(300); // 9 free hours, but at most 5 h of study
    expect(capacityMin(MON, S, [iv(MON, "08:00", "16:00")])).toBe(105);
    expect(capacityMin(MON, S, [], 240)).toBe(60);
  });

  it("keeps wall-clock times across the DST change", () => {
    expect(show(freeSlots("2026-10-26", S, []))).toEqual(["08:00-12:00", "13:00-18:00"]); // Monday after clocks went back
    expect(at("2026-10-23", "08:00").toISOString()).toBe("2026-10-23T06:00:00.000Z");
    expect(at("2026-10-26", "08:00").toISOString()).toBe("2026-10-26T07:00:00.000Z");
  });
});

describe("auto time-blocking", () => {
  const item = (key: string, min: number, due: string | null): SchedItem => ({ key, title: key, courseId: null, remainingMin: min, dueAt: due ? new Date(due) : null });
  const now = at(MON, "07:00");
  const plan = (items: SchedItem[], busy: Interval[] = [], days = [MON, "2026-11-17", "2026-11-18"]) => proposeBlocks({ now, days, settings: S, busy, items });
  const fmt = (r: ReturnType<typeof plan>) => r.blocks.map((b) => `${dateKey(b.start).slice(8)} ${fmtTime(b.start)}-${fmtTime(b.end)} ${b.workKey}`);

  it("gives the earliest deadline the first blocks, with gaps, in 90-minute pieces", () => {
    const r = plan([item("later", 120, "2026-11-20T16:00:00Z"), item("urgent", 150, "2026-11-17T16:00:00Z")]);
    expect(fmt(r)).toEqual(["16 08:00-09:30 urgent", "16 09:45-10:45 urgent", "16 11:00-12:00 later", "16 13:00-14:00 later"]);
    expect(r.unplaced).toEqual([]);
  });

  it("works around classes and stops at the daily cap", () => {
    const r = plan([item("big", 600, "2026-11-25T16:00:00Z")], [iv(MON, "08:15", "12:00")], [MON]);
    expect(fmt(r)).toEqual(["16 13:00-14:30 big", "16 14:45-16:15 big", "16 16:30-18:00 big"]);
    const capped = plan([item("big", 600, "2026-11-25T16:00:00Z")], [], [MON]);
    expect(capped.blocks.reduce((n, b) => n + (b.end.getTime() - b.start.getTime()) / 60_000, 0)).toBe(300);
    expect(capped.unplaced).toEqual([{ key: "big", title: "big", minutes: 300, dueAt: new Date("2026-11-25T16:00:00Z") }]);
  });

  it("never plans work after its deadline and reports what did not fit", () => {
    const r = plan([item("tight", 240, at(MON, "10:00").toISOString())], [], [MON, "2026-11-17"]);
    expect(fmt(r)).toEqual(["16 08:00-09:30 tight"]); // the 15 minutes left before 10:00 are too short to be worth a block
    expect(r.unplaced[0].minutes).toBe(150);
  });

  it("does not start in the past, counts already accepted blocks, and skips finished items", () => {
    const late = proposeBlocks({ now: at(MON, "15:52"), days: [MON], settings: S, busy: [], items: [item("a", 60, null)] });
    expect(fmt(late)).toEqual(["16 16:15-17:15 a"]);
    const used = proposeBlocks({ now, days: [MON], settings: S, busy: [], items: [item("a", 600, null)], planned: new Map([[MON, 240]]) });
    expect(fmt(used)).toEqual(["16 08:00-09:00 a"]);
    expect(plan([item("done", 0, null), item("tiny", 10, null)]).blocks).toEqual([]);
  });
});

describe("workload heatmap", () => {
  it("spreads remaining effort over the lead-up to the deadline", () => {
    const perDay = spreadByDay([{ key: "a", courseId: "c1", remainingMin: 300, dueAt: at("2026-11-20", "17:00"), leadDays: 5 }], MON);
    expect([...perDay.keys()]).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
    expect(perDay.get("2026-11-18")?.get("c1")).toBe(60);
  });

  it("squeezes late work into the days that are left, and overdue work into today", () => {
    const perDay = spreadByDay([
      { key: "a", courseId: "c1", remainingMin: 300, dueAt: at("2026-11-17", "17:00"), leadDays: 7 },
      { key: "b", courseId: "c2", remainingMin: 60, dueAt: at("2026-11-10", "17:00"), leadDays: 3 },
    ], MON);
    expect(perDay.get(MON)?.get("c1")).toBe(150);
    expect(perDay.get(MON)?.get("c2")).toBe(60);
    expect(perDay.size).toBe(2);
  });

  it("flags a crunch week when planned work exceeds 85% of free study time", () => {
    const perDay = spreadByDay([
      { key: "a", courseId: "c1", remainingMin: 1200, dueAt: at("2026-11-20", "17:00"), leadDays: 5 },
      { key: "b", courseId: "c2", remainingMin: 300, dueAt: at("2026-11-27", "17:00"), leadDays: 5 },
    ], MON);
    const capacity = new Map<string, number>();
    for (const d of ["16", "17", "18", "19", "20", "23", "24", "25", "26", "27"]) capacity.set(`2026-11-${d}`, 240);
    const [w47, w48] = weekLoads({ mondays: [MON, "2026-11-23"], perDay, classMin: new Map([[MON, 210]]), capacity });
    expect(w47).toMatchObject({ studyMin: 1200, classMin: 210, capacityMin: 1200, crunch: true });
    expect(w48).toMatchObject({ studyMin: 300, crunch: false });
    expect(w47.byCourse.get("c1")).toBe(1200);
  });
});

describe("exam backwards-planning", () => {
  const labels = { review: "Repetera", oldExam: "Gammal tenta", repeat: "Snabbrepetition", buffer: "Buffert" };
  const build = (topics: string[], oldExams: number, bufferDays = 2, today = "2026-11-16", examDay = "2026-11-30") =>
    buildExamSessions({ today, examDay, topics, oldExams, bufferDays, labels });

  it("reviews every topic, then old exams with spaced repeats, and keeps the last days light", () => {
    const { sessions, warnings } = build(["Lagrange", "Stela kroppar", "Svängningar", "Hamilton"], 2);
    expect(warnings).toEqual([]);
    expect(sessions.map((s) => s.title)).toEqual([
      "Repetera: Lagrange", "Repetera: Stela kroppar", "Repetera: Svängningar", "Repetera: Hamilton",
      "Gammal tenta 1", "Snabbrepetition: Lagrange", "Snabbrepetition: Stela kroppar",
      "Gammal tenta 2", "Snabbrepetition: Svängningar", "Snabbrepetition: Hamilton",
      "Buffert", "Buffert",
    ]);
    const days = sessions.map((s) => s.day);
    expect(days).toEqual([...days].sort()); // in order, never after the exam
    expect(days.at(-1)).toBe("2026-11-29");
    expect(days.slice(-2)).toEqual(["2026-11-28", "2026-11-29"]);
    expect(sessions.filter((s) => s.kind !== "buffer").every((s) => s.day <= "2026-11-27")).toBe(true);
    // spaced: each topic's repeat comes days after its first pass
    const first = sessions.find((s) => s.title === "Repetera: Lagrange")!.day;
    const again = sessions.find((s) => s.title === "Snabbrepetition: Lagrange")!.day;
    expect(Date.parse(again) - Date.parse(first)).toBeGreaterThanOrEqual(3 * 86_400_000);
    expect(new Set(days.slice(0, 10)).size).toBeGreaterThanOrEqual(8); // spread out, not piled up
  });

  it("warns when the plan is tight or the exam is today", () => {
    expect(build(["a", "b", "c", "d", "e", "f"], 4, 1, "2026-11-27").warnings).toEqual(["tight"]);
    expect(build(["a"], 1, 2, "2026-11-30")).toEqual({ sessions: [], warnings: ["too_late"] });
    expect(build([], 0).sessions.map((s) => s.kind)).toEqual(["buffer", "buffer"]);
  });

  it("places sessions in free time on their day and spills to the next when full", () => {
    const sessions = [{ day: MON, title: "Gammal tenta 1", minutes: 240 }, { day: MON, title: "Repetera: A", minutes: 120 }, { day: MON, title: "Repetera: B", minutes: 120 }];
    const r = placeSessions({ sessions, settings: S, busy: [iv(MON, "13:15", "17:00")], now: at(MON, "07:00"), lastDay: "2026-11-18" });
    expect(r.placed.map((p) => `${dateKey(p.start).slice(8)} ${fmtTime(p.start)}-${fmtTime(p.end)} ${p.title}`)).toEqual([
      "16 08:00-12:00 Gammal tenta 1",
      "16 17:15-18:00 Repetera: A", // what is left of Monday after the lab...
      "17 08:00-09:15 Repetera: A", // ...and the rest the next morning
      "17 09:30-11:30 Repetera: B",
    ]);
    expect(r.unplaced).toEqual([]);
    const full = placeSessions({ sessions, settings: S, busy: [iv(MON, "08:00", "18:00")], now: at(MON, "07:00"), lastDay: MON });
    expect(full.placed).toEqual([]);
    expect(full.unplaced.map((u) => u.minutes)).toEqual([240, 120, 120]);
  });
});

describe("what should I do now", () => {
  const now = new Date("2026-11-16T08:00:00Z");
  const c = (key: string, type: Candidate["type"], min: number, dueInHours: number | null): Candidate =>
    ({ key, title: key, courseId: null, type, remainingMin: min, dueAt: dueInHours === null ? null : new Date(now.getTime() + dueInHours * 3_600_000) });
  const list = [c("report", "lab_report", 300, 30), c("reading", "reading", 60, 200), c("signup", "admin", 10, 50), c("someday", "other", 30, null)];
  const top = (availableMin: number, energy: "low" | "medium" | "high") => pickNext(list, { now, availableMin, energy })[0];

  it("picks the most urgent demanding work when there is time and energy", () => {
    expect(top(120, "high")).toMatchObject({ candidate: { key: "report" }, minutes: 120, reasons: ["due_soon", "needs_focus"] });
  });

  it("picks a quick win when tired or short on time", () => {
    expect(top(15, "low")).toMatchObject({ candidate: { key: "signup" }, reasons: ["due_soon", "quick_win", "easy"] });
    expect(top(20, "medium").candidate.key).toBe("signup");
  });

  it("puts overdue work first and drops finished items", () => {
    const r = pickNext([...list, c("late", "problem_set", 90, -5), c("done", "reading", 0, 1)], { now, availableMin: 90, energy: "medium" });
    expect(r[0]).toMatchObject({ candidate: { key: "late" }, reasons: ["overdue", "fits"] });
    expect(r.map((x) => x.candidate.key)).not.toContain("done");
  });
});
