import { and, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { parseCapture, type CaptureCourse } from "./capture/parse";
import type { Db } from "./db";
import { courses, tasks, type Task, type TaskKind } from "./db/schema";
import { dueFromMention } from "./detect/extract";
import { setSetting } from "./settings";

export type NewTask = {
  title: string;
  notes?: string | null;
  dueAt?: Date | null;
  hasTime?: boolean;
  courseId?: string | null;
  tags?: string[];
  kind?: TaskKind;
  source: Task["source"];
  sourceItemId?: string | null;
  sourceUrl?: string | null;
  sourceQuote?: string | null;
  projectId?: number | null;
};

export function createTask(db: Db, t: NewTask, now: Date = new Date()): Task {
  // Something with neither a date nor a course still needs a decision: it waits in the inbox.
  const status = t.dueAt || t.courseId || t.projectId ? "todo" : "inbox";
  setSetting(db, "search_dirty", "1");
  return db
    .insert(tasks)
    .values({
      title: t.title, notes: t.notes ?? null, dueAt: t.dueAt ?? null, hasTime: Boolean(t.dueAt && t.hasTime), courseId: t.courseId ?? null,
      tags: t.tags ?? [], kind: t.kind ?? "task", status, source: t.source, sourceItemId: t.sourceItemId ?? null,
      sourceUrl: t.sourceUrl ?? null, sourceQuote: t.sourceQuote ?? null, projectId: t.projectId ?? null, createdAt: now,
    })
    .returning()
    .get();
}

export function captureCourses(db: Db): CaptureCourse[] {
  return db
    .select({ id: courses.id, shortName: courses.shortName, code: courses.code, nicknames: courses.nicknames })
    .from(courses)
    .where(and(eq(courses.active, true), eq(courses.hidden, false), ne(courses.provider, "timeedit")))
    .all();
}

export function captureTask(db: Db, input: string, now: Date = new Date()): Task | null {
  const c = parseCapture(input, { now, courses: captureCourses(db) });
  if (!c.title) return null;
  const due = c.date ? dueFromMention({ date: c.date, time: c.time, precision: "day" }) : null;
  return createTask(db, { title: c.title, dueAt: due?.dueAt, hasTime: due?.hasTime, courseId: c.courseId, tags: c.tags, kind: c.kind, source: "capture" }, now);
}

export function setTaskDone(db: Db, id: number, done: boolean, now: Date = new Date()) {
  const t = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!t) return;
  const status = done ? "done" : t.dueAt || t.courseId || t.projectId ? "todo" : "inbox";
  db.update(tasks).set({ status, completedAt: done ? now : null }).where(eq(tasks.id, id)).run();
}

export const getOpenTasks = (db: Db) => db.select().from(tasks).where(inArray(tasks.status, ["inbox", "todo", "doing"])).all();
export const getDoneTasks = (db: Db, n = 15) =>
  db.select().from(tasks).where(and(eq(tasks.status, "done"), isNotNull(tasks.completedAt))).orderBy(desc(tasks.completedAt)).limit(n).all();
