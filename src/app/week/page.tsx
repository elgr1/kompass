import Link from "next/link";
import { Card, DeadlineRow, Empty, EventRow, SourceLink } from "@/components/ui";
import { getDb } from "@/lib/db";
import { t } from "@/lib/i18n";
import { getPrefs } from "@/lib/prefs";
import { careerAgenda } from "@/lib/career/store";
import { blocksAsEvents } from "@/lib/plan/store";
import { getDeadlines, getEvents, type AgendaEvent } from "@/lib/queries";
import { addDays, dateKey, fmtDate, fmtDayLong, fmtTime, fmtWeekdayShort, isDateKey, isoWeek, minutesOfDay, mondayOf, startOfDay } from "@/lib/time";

export const dynamic = "force-dynamic";
const HOUR_PX = 46;

type Placed = { e: AgendaEvent; top: number; height: number; lane: number; lanes: number };

/** Lays out one day's timed events side by side where they overlap. */
function place(events: AgendaEvent[], fromMin: number, toMin: number): Placed[] {
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];
  const flush = () => {
    for (const p of cluster) p.lanes = laneEnds.length;
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };
  for (const e of events) {
    const start = Math.max(minutesOfDay(e.startAt), fromMin);
    const sameDay = e.endAt && dateKey(e.endAt) === dateKey(e.startAt);
    const end = Math.min(Math.max(sameDay ? minutesOfDay(e.endAt!) : e.endAt ? toMin : start + 45, start + 25), toMin);
    if (cluster.length && start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((x) => x <= start);
    if (lane < 0) lane = laneEnds.push(end) - 1;
    else laneEnds[lane] = end;
    clusterEnd = Math.max(clusterEnd, end);
    cluster.push({ e, top: ((start - fromMin) / 60) * HOUR_PX, height: ((end - start) / 60) * HOUR_PX, lane, lanes: 1 });
  }
  flush();
  return out;
}

export default async function WeekPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { lang } = await getPrefs();
  const { d } = await searchParams;
  const db = getDb();
  const now = new Date();
  const today = dateKey(now);
  const monday = mondayOf(isDateKey(d) ? d : today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const from = startOfDay(monday);
  const to = startOfDay(addDays(monday, 7));

  const events = [...getEvents(db, from, to), ...blocksAsEvents(db, from, to), ...careerAgenda(db, from, to)].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const deadlines = getDeadlines(db, from, to, now);
  const timed = events.filter((e) => !e.allDay);
  const byDay = (key: string) => timed.filter((e) => dateKey(e.startAt) === key);

  const starts = timed.map((e) => minutesOfDay(e.startAt));
  const ends = timed.map((e) => (e.endAt && dateKey(e.endAt) === dateKey(e.startAt) ? minutesOfDay(e.endAt) : minutesOfDay(e.startAt) + 60));
  const fromHour = Math.min(8, ...starts.map((m) => Math.floor(m / 60)));
  const toHour = Math.max(18, ...ends.map((m) => Math.ceil(m / 60)));
  const hours = Array.from({ length: toHour - fromHour }, (_, i) => fromHour + i);
  const { week, year } = isoWeek(monday);
  const navBtn = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t(lang, "today.week", { n: week })} <span className="font-normal text-muted">{year}</span></h1>
          <p className="mt-0.5 text-sm text-muted">{fmtDate(from, lang)} – {fmtDate(startOfDay(days[6]), lang)}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/week?d=${addDays(monday, -7)}`} className={navBtn} aria-label={t(lang, "week.prev")}>←</Link>
          <Link href="/week" className={navBtn}>{t(lang, "week.thisWeek")}</Link>
          <Link href={`/week?d=${addDays(monday, 7)}`} className={navBtn} aria-label={t(lang, "week.next")}>→</Link>
        </div>
      </div>

      {/* Desktop: time grid */}
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
        <div className="min-w-[860px]">
          <div className="grid grid-cols-[48px_repeat(7,minmax(0,1fr))] border-b border-border">
            <div />
            {days.map((key) => {
              const date = startOfDay(key);
              const isToday = key === today;
              return (
                <div key={key} className={`border-l border-border px-2 py-2 text-xs ${isToday ? "bg-accent-soft" : ""}`}>
                  <span className={`font-semibold uppercase tracking-wide ${isToday ? "text-accent" : "text-muted"}`}>{fmtWeekdayShort(date, lang)}</span>{" "}
                  <span className={isToday ? "font-semibold text-accent" : ""}>{fmtDate(date, lang)}</span>
                </div>
              );
            })}
          </div>

          {/* Deadlines and all-day events sit above the grid so a 23:59 deadline is not lost at the bottom. */}
          <div className="grid grid-cols-[48px_repeat(7,minmax(0,1fr))] border-b border-border">
            <div className="px-1 py-2 text-right text-[10px] uppercase leading-4 text-muted">{t(lang, "week.deadlines").slice(0, 4)}.</div>
            {days.map((key) => {
              const ds = deadlines.filter((x) => dateKey(x.dueAt) === key);
              const allDay = events.filter((e) => e.allDay && dateKey(e.startAt) === key);
              return (
                <div key={key} className="min-h-9 space-y-1 border-l border-border p-1">
                  {allDay.map((e) => (
                    <div key={e.id} className="truncate rounded px-1.5 py-0.5 text-[11px] font-medium" style={{ background: `color-mix(in srgb, ${e.course?.color ?? "var(--muted)"} 16%, var(--surface))` }}>
                      <SourceLink href={e.htmlUrl} provider={e.provider} lang={lang}>{e.title}</SourceLink>
                    </div>
                  ))}
                  {ds.map((x) => {
                    const done = x.state === "submitted" || x.state === "graded";
                    return (
                      <div key={x.id} title={`${x.title} · ${x.course?.shortName ?? ""}`}
                        className={`rounded border px-1.5 py-0.5 text-[11px] leading-4 ${done ? "border-border text-muted line-through" : x.dueAt < now ? "border-danger bg-danger-soft text-danger" : "border-warn bg-warn-soft text-warn"}`}>
                        <div className="truncate font-medium">{x.hasTime && <span className="tnum">{fmtTime(x.dueAt)} </span>}<SourceLink href={x.htmlUrl} provider="canvas" lang={lang}>{x.title}</SourceLink></div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-[48px_repeat(7,minmax(0,1fr))]">
            <div>
              {hours.map((h) => <div key={h} className="tnum pr-1.5 text-right text-[10px] text-muted" style={{ height: HOUR_PX }}><span className="relative -top-1.5">{String(h).padStart(2, "0")}:00</span></div>)}
            </div>
            {days.map((key) => (
              <div key={key} className={`relative border-l border-border ${key === today ? "bg-accent-soft/40" : ""}`} style={{ height: hours.length * HOUR_PX }}>
                {hours.map((h, i) => i > 0 && <div key={h} className="absolute inset-x-0 border-t border-border/60" style={{ top: i * HOUR_PX }} />)}
                {place(byDay(key), fromHour * 60, toHour * 60).map(({ e, top, height, lane, lanes }) => {
                  const color = e.block?.kind === "busy" ? "var(--muted)" : e.course?.color ?? (e.block ? "var(--accent)" : "var(--muted)");
                  const proposed = e.block?.status === "proposed";
                  return (
                    <div key={e.id} title={`${e.title}${e.location ? ` · ${e.location}` : ""}`}
                      className={`absolute overflow-hidden rounded-md px-1.5 py-1 text-[11px] leading-[14px] ${e.block ? "border border-dashed" : "border-l-[3px]"} ${proposed ? "opacity-60" : ""}`}
                      style={{
                        top: top + 1, height: height - 2, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)`,
                        borderColor: color, background: e.block ? `color-mix(in srgb, ${color} 7%, var(--surface))` : `color-mix(in srgb, ${color} 15%, var(--surface))`,
                      }}>
                      <div className="tnum text-muted">{fmtTime(e.startAt)}{e.endAt ? `–${fmtTime(e.endAt)}` : ""}{proposed ? ` · ${t(lang, "blocks.proposed")}` : ""}</div>
                      <div className="font-semibold">{e.block ? <Link href="/plan" className="hover:underline">{e.title}</Link> : <SourceLink href={e.htmlUrl} provider={e.provider} lang={lang}>{e.title}</SourceLink>}</div>
                      {e.location && <div className="truncate text-muted">{e.location}</div>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile: agenda list */}
      <div className="space-y-4 md:hidden">
        {days.map((key) => {
          const es = events.filter((e) => dateKey(e.startAt) === key);
          const ds = deadlines.filter((x) => dateKey(x.dueAt) === key);
          if (!es.length && !ds.length) return null;
          const title = fmtDayLong(startOfDay(key), lang);
          return (
            <Card key={key} title={title.charAt(0).toUpperCase() + title.slice(1)}>
              <ul className="divide-y divide-border">
                {es.map((e) => <EventRow key={e.id} e={e} lang={lang} now={now} />)}
                {ds.map((x) => <DeadlineRow key={x.id} d={x} lang={lang} now={now} />)}
              </ul>
            </Card>
          );
        })}
        {!events.length && !deadlines.length && <Card><Empty>{t(lang, "week.empty")}</Empty></Card>}
      </div>

      {deadlines.length > 0 && (
        <div className="hidden md:block">
          <Card title={t(lang, "week.deadlines")}>
            <ul className="divide-y divide-border">{deadlines.map((x) => <DeadlineRow key={x.id} d={x} lang={lang} now={now} />)}</ul>
          </Card>
        </div>
      )}
    </div>
  );
}
