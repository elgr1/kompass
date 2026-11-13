import { and, eq, gte, isNull, lt } from "drizzle-orm";
import type { Db } from "../db";
import { changes, docs, items, tasks, timeEntries } from "../db/schema";
import { DEFAULT_MIN, guessType, isWorkType } from "../plan/estimate";
import { collectWork, loggedByKey } from "../plan/store";
import { workMeta } from "../db/schema";
import { getCourses, getDeadlines } from "../queries";
import { getSetting, setSetting } from "../settings";
import { addDays, dateKey, fmtDate, mondayOf, startOfDay, type Lang } from "../time";
import { courseHealth, estimateAccuracy, minutesByWeek, reviewStreak, type AccuracySample, type Health, type TimeRow } from "./logic";

const MIN = 60_000;
const REVIEW_TITLE = /^(veckogenomgång|weekly review)/i;

export function timeRows(db: Db, from: Date, to: Date, now: Date): TimeRow[] {
  const taskProject = new Map(db.select({ id: tasks.id, projectId: tasks.projectId }).from(tasks).all().map((t) => [`task:${t.id}`, t.projectId]));
  return db.select().from(timeEntries).where(and(gte(timeEntries.startedAt, from), lt(timeEntries.startedAt, to))).all().map((e) => {
    const project = e.workKey?.startsWith("project:") ? e.workKey : e.workKey && taskProject.get(e.workKey) ? `project:${taskProject.get(e.workKey)}` : null;
    return { key: e.courseId || project || "", monday: mondayOf(dateKey(e.startedAt)), minutes: Math.max(0, ((e.endedAt ?? now).getTime() - e.startedAt.getTime()) / MIN) };
  });
}

export const weeklyTime = (db: Db, now: Date, weeks = 8) => {
  const current = mondayOf(dateKey(now));
  const mondays = Array.from({ length: weeks }, (_, i) => addDays(current, (i - weeks + 1) * 7));
  return minutesByWeek(timeRows(db, startOfDay(mondays[0]), startOfDay(addDays(current, 7)), now), mondays);
};

/** Finished work with logged time: what was estimated against what it took. */
export function accuracySamples(db: Db, from: Date, to: Date, now: Date): AccuracySample[] {
  const meta = new Map(db.select().from(workMeta).all().map((m) => [m.key, m]));
  const logged = loggedByKey(db, now);
  return getDeadlines(db, from, to, now)
    .filter((d) => d.state === "submitted" || d.state === "graded")
    .flatMap((d) => {
      const actualMin = Math.round(logged.get(d.id) ?? 0);
      if (actualMin < 10) return [];
      const m = meta.get(d.id);
      const type = isWorkType(m?.workType) ? m.workType : guessType(d.title, d.kind);
      return [{ title: d.title, estimateMin: m?.estimateMin ?? DEFAULT_MIN[type], actualMin }];
    });
}

export function reviewWeeks(db: Db): Set<string> {
  return new Set(db.select({ title: docs.title, createdAt: docs.createdAt }).from(docs).all().filter((d) => REVIEW_TITLE.test(d.title)).map((d) => mondayOf(dateKey(d.createdAt))));
}
export const currentStreak = (db: Db, now: Date) => reviewStreak(reviewWeeks(db), mondayOf(dateKey(now)));

/* ---- Feedback inbox ---- */

const ackSet = (db: Db): Set<string> => { try { return new Set(JSON.parse(getSetting(db, "feedback_ack") ?? "[]") as string[]); } catch { return new Set(); } };
export function acknowledgeFeedback(db: Db, itemId: string) {
  setSetting(db, "feedback_ack", JSON.stringify([...ackSet(db).add(itemId)]));
}
export function getFeedback(db: Db) {
  const cs = getCourses(db);
  const acked = ackSet(db);
  return db.select().from(items).where(and(eq(items.kind, "submission_comment"), isNull(items.deletedAt))).all()
    .filter((f) => !(f.courseId && cs.get(f.courseId)?.hidden))
    .map((f) => ({ id: f.id, title: f.title, text: f.bodyText ?? "", author: String(f.fields.author ?? ""), at: typeof f.fields.created_at === "string" ? new Date(f.fields.created_at) : f.firstSeenAt, url: f.htmlUrl, course: f.courseId ? cs.get(f.courseId) ?? null : null, acknowledged: acked.has(f.id) }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

/* ---- Course health ---- */

export function healthByCourse(db: Db, now: Date): Map<string, Health> {
  const cs = getCourses(db);
  const soon = new Date(now.getTime() + 7 * 86_400_000);
  const work = collectWork(db, now);
  const unread = db.select({ courseId: changes.courseId, triage: changes.triage, snoozedUntil: changes.snoozedUntil }).from(changes).where(isNull(changes.readAt)).all().filter((c) => c.triage === "action" && !(c.snoozedUntil && c.snoozedUntil > now));
  const feedback = getFeedback(db).filter((f) => !f.acknowledged);
  const out = new Map<string, Health>();
  for (const c of cs.values()) {
    if (c.hidden || c.id.startsWith("timeedit:")) continue;
    const mine = work.filter((w) => w.course?.id === c.id && w.dueAt);
    out.set(c.id, courseHealth({
      missing: mine.filter((w) => w.dueAt! < now).length,
      unstartedSoon: mine.filter((w) => w.dueAt! >= now && w.dueAt! < soon && w.loggedMin === 0 && w.type !== "admin").length,
      unreadAction: unread.filter((u) => u.courseId === c.id).length,
      newFeedback: feedback.filter((f) => f.course?.id === c.id).length,
    }));
  }
  return out;
}

/* ---- Period retrospective ---- */

export function buildRetrospective(db: Db, fromKey: string, toKey: string, lang: Lang, now: Date): { title: string; content: string } {
  const sv = lang === "sv";
  const from = startOfDay(fromKey);
  const to = startOfDay(addDays(toKey, 1));
  const cs = getCourses(db);
  const h = (min: number) => new Intl.NumberFormat(sv ? "sv-SE" : "en-GB", { maximumFractionDigits: 1 }).format(min / 60);

  const byKey = new Map<string, number>();
  for (const r of timeRows(db, from, to, now)) byKey.set(r.key, (byKey.get(r.key) ?? 0) + r.minutes);
  const total = [...byKey.values()].reduce((a, b) => a + b, 0);
  const name = (k: string) => cs.get(k)?.shortName ?? (k.startsWith("project:") ? (sv ? "Projekt" : "Project") : sv ? "Övrigt" : "Other");
  const timeTable = [...byKey].sort((a, b) => b[1] - a[1]).map(([k, m]) => `| ${name(k)} | ${h(m)} |`).join("\n");

  const deadlines = getDeadlines(db, from, to, now, { tasks: false });
  const count = (f: (s: string) => boolean) => deadlines.filter((d) => f(d.state)).length;
  const acc = estimateAccuracy(accuracySamples(db, from, to, now));
  const doneTasks = db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.status, "done"), gte(tasks.completedAt, from), lt(tasks.completedAt, to))).all().length;
  const reviews = [...reviewWeeks(db)].filter((m) => m >= mondayOf(fromKey) && m <= toKey).length;
  const range = `${fmtDate(from, lang)} – ${fmtDate(startOfDay(toKey), lang)} ${toKey.slice(0, 4)}`;

  const content = sv
    ? `> [!note] Sammanställt automatiskt ${dateKey(now)} från det appen känner till. Siffrorna bygger på loggad tid, så de är bara så bra som loggningen.

## Tid

Totalt loggat: **${h(total)} h**

| Kurs / projekt | Timmar |
| --- | --- |
${timeTable || "| – | – |"}

## Inlämningar

- Inlämnade eller rättade: **${count((s) => s === "submitted" || s === "graded")}** av ${deadlines.length}
- Saknas: **${count((s) => s === "missing")}**
- Egna uppgifter avklarade: **${doneTasks}**

## Estimat

${acc.n ? `Av ${acc.n} avklarade uppgifter med loggad tid tog medianen **${acc.medianRatio}×** estimatet, och ${acc.within25} % hamnade inom 25 %.` : "För lite loggad tid på avklarade uppgifter för att säga något."}
${acc.worst.map((w) => `- ${w.title}: ${h(w.actualMin)} h mot ${h(w.estimateMin)} h`).join("\n")}

## Rutiner

Veckogenomgångar gjorda: **${reviews}**

## Reflektion

### Vad fungerade?

### Vad tar jag med mig till nästa period?

### En sak att sluta med
`
    : `> [!note] Compiled automatically on ${dateKey(now)} from what the app knows. The figures rest on logged time, so they are only as good as the logging.

## Time

Total logged: **${h(total)} h**

| Course / project | Hours |
| --- | --- |
${timeTable || "| – | – |"}

## Hand-ins

- Submitted or graded: **${count((s) => s === "submitted" || s === "graded")}** of ${deadlines.length}
- Missing: **${count((s) => s === "missing")}**
- Own tasks completed: **${doneTasks}**

## Estimates

${acc.n ? `Of ${acc.n} finished items with logged time, the median took **${acc.medianRatio}×** the estimate, and ${acc.within25}% landed within 25%.` : "Too little logged time on finished work to say anything."}
${acc.worst.map((w) => `- ${w.title}: ${h(w.actualMin)} h against ${h(w.estimateMin)} h`).join("\n")}

## Routines

Weekly reviews done: **${reviews}**

## Reflection

### What worked?

### What do I take into the next period?

### One thing to stop doing
`;
  return { title: `${sv ? "Periodsammanfattning" : "Period retrospective"} ${range}`, content };
}
