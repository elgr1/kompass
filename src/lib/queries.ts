import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "./db";
import { changes, courses, items, scopes, syncRuns, tasks, type Change, type Course, type Item } from "./db/schema";

/** Read models for the views. All filtering on JSON fields happens in JS: the data set is small. */

export type CourseLite = Pick<Course, "id" | "shortName" | "name" | "code" | "color" | "htmlUrl" | "hidden">;

/** Items of a course the user has hidden are left out of every view. */
const shown = (cs: Map<string, CourseLite>, courseId: string | null) => !(courseId && cs.get(courseId)?.hidden);

export function getCourses(db: Db): Map<string, CourseLite> {
  return new Map(db.select().from(courses).all().map((c) => [c.id, c]));
}

export type AgendaEvent = {
  id: string;
  kind: string;
  provider: string;
  title: string;
  course: CourseLite | null;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  location: string | null;
  htmlUrl: string | null;
  /** set for my own plan blocks (study or busy), which are drawn differently from classes */
  block?: { id: number; status: "proposed" | "accepted"; kind: "study" | "busy" };
};

const EVENT_KINDS = ["schedule_event", "calendar_event"];

/** Timed things in [from, to): TimeEdit sessions and Canvas calendar events, de-duplicated. */
export function getEvents(db: Db, from: Date, to: Date): AgendaEvent[] {
  const cs = getCourses(db);
  const rows = db
    .select()
    .from(items)
    .where(and(inArray(items.kind, EVENT_KINDS), isNull(items.deletedAt), gte(items.startAt, from), lt(items.startAt, to)))
    .all();
  // Teachers often import the TimeEdit schedule into the Canvas calendar: keep the TimeEdit copy.
  const slot = (r: Item) => `${r.startAt?.getTime()}|${r.endAt?.getTime()}|${r.courseId ?? r.title.toLowerCase()}`;
  const scheduled = new Set(rows.filter((r) => r.kind === "schedule_event").map(slot));
  return rows
    .filter((r) => shown(cs, r.courseId))
    .filter((r) => r.kind === "schedule_event" || !scheduled.has(slot(r)))
    .map((r) => ({
      id: r.id, kind: r.kind, provider: r.provider, title: r.title, course: r.courseId ? cs.get(r.courseId) ?? null : null,
      startAt: r.startAt!, endAt: r.endAt, allDay: r.allDay, location: r.location, htmlUrl: r.htmlUrl,
    }))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.title.localeCompare(b.title));
}

export type DeadlineState = "open" | "submitted" | "graded" | "missing";
export type Deadline = {
  id: string;
  kind: string;
  title: string;
  course: CourseLite | null;
  dueAt: Date;
  htmlUrl: string | null;
  state: DeadlineState;
  grade: string | null;
  /** "task" = one of my own tasks; anything else was mirrored from a source */
  origin: "task" | "source";
  hasTime: boolean;
  taskId?: number;
};

function deadlineState(r: Item, now: Date): DeadlineState {
  const f = r.fields;
  if (r.kind === "planner_item") return f.completed || f.submitted ? "submitted" : "open";
  if (f.excused === true) return "graded";
  if (f.submission_state === "graded") return "graded";
  if (f.submission_state === "submitted" || f.submission_state === "pending_review") return "submitted";
  if (f.missing === true && r.dueAt && r.dueAt < now) return "missing";
  return "open";
}

/** Planner entries that are just another view of an assignment/quiz/event are skipped. */
const PLANNER_ONLY = new Set(["planner_note", "wiki_page", "discussion_topic"]);

function isDeadline(r: Item): boolean {
  if (r.kind === "assignment") return true;
  if (r.kind === "quiz") return r.fields.assignment_id == null; // graded quizzes also exist as assignments
  if (r.kind === "planner_item") return PLANNER_ONLY.has(String(r.fields.plannable_type));
  return false;
}

export function getDeadlines(db: Db, from: Date, to: Date, now: Date = new Date(), opts: { tasks?: boolean } = {}): Deadline[] {
  const cs = getCourses(db);
  const mirrored: Deadline[] = db
    .select()
    .from(items)
    .where(and(inArray(items.kind, ["assignment", "quiz", "planner_item"]), isNull(items.deletedAt), gte(items.dueAt, from), lt(items.dueAt, to)))
    .all()
    .filter(isDeadline)
    .filter((r) => shown(cs, r.courseId))
    .map((r) => ({
      id: r.id, kind: r.kind, title: r.title, course: r.courseId ? cs.get(r.courseId) ?? null : null, dueAt: r.dueAt!, htmlUrl: r.htmlUrl,
      state: deadlineState(r, now), grade: typeof r.fields.grade === "string" ? r.fields.grade : null, origin: "source" as const, hasTime: true,
    }));
  // My own tasks sit in the same list as Studium deadlines: one place to look.
  const own: Deadline[] = opts.tasks === false ? [] : db
    .select()
    .from(tasks)
    .where(and(gte(tasks.dueAt, from), lt(tasks.dueAt, to)))
    .all()
    .filter((t) => shown(cs, t.courseId))
    .map((t) => ({
      id: `task:${t.id}`, kind: t.kind, title: t.title, course: t.courseId ? cs.get(t.courseId) ?? null : null, dueAt: t.dueAt!, htmlUrl: t.sourceUrl,
      state: t.status === "done" ? ("submitted" as const) : ("open" as const), grade: null, origin: "task" as const, hasTime: t.hasTime, taskId: t.id,
    }));
  return [...mirrored, ...own].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

export type RadarEntry = Change & { course: CourseLite | null; item: Pick<Item, "startAt" | "bodyText" | "fields"> | null };
export type RadarFilter = "unread" | "action" | "all";

export function getRadar(db: Db, filter: RadarFilter, now: Date = new Date(), limit = 200): RadarEntry[] {
  const cs = getCourses(db);
  const rows = db
    .select({ change: changes, startAt: items.startAt, bodyText: items.bodyText, fields: items.fields })
    .from(changes)
    .leftJoin(items, eq(items.id, changes.itemId))
    .orderBy(desc(changes.detectedAt), desc(changes.id))
    .limit(1000)
    .all();
  const snoozed = (c: Change) => c.snoozedUntil !== null && c.snoozedUntil > now;
  return rows
    .filter(({ change: c }) => {
      if (!shown(cs, c.courseId)) return false;
      if (filter === "all") return true;
      if (c.readAt || snoozed(c)) return false;
      return filter === "unread" || c.triage === "action";
    })
    .slice(0, limit)
    .map(({ change, startAt, bodyText, fields }) => ({
      ...change,
      course: change.courseId ? cs.get(change.courseId) ?? null : null,
      item: fields ? { startAt, bodyText, fields } : null,
    }));
}

export function getRadarCounts(db: Db, now: Date = new Date()): { unread: number; action: number } {
  const cs = getCourses(db);
  const rows = db.select({ triage: changes.triage, snoozedUntil: changes.snoozedUntil, courseId: changes.courseId }).from(changes).where(isNull(changes.readAt)).all();
  const live = rows.filter((r) => !(r.snoozedUntil && r.snoozedUntil > now) && shown(cs, r.courseId));
  return { unread: live.length, action: live.filter((r) => r.triage === "action").length };
}

export function getKindCounts(db: Db): { provider: string; kind: string; n: number }[] {
  return db
    .select({ provider: items.provider, kind: items.kind, n: sql<number>`count(*)` })
    .from(items)
    .where(isNull(items.deletedAt))
    .groupBy(items.provider, items.kind)
    .all();
}

export const getScopeIssues = (db: Db) => db.select().from(scopes).all().filter((s) => s.lastStatus !== "ok");
export const getRecentRuns = (db: Db, n = 12) => db.select().from(syncRuns).orderBy(desc(syncRuns.id)).limit(n).all();
