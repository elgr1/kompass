import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import Link from "next/link";
import { Card } from "@/components/ui";
import { getDb } from "@/lib/db";
import { careerEvents, items, milestones, projects } from "@/lib/db/schema";
import { t } from "@/lib/i18n";
import { getPrefs } from "@/lib/prefs";
import { getCourses, getDeadlines } from "@/lib/queries";
import { addDays, dateKey, fmtDate, isDateKey, isoWeek, mondayOf, startOfDay } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Uppsala's academic year has two semesters of two periods each. The exact dates move a
 * little every year, so these are approximations: autumn = September to mid-January,
 * spring = mid-January to early June, with the period boundary roughly halfway.
 */
function semesterOf(day: string): { start: string; end: string; split: string; first: number; label: string } {
  const y = Number(day.slice(0, 4));
  const md = day.slice(5);
  if (md >= "08-25") return { start: `${y}-08-31`, end: `${y + 1}-01-17`, split: `${y}-11-01`, first: 1, label: `HT${y}` };
  if (md <= "01-17") return { start: `${y - 1}-08-31`, end: `${y}-01-17`, split: `${y - 1}-11-01`, first: 1, label: `HT${y - 1}` };
  return { start: `${y}-01-18`, end: `${y}-06-07`, split: `${y}-03-23`, first: 3, label: `VT${y}` };
}

type Mark = { kind: "I" | "L" | "T" | "M" | "K"; title: string; done?: boolean; href?: string | null };

export default async function SemesterPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { lang } = await getPrefs();
  const sp = await searchParams;
  const db = getDb();
  const now = new Date();
  const today = dateKey(now);
  const sem = semesterOf(isDateKey(sp.d) ? sp.d : today);
  const first = mondayOf(sem.start);
  const weeks: string[] = [];
  for (let m = first; m <= sem.end; m = addDays(m, 7)) weeks.push(m);
  const from = startOfDay(first);
  const to = startOfDay(addDays(weeks[weeks.length - 1], 7));
  const weekOf = (d: Date) => mondayOf(dateKey(d));
  const cs = getCourses(db);

  // rows: one per visible course that has anything in the semester, then own tasks, projects, career
  const rows = new Map<string, { label: string; color: string; href: string | null; sessions: Map<string, number>; marks: Map<string, Mark[]> }>();
  const row = (key: string, label: string, color: string, href: string | null) => {
    let r = rows.get(key);
    if (!r) rows.set(key, (r = { label, color, href, sessions: new Map(), marks: new Map() }));
    return r;
  };
  const mark = (r: ReturnType<typeof row>, week: string, m: Mark) => r.marks.set(week, [...(r.marks.get(week) ?? []), m]);
  const courseRow = (id: string | null | undefined) => {
    const c = id ? cs.get(id) : undefined;
    return c && !c.hidden ? row(c.id, c.shortName, c.color, `/courses/${encodeURIComponent(c.id)}`) : null;
  };

  for (const e of db.select().from(items).where(and(inArray(items.kind, ["schedule_event", "calendar_event"]), isNull(items.deletedAt), gte(items.startAt, from), lt(items.startAt, to))).all()) {
    const r = courseRow(e.courseId);
    if (!r || !e.startAt || e.allDay) continue;
    const w = weekOf(e.startAt);
    const activity = `${e.title} ${String(e.fields.activity ?? "")}`;
    if (/tentamen|omtenta|\bexam/i.test(activity)) mark(r, w, { kind: "T", title: `${e.title} · ${fmtDate(e.startAt, lang)}` });
    else if (/lab/i.test(activity)) {
      if (!(r.marks.get(w) ?? []).some((m) => m.kind === "L")) mark(r, w, { kind: "L", title: e.title });
      r.sessions.set(w, (r.sessions.get(w) ?? 0) + 1);
    } else r.sessions.set(w, (r.sessions.get(w) ?? 0) + 1);
  }
  const own = { label: t(lang, "sem.own"), color: "var(--accent)" };
  for (const d of getDeadlines(db, from, to, now)) {
    const r = d.origin === "source" ? courseRow(d.course?.id) : d.course ? courseRow(d.course.id) : row("own", own.label, own.color, "/tasks");
    if (r) mark(r, weekOf(d.dueAt), { kind: "I", title: `${d.title} · ${fmtDate(d.dueAt, lang)}`, done: d.state === "submitted" || d.state === "graded", href: d.htmlUrl });
  }
  const inRange = (k: string | null): k is string => k !== null && k >= first && k <= dateKey(new Date(to.getTime() - 1));
  for (const p of db.select().from(projects).all()) {
    for (const m of db.select().from(milestones).where(eq(milestones.projectId, p.id)).all()) {
      if (inRange(m.dueDate)) mark(row("projects", t(lang, "sem.projects"), "#8b5cf6", "/projects"), mondayOf(m.dueDate), { kind: "M", title: `${p.title}: ${m.title} · ${fmtDate(startOfDay(m.dueDate), lang)}`, done: m.done, href: `/projects/${p.id}` });
    }
  }
  for (const e of db.select().from(careerEvents).all()) {
    if (inRange(e.startDate)) mark(row("career", t(lang, "sem.career"), "#0891b2", "/career?tab=events"), mondayOf(e.startDate), { kind: "K", title: `${e.title} · ${fmtDate(startOfDay(e.startDate), lang)}`, href: e.url });
  }

  const list = [...rows.values()].filter((r) => r.sessions.size + r.marks.size > 0);
  const maxSessions = Math.max(1, ...list.flatMap((r) => [...r.sessions.values()]));
  const thisWeek = mondayOf(today);
  const splitWeek = mondayOf(sem.split);
  const CHIP: Record<Mark["kind"], string> = { I: "border-warn bg-warn-soft text-warn", L: "border-border bg-surface-2 text-text", T: "border-danger bg-danger-soft text-danger", M: "border-border bg-surface-2 text-text", K: "border-accent bg-accent-soft text-accent" };
  const cols = `minmax(9rem, 12rem) repeat(${weeks.length}, minmax(2.6rem, 1fr))`;
  const btn = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t(lang, "sem.title")} <span className="font-normal text-muted">{sem.label}</span></h1>
          <p className="mt-0.5 max-w-3xl text-sm text-muted">{t(lang, "sem.hint")}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/semester?d=${addDays(sem.start, -30)}`} className={btn} aria-label={t(lang, "sem.prev")}>←</Link>
          <Link href="/semester" className={btn}>{t(lang, "tasks.today")}</Link>
          <Link href={`/semester?d=${addDays(sem.end, 30)}`} className={btn} aria-label={t(lang, "sem.next")}>→</Link>
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <div style={{ minWidth: `${12 + weeks.length * 2.8}rem` }}>
            <div className="grid border-b border-border text-[11px] text-muted" style={{ gridTemplateColumns: cols }}>
              <div className="px-3 py-1.5" />
              {weeks.map((w) => (
                <div key={w} className={`border-l px-1 py-1.5 text-center ${w === splitWeek ? "border-l-2 border-text" : "border-border"} ${w === thisWeek ? "bg-accent-soft font-semibold text-accent" : ""}`} title={fmtDate(startOfDay(w), lang)}>
                  {w === first || w === splitWeek ? <div className="font-semibold text-text">{t(lang, "sem.period", { n: w === first ? sem.first : sem.first + 1 })}</div> : <div>&nbsp;</div>}
                  {isoWeek(w).week}
                </div>
              ))}
            </div>
            {list.map((r) => (
              <div key={r.label} className="grid border-b border-border last:border-0" style={{ gridTemplateColumns: cols }}>
                <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                  {r.href ? <Link href={r.href} className="truncate hover:text-accent hover:underline">{r.label}</Link> : <span className="truncate">{r.label}</span>}
                </div>
                {weeks.map((w) => {
                  const n = r.sessions.get(w) ?? 0;
                  return (
                    <div key={w} className={`flex min-h-12 flex-col items-center gap-0.5 border-l px-0.5 py-1 ${w === splitWeek ? "border-l-2 border-text" : "border-border"} ${w === thisWeek ? "bg-accent-soft/50" : ""}`}
                      style={n ? { background: `color-mix(in srgb, ${r.color} ${Math.round(6 + (n / maxSessions) * 22)}%, transparent)` } : undefined}>
                      {n > 0 && <span className="tnum text-[10px] text-muted">{n}</span>}
                      {(r.marks.get(w) ?? []).map((m, i) => {
                        const chip = <span className={`block rounded border px-1 text-[10px] font-bold leading-4 ${CHIP[m.kind]} ${m.done ? "opacity-45 line-through" : ""}`}>{m.kind}</span>;
                        return m.href ? <a key={i} href={m.href} title={m.title} {...(m.href.startsWith("/") ? {} : { target: "_blank", rel: "noreferrer noopener" })}>{chip}</a> : <span key={i} title={m.title}>{chip}</span>;
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
