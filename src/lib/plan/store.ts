import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import type { Db } from "../db";
import { blocks, examPlans, items, timeEntries, workMeta, type Block } from "../db/schema";
import { getCourses, getDeadlines, getEvents, type AgendaEvent, type CourseLite } from "../queries";
import { projectLoadByDay } from "../projects/store";
import { getSetting, setSetting } from "../settings";
import { getOpenTasks } from "../tasks";
import { addDays, dateKey, startOfDay } from "../time";
import { DEFAULT_MIN, guessType, isWorkType, learnMultipliers, LEAD_DAYS, multiplierFor, type Multipliers, type Sample, type WorkType } from "./estimate";
import { buildExamSessions, type ExamLabels } from "./exam";
import { capacityMin, DEFAULT_SETTINGS, placeSessions, proposeBlocks, todayAndNext, type Interval, type PlanSettings } from "./schedule";
import { spreadByDay, upcomingMondays, weekLoads, type WeekLoad } from "./workload";

/** Database side of planning: gathers inputs for the pure functions in this folder and stores their results. */

const MIN = 60_000;

export function getPlanSettings(db: Db): PlanSettings {
  try {
    const saved = JSON.parse(getSetting(db, "plan") ?? "{}") as Partial<PlanSettings>;
    return { ...DEFAULT_SETTINGS, ...saved, days: Array.isArray(saved.days) && saved.days.length ? saved.days : DEFAULT_SETTINGS.days };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
export const savePlanSettings = (db: Db, s: PlanSettings) => setSetting(db, "plan", JSON.stringify(s));

/** Minutes logged per work key, including a timer that is still running. */
export function loggedByKey(db: Db, now: Date): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of db.select().from(timeEntries).all()) {
    if (!e.workKey) continue;
    out.set(e.workKey, (out.get(e.workKey) ?? 0) + Math.max(0, ((e.endedAt ?? now).getTime() - e.startedAt.getTime()) / MIN));
  }
  return out;
}

export const runningTimer = (db: Db) => db.select().from(timeEntries).where(isNull(timeEntries.endedAt)).get() ?? null;

export type WorkItem = {
  key: string;
  title: string;
  kind: string;
  course: CourseLite | null;
  dueAt: Date | null;
  hasTime: boolean;
  url: string | null;
  type: WorkType;
  /** estimate before the personal multiplier; `own` = I set it myself */
  estimateMin: number;
  own: boolean;
  factor: number;
  /** estimate x multiplier */
  plannedMin: number;
  loggedMin: number;
  remainingMin: number;
};

function metaMap(db: Db) {
  return new Map(db.select().from(workMeta).all().map((m) => [m.key, m]));
}

function describe(key: string, title: string, kind: string, courseId: string | null, meta: ReturnType<typeof metaMap>, mult: Multipliers) {
  const m = meta.get(key);
  const type = isWorkType(m?.workType) ? m.workType : guessType(title, kind);
  const estimateMin = m?.estimateMin ?? DEFAULT_MIN[type];
  // My own estimate is taken as is; only default guesses are corrected by what I have learned.
  const factor = m?.estimateMin ? 1 : multiplierFor(mult, courseId, type);
  return { type, estimateMin, own: Boolean(m?.estimateMin), factor, plannedMin: Math.round(estimateMin * factor) };
}

/** What I have learned about my own pace, from finished work that has time logged against it. */
export function getMultipliers(db: Db, now: Date): Multipliers {
  const meta = metaMap(db);
  const logged = loggedByKey(db, now);
  const none: Multipliers = { byCourseType: new Map(), byType: new Map() };
  const samples: Sample[] = getDeadlines(db, new Date(now.getTime() - 400 * 86_400_000), new Date(now.getTime() + 90 * 86_400_000), now)
    .filter((d) => d.state === "submitted" || d.state === "graded")
    .flatMap((d) => {
      const actualMin = logged.get(d.id) ?? 0;
      if (actualMin < 10) return [];
      const e = describe(d.id, d.title, d.kind, d.course?.id ?? null, meta, none);
      return [{ courseId: d.course?.id ?? null, type: e.type, estimateMin: e.estimateMin, actualMin }];
    });
  return learnMultipliers(samples);
}

/** Everything still to do: unsubmitted Studium deadlines and my open tasks, with estimate and time left. */
export function collectWork(db: Db, now: Date): WorkItem[] {
  const meta = metaMap(db);
  const mult = getMultipliers(db, now);
  const logged = loggedByKey(db, now);
  const cs = getCourses(db);
  const finish = (key: string, title: string, kind: string, course: CourseLite | null, dueAt: Date | null, hasTime: boolean, url: string | null): WorkItem => {
    const e = describe(key, title, kind, course?.id ?? null, meta, mult);
    const loggedMin = Math.round(logged.get(key) ?? 0);
    return { key, title, kind, course, dueAt, hasTime, url, ...e, loggedMin, remainingMin: Math.max(0, e.plannedMin - loggedMin) };
  };
  const dated = getDeadlines(db, new Date(now.getTime() - 21 * 86_400_000), new Date(now.getTime() + 120 * 86_400_000), now)
    .filter((d) => d.state === "open" || d.state === "missing")
    .map((d) => finish(d.id, d.title, d.kind, d.course, d.dueAt, d.hasTime, d.htmlUrl));
  const undated = getOpenTasks(db)
    .filter((t) => !t.dueAt && !(t.courseId && cs.get(t.courseId)?.hidden))
    .map((t) => finish(`task:${t.id}`, t.title, t.kind, t.courseId ? cs.get(t.courseId) ?? null : null, null, false, t.sourceUrl));
  return [...dated, ...undated];
}

export const getBlocks = (db: Db, from: Date, to: Date) =>
  db.select().from(blocks).where(and(gte(blocks.startAt, from), lt(blocks.startAt, to))).orderBy(blocks.startAt).all();

/** Times I cannot study: classes and calendar events, plus (optionally) blocks already in the plan. */
export function getBusy(db: Db, from: Date, to: Date, include: { study: boolean; proposed?: (b: Block) => boolean }): { busy: Interval[]; classMin: Map<string, number>; studyMin: Map<string, number> } {
  const busy: Interval[] = [];
  const classMin = new Map<string, number>();
  const studyMin = new Map<string, number>();
  for (const e of getEvents(db, from, to)) {
    if (e.allDay) continue;
    const end = e.endAt ?? new Date(e.startAt.getTime() + 60 * MIN);
    busy.push({ start: e.startAt, end });
    const d = dateKey(e.startAt);
    classMin.set(d, (classMin.get(d) ?? 0) + (end.getTime() - e.startAt.getTime()) / MIN);
  }
  for (const b of getBlocks(db, from, to)) {
    // Proposals only block time when the caller says so (to keep two kinds of proposal from colliding).
    if (b.status !== "accepted" && !include.proposed?.(b)) continue;
    if (b.kind === "study") {
      const d = dateKey(b.startAt);
      studyMin.set(d, (studyMin.get(d) ?? 0) + (b.endAt.getTime() - b.startAt.getTime()) / MIN);
      if (!include.study) continue;
    }
    busy.push({ start: b.startAt, end: b.endAt });
  }
  return { busy, classMin, studyMin };
}

/** Replaces the current auto-proposals with a fresh plan for the coming days. Accepted blocks are never touched. */
export function generateProposals(db: Db, now: Date, horizonDays = 7): { created: number; unplaced: ReturnType<typeof proposeBlocks>["unplaced"] } {
  const settings = getPlanSettings(db);
  const days = todayAndNext(now, horizonDays);
  const from = startOfDay(days[0]);
  const to = startOfDay(addDays(days[days.length - 1], 1));
  // Auto-proposals are about to be replaced; proposed exam sessions stay and must be planned around.
  const { busy, studyMin } = getBusy(db, from, to, { study: true, proposed: (b) => b.source !== "auto" });

  // Work that already has accepted blocks ahead does not need to be planned twice.
  const booked = new Map<string, number>();
  for (const b of db.select().from(blocks).where(and(eq(blocks.status, "accepted"), eq(blocks.kind, "study"), gte(blocks.endAt, now))).all()) {
    if (b.workKey) booked.set(b.workKey, (booked.get(b.workKey) ?? 0) + (b.endAt.getTime() - Math.max(b.startAt.getTime(), now.getTime())) / MIN);
  }
  const itemsToPlan = collectWork(db, now)
    .filter((w) => w.type !== "admin")
    .map((w) => ({ key: w.key, title: w.title, courseId: w.course?.id ?? null, remainingMin: Math.max(0, w.remainingMin - (booked.get(w.key) ?? 0)), dueAt: w.dueAt && w.dueAt > now ? w.dueAt : null }));

  const plan = proposeBlocks({ now, days, settings, busy, items: itemsToPlan, planned: studyMin });
  db.transaction((tx) => {
    tx.delete(blocks).where(and(eq(blocks.status, "proposed"), eq(blocks.source, "auto"))).run();
    for (const b of plan.blocks) {
      tx.insert(blocks).values({ workKey: b.workKey, title: b.title, courseId: b.courseId, kind: "study", startAt: b.start, endAt: b.end, status: "proposed", source: "auto", createdAt: now }).run();
    }
  });
  return { created: plan.blocks.length, unplaced: plan.unplaced };
}

export function getWeekLoads(db: Db, now: Date, weeks = 8): WeekLoad[] {
  const settings = getPlanSettings(db);
  const today = dateKey(now);
  const mondays = upcomingMondays(today, weeks);
  const from = startOfDay(mondays[0]);
  const to = startOfDay(addDays(mondays[mondays.length - 1], 7));
  const { busy, classMin } = getBusy(db, from, to, { study: false });

  const perDay = spreadByDay(
    collectWork(db, now).filter((w) => w.dueAt).map((w) => ({ key: w.key, courseId: w.course?.id ?? null, remainingMin: w.remainingMin, dueAt: w.dueAt!, leadDays: LEAD_DAYS[w.type] })),
    today,
  );
  // Exam-plan sessions are fixed in time, so they count on the day they are booked.
  for (const b of getBlocks(db, now, to)) {
    if (b.source !== "exam") continue;
    const d = dateKey(b.startAt);
    const m = perDay.get(d) ?? new Map<string, number>();
    m.set(b.courseId ?? "", (m.get(b.courseId ?? "") ?? 0) + (b.endAt.getTime() - b.startAt.getTime()) / MIN);
    perDay.set(d, m);
  }
  // Personal projects with a weekly budget are real load too.
  for (const [d, byProject] of projectLoadByDay(db, now, mondays, settings.days)) {
    const m = perDay.get(d) ?? new Map<string, number>();
    for (const [k, min] of byProject) m.set(k, (m.get(k) ?? 0) + min);
    perDay.set(d, m);
  }
  const capacity = new Map<string, number>();
  for (const monday of mondays) {
    for (let i = 0; i < 7; i++) {
      const d = addDays(monday, i);
      if (d >= today) capacity.set(d, capacityMin(d, settings, busy));
    }
  }
  return weekLoads({ mondays, perDay, classMin, capacity });
}

/** Creates the revision plan and books its sessions as proposed blocks. */
export function createExamPlan(
  db: Db,
  input: { title: string; courseId: string | null; examAt: Date; topics: string[]; oldExams: number; bufferDays: number },
  labels: ExamLabels,
  now: Date,
): { placed: number; unplaced: number; warnings: string[] } {
  const settings = getPlanSettings(db);
  const today = dateKey(now);
  const examDay = dateKey(input.examAt);
  const { sessions, warnings } = buildExamSessions({ today, examDay, topics: input.topics, oldExams: input.oldExams, bufferDays: input.bufferDays, labels });
  const { busy } = getBusy(db, startOfDay(today), input.examAt, { study: true, proposed: () => true });
  const lastDay = addDays(examDay, -1);
  const result = placeSessions({ sessions, settings, busy, now: new Date(now.getTime() + 15 * MIN), lastDay });
  db.transaction((tx) => {
    const plan = tx.insert(examPlans).values({ ...input, createdAt: now }).returning().get();
    for (const p of result.placed) {
      tx.insert(blocks).values({ workKey: null, title: `${input.title} · ${p.title}`, courseId: input.courseId, kind: "study", startAt: p.start, endAt: p.end, status: "proposed", source: "exam", planId: plan.id, createdAt: now }).run();
    }
  });
  return { placed: result.placed.length, unplaced: result.unplaced.length, warnings };
}

/** Upcoming exams found in the schedule (TimeEdit activity "Tentamen", "Examination"...). */
export function getUpcomingExams(db: Db, now: Date) {
  const cs = getCourses(db);
  return db
    .select()
    .from(items)
    .where(and(inArray(items.kind, ["schedule_event", "calendar_event"]), isNull(items.deletedAt), gte(items.startAt, now)))
    .all()
    .filter((r) => /tentamen|omtenta|(?<![a-zåäö])tenta(?![a-zåäö])|\bexam/i.test(`${r.title} ${String(r.fields.activity ?? "")}`))
    .filter((r) => !(r.courseId && cs.get(r.courseId)?.hidden))
    .map((r) => ({ id: r.id, title: r.title, startAt: r.startAt!, location: r.location, course: r.courseId ? cs.get(r.courseId) ?? null : null }))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

/** Plan blocks in the shape the Week and Today views already draw. */
export function blocksAsEvents(db: Db, from: Date, to: Date): AgendaEvent[] {
  const cs = getCourses(db);
  return getBlocks(db, from, to).map((b: Block) => ({
    id: `block:${b.id}`, kind: "block", provider: "plan", title: b.title, course: b.courseId ? cs.get(b.courseId) ?? null : null,
    startAt: b.startAt, endAt: b.endAt, allDay: false, location: null, htmlUrl: null,
    block: { id: b.id, status: b.status, kind: b.kind },
  }));
}
