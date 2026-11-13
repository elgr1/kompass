import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db";
import { milestones, projects, tasks, timeEntries, type Project } from "../db/schema";
import { addDays, dateKey, mondayOf, startOfDay, weekday } from "../time";

const MIN = 60_000;
export const projectKey = (id: number) => `project:${id}`;

/** Minutes logged on a project: timers started on the project itself plus timers on its tasks. */
export function projectTime(db: Db, projectId: number, now: Date): { total: number; thisWeek: number; entries: (typeof timeEntries.$inferSelect)[] } {
  const keys = [projectKey(projectId), ...db.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, projectId)).all().map((t) => `task:${t.id}`)];
  const entries = db.select().from(timeEntries).where(inArray(timeEntries.workKey, keys)).all().sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  const weekStart = startOfDay(mondayOf(dateKey(now))).getTime();
  let total = 0;
  let thisWeek = 0;
  for (const e of entries) {
    const m = Math.max(0, ((e.endedAt ?? now).getTime() - e.startedAt.getTime()) / MIN);
    total += m;
    if (e.startedAt.getTime() >= weekStart) thisWeek += m;
  }
  return { total: Math.round(total), thisWeek: Math.round(thisWeek), entries };
}

export const getProject = (db: Db, id: number) => db.select().from(projects).where(eq(projects.id, id)).get() ?? null;
export const getMilestones = (db: Db, id: number) => db.select().from(milestones).where(eq(milestones.projectId, id)).all().sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9") || a.id - b.id);

/**
 * Weekly budgets of active projects as load per day, so projects compete with coursework
 * in the workload view. The budget is spread over the study days left in each week; in the
 * current week, time already logged is subtracted first.
 */
export function projectLoadByDay(db: Db, now: Date, mondays: string[], studyDays: number[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const today = dateKey(now);
  const active = db.select().from(projects).where(eq(projects.status, "active")).all().filter((p: Project) => p.weeklyBudgetMin > 0);
  for (const p of active) {
    const logged = projectTime(db, p.id, now).thisWeek;
    for (const monday of mondays) {
      const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter((d) => d >= today && studyDays.includes(weekday(d)));
      const isCurrent = monday === mondayOf(today);
      const minutes = Math.max(0, p.weeklyBudgetMin - (isCurrent ? logged : 0));
      if (!days.length || minutes <= 0) continue;
      for (const d of days) {
        const m = out.get(d) ?? new Map<string, number>();
        m.set(projectKey(p.id), (m.get(projectKey(p.id)) ?? 0) + minutes / days.length);
        out.set(d, m);
      }
    }
  }
  return out;
}
