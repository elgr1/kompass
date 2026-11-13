import { and, eq, gte, lte } from "drizzle-orm";
import type { Db } from "../db";
import { applications, careerEvents, tasks, type Application, type ApplicationStatus, type TaskKind } from "../db/schema";
import { dueFromMention } from "../detect/extract";
import type { AgendaEvent } from "../queries";
import { getSetting, setSetting } from "../settings";
import { addDays, dateKey, isDateKey, startOfDay } from "../time";
import { defaultExjobbSteps, type ExjobbPlan } from "./logic";

/**
 * Keeps one task in step with a dated thing that lives elsewhere (an application deadline,
 * a follow-up, an exam registration, a thesis step). The task is what carries it into Today,
 * Week, reminders and the calendar feed, so those features need no special cases.
 * Returns the task id, or null when there is no date (any open linked task is removed).
 */
export function syncLinkedTask(
  db: Db,
  link: { taskId: number | null | undefined; title: string; due: string | null; kind: TaskKind; url: string; done: boolean; tags?: string[] },
  now: Date = new Date(),
): number | null {
  const existing = link.taskId ? db.select().from(tasks).where(eq(tasks.id, link.taskId)).get() : undefined;
  if (!link.due || !isDateKey(link.due)) {
    if (existing && existing.status !== "done") db.delete(tasks).where(eq(tasks.id, existing.id)).run();
    return existing && existing.status === "done" ? existing.id : null;
  }
  const { dueAt } = dueFromMention({ date: link.due, time: null, precision: "day" });
  const status = link.done ? ("done" as const) : existing && existing.status !== "done" ? existing.status === "inbox" ? ("todo" as const) : existing.status : ("todo" as const);
  const values = { title: link.title, dueAt, hasTime: false, kind: link.kind, sourceUrl: link.url, status, completedAt: link.done ? existing?.completedAt ?? now : null };
  if (existing) {
    db.update(tasks).set(values).where(eq(tasks.id, existing.id)).run();
    return existing.id;
  }
  if (link.done) return null; // nothing to remind about, so do not create a finished task
  return db.insert(tasks).values({ ...values, tags: link.tags ?? [], source: "manual", createdAt: now }).returning().get().id;
}

const SENT: ApplicationStatus[] = ["applied", "interview", "offer", "rejected"];
const CLOSED: ApplicationStatus[] = ["offer", "rejected"];

/** Re-derives the two linked tasks of an application from its current fields. */
export function syncApplication(db: Db, id: number, labels: { apply: string; follow: string }, now: Date = new Date()): Application | null {
  const a = db.select().from(applications).where(eq(applications.id, id)).get();
  if (!a) return null;
  const name = [a.company, a.role].filter(Boolean).join(", ");
  const taskId = syncLinkedTask(db, { taskId: a.taskId, title: `${labels.apply}: ${name}`, due: a.deadline, kind: "deadline", url: `/career/${id}`, done: SENT.includes(a.status), tags: ["career"] }, now);
  const followTaskId = syncLinkedTask(db, { taskId: a.followTaskId, title: `${labels.follow}: ${name}`, due: a.followUpAt, kind: "task", url: `/career/${id}`, done: CLOSED.includes(a.status), tags: ["career"] }, now);
  const appliedAt = SENT.includes(a.status) ? a.appliedAt ?? dateKey(now) : null;
  db.update(applications).set({ taskId, followTaskId, appliedAt }).where(eq(applications.id, id)).run();
  return { ...a, taskId, followTaskId, appliedAt };
}

export function deleteApplication(db: Db, id: number) {
  const a = db.select().from(applications).where(eq(applications.id, id)).get();
  if (!a) return;
  db.transaction((tx) => {
    for (const tid of [a.taskId, a.followTaskId]) if (tid) tx.delete(tasks).where(and(eq(tasks.id, tid))).run();
    tx.delete(applications).where(eq(applications.id, id)).run();
  });
}

/** Career fairs and application windows as all-day entries for Today, Week and the calendar feed. */
export function careerAgenda(db: Db, from: Date, to: Date): AgendaEvent[] {
  const a = dateKey(from);
  const b = dateKey(new Date(to.getTime() - 1));
  const out: AgendaEvent[] = [];
  for (const e of db.select().from(careerEvents).where(and(lte(careerEvents.startDate, b), gte(careerEvents.startDate, addDays(a, -120)))).all()) {
    const end = e.endDate && e.endDate >= e.startDate ? e.endDate : e.startDate;
    // a multi-day event shows on each of its days
    for (let d = e.startDate < a ? a : e.startDate; d <= end && d <= b; d = addDays(d, 1)) {
      out.push({ id: `career:${e.id}:${d}`, kind: "career_event", provider: "career", title: e.title, course: null, startAt: startOfDay(d), endAt: null, allDay: true, location: e.location, htmlUrl: e.url });
    }
  }
  return out;
}

export function getExjobb(db: Db, lang: "sv" | "en"): ExjobbPlan {
  try {
    const p = JSON.parse(getSetting(db, "exjobb") ?? "null") as ExjobbPlan | null;
    if (p && Array.isArray(p.steps)) return { start: p.start ?? null, contact: p.contact ?? "", reviewer: p.reviewer ?? "", notes: p.notes ?? "", steps: p.steps };
  } catch {
    /* fall through to the default plan */
  }
  return { start: null, contact: "", reviewer: "", notes: "", steps: defaultExjobbSteps(lang) };
}

/** Saves the plan and keeps one task per dated, unfinished step, so each step reminds me when it is time. */
export function saveExjobb(db: Db, plan: ExjobbPlan, now: Date = new Date()) {
  const steps = plan.steps.map((s) => ({
    ...s,
    taskId: syncLinkedTask(db, { taskId: s.taskId, title: `Exjobb: ${s.title}`, due: plan.start ? addDays(plan.start, s.offset) : null, kind: "task", url: "/career?tab=exjobb", done: s.done, tags: ["exjobb"] }, now),
  }));
  setSetting(db, "exjobb", JSON.stringify({ ...plan, steps }));
  setSetting(db, "search_dirty", "1");
}
