import Link from "next/link";
import { ChangeCard } from "@/components/ChangeCard";
import { Card, DeadlineRow, Empty, EventRow } from "@/components/ui";
import { getDb } from "@/lib/db";
import { t } from "@/lib/i18n";
import { getPrefs } from "@/lib/prefs";
import { eq } from "drizzle-orm";
import { suggestions } from "@/lib/db/schema";
import { careerAgenda } from "@/lib/career/store";
import { blocksAsEvents, getWeekLoads } from "@/lib/plan/store";
import { getDeadlines, getEvents, getRadar } from "@/lib/queries";
import { TimeEditIcsProvider } from "@/lib/providers/ics";
import { isDemo } from "@/lib/db";
import { addDays, dateKey, fmtDayLong, isoWeek, startOfDay } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const { lang } = await getPrefs();
  const db = getDb();
  const now = new Date();
  const today = dateKey(now);
  const dayStart = startOfDay(today);
  const dayEnd = startOfDay(addDays(today, 1));

  const events = [...getEvents(db, dayStart, dayEnd), ...blocksAsEvents(db, dayStart, dayEnd), ...careerAgenda(db, dayStart, dayEnd)].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  // Warn about heavy weeks while there is still time to act: this week and the two after.
  const crunch = getWeekLoads(db, now, 3).filter((w) => w.crunch);
  const h = (min: number) => Math.round(min / 60);
  // Open work: three weeks back (so missed things stay visible) and two weeks ahead.
  const all = getDeadlines(db, startOfDay(addDays(today, -21)), startOfDay(addDays(today, 15)), now);
  const open = all.filter((d) => d.state === "open" || d.state === "missing");
  const overdue = open.filter((d) => d.dueAt < now);
  const priorities = [...overdue.slice(-2), ...open.filter((d) => d.dueAt >= now)].slice(0, 3);
  const upcoming = all.filter((d) => d.dueAt >= dayStart);
  const radar = getRadar(db, "action", now, 5);
  const noSchedule = !isDemo() && !TimeEditIcsProvider.fromEnv();
  const heading = fmtDayLong(now, lang);
  const found = db.select({ id: suggestions.id }).from(suggestions).where(eq(suggestions.status, "pending")).all().length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{heading.charAt(0).toUpperCase() + heading.slice(1)}</h1>
        <p className="mt-0.5 text-sm text-muted">{t(lang, "today.week", { n: isoWeek(today).week })}</p>
      </div>

      {found > 0 && (
        <Link href="/found" className="flex items-center justify-between gap-3 rounded-xl border border-warn bg-warn-soft px-4 py-3 text-sm font-medium text-warn">
          <span>{t(lang, "found.card")}: {found}</span>
          <span>{t(lang, "found.review")} →</span>
        </Link>
      )}

      {crunch.map((w) => (
        <Link key={w.monday} href="/plan?tab=load" className="flex items-center justify-between gap-3 rounded-xl border border-danger bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          <span>{t(lang, "load.warn", { week: isoWeek(w.monday).week, study: h(w.studyMin), free: h(w.capacityMin) })}</span>
          <span className="shrink-0">{t(lang, "load.warnGo")} →</span>
        </Link>
      ))}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Card title={t(lang, "today.priorities")} hint={t(lang, "today.prioritiesHint")}
            action={<Link href="/plan" className="shrink-0 text-xs font-medium text-accent hover:underline">{t(lang, "now.title")}</Link>}>
            {priorities.length ? <ul className="divide-y divide-border">{priorities.map((d) => <DeadlineRow key={d.id} d={d} lang={lang} now={now} />)}</ul> : <Empty>{t(lang, "today.noPriorities")}</Empty>}
          </Card>
          <Card title={t(lang, "today.schedule")}>
            {events.length ? <ul className="divide-y divide-border">{events.map((e) => <EventRow key={e.id} e={e} lang={lang} now={now} />)}</ul>
              : <Empty>{noSchedule ? t(lang, "sync.timeeditHint") : t(lang, "today.noSchedule")}</Empty>}
          </Card>
          <Card title={t(lang, "today.radar")} action={<Link href="/radar" className="text-xs font-medium text-accent hover:underline">{t(lang, "today.radarAll")}</Link>}>
            {radar.length ? <ul className="divide-y divide-border">{radar.map((c) => <ChangeCard key={c.id} c={c} lang={lang} now={now} compact />)}</ul> : <Empty>{t(lang, "today.noRadar")}</Empty>}
          </Card>
        </div>

        <div className="space-y-5">
          {overdue.length > 0 && (
            <Card title={`${t(lang, "today.overdue")} (${overdue.length})`}>
              <ul className="divide-y divide-border">{overdue.map((d) => <DeadlineRow key={d.id} d={d} lang={lang} now={now} />)}</ul>
            </Card>
          )}
          <Card title={t(lang, "today.upcoming")}>
            {upcoming.length ? <ul className="divide-y divide-border">{upcoming.map((d) => <DeadlineRow key={d.id} d={d} lang={lang} now={now} />)}</ul> : <Empty>{t(lang, "today.noUpcoming")}</Empty>}
          </Card>
        </div>
      </div>
    </div>
  );
}
