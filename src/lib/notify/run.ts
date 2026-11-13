import { eq } from "drizzle-orm";
import { getDb, isDemo, type Db } from "../db";
import { sentNotifications, suggestions } from "../db/schema";
import { getCourses, getDeadlines, getEvents, getRadarCounts } from "../queries";
import { getSetting } from "../settings";
import { getOpenTasks } from "../tasks";
import { addDays, dateKey, startOfDay, type Lang } from "../time";
import { getChannels, type NotifyChannel, type Outgoing } from "./channels";
import { composeDigest, digestDue, planReminders, type Notice, type Remindable } from "./plan";

export async function deliver(channels: NotifyChannel[], n: Outgoing): Promise<boolean> {
  const results = await Promise.allSettled(channels.map((c) => c.send(n)));
  results.forEach((r, i) => {
    if (r.status === "rejected") console.error(`[kompass] notification via ${channels[i].id} failed:`, r.reason instanceof Error ? r.reason.message : r.reason);
  });
  return results.some((r) => r.status === "fulfilled");
}

/** Called every few minutes by the scheduler. Sends each reminder and digest at most once. */
export async function notifyTick(db: Db = getDb(), now: Date = new Date(), channels: NotifyChannel[] = getChannels()): Promise<number> {
  if (isDemo() || channels.length === 0) return 0;
  const lang: Lang = getSetting(db, "lang") === "en" ? "en" : "sv";
  const sent = new Set(db.select({ key: sentNotifications.key }).from(sentNotifications).all().map((r) => r.key));
  const cs = getCourses(db);
  const today = dateKey(now);

  const fromTasks: Remindable[] = getOpenTasks(db)
    .filter((t) => t.dueAt)
    .map((t) => ({ id: `task:${t.id}`, title: t.title, dueAt: t.dueAt!, hasTime: t.hasTime, kind: t.kind, course: t.courseId ? cs.get(t.courseId)?.shortName : null, url: t.sourceUrl }));
  const fromStudium: Remindable[] = getDeadlines(db, now, startOfDay(addDays(today, 5)), now, { tasks: false })
    .filter((d) => d.state === "open")
    .map((d) => ({ id: d.id, title: d.title, dueAt: d.dueAt, hasTime: true, kind: "deadline" as const, course: d.course?.shortName, url: d.htmlUrl }));

  const plan = planReminders(now, [...fromTasks, ...fromStudium], sent, lang);
  const queue: Notice[] = [...plan.send];

  const digest = digestDue(now, sent);
  if (digest) {
    const weekly = digest.type === "weekly";
    const from = weekly ? startOfDay(addDays(today, 1)) : startOfDay(today);
    const to = startOfDay(addDays(today, weekly ? 8 : 1));
    const text = composeDigest(digest.type, {
      events: getEvents(db, from, to),
      deadlines: getDeadlines(db, now, startOfDay(addDays(today, 8)), now),
      radarAction: getRadarCounts(db, now).action,
      suggestions: db.select({ id: suggestions.id }).from(suggestions).where(eq(suggestions.status, "pending")).all().length,
    }, lang, now);
    queue.push({ key: digest.key, ...text });
  }

  const record = (key: string, title: string, ok: boolean) =>
    db.insert(sentNotifications).values({ key, sentAt: now, title, ok }).onConflictDoNothing().run();
  for (const key of plan.markSent) record(key, "(superseded)", true);
  let count = 0;
  for (const n of queue) {
    const ok = await deliver(channels, n);
    if (ok) {
      record(n.key, n.title, true); // a failed send is not recorded, so it is retried on the next tick
      count++;
    }
  }
  return count;
}
