import { desc, isNotNull } from "drizzle-orm";
import Link from "next/link";
import {
  acceptAllBlocksAction, acceptBlockAction, addBlockAction, clearProposalsAction, createExamPlanAction, deleteEntryAction, deleteExamPlanAction,
  logTimeAction, moveBlockAction, proposeBlocksAction, removeBlockAction, setEstimateAction, startTimerAction,
} from "../actions";
import { Card, CourseTag, Empty } from "@/components/ui";
import { getDb } from "@/lib/db";
import { examPlans, projects, timeEntries, type Block } from "@/lib/db/schema";
import { t } from "@/lib/i18n";
import { WORK_TYPES } from "@/lib/plan/estimate";
import { pickNext, type Energy } from "@/lib/plan/next";
import { collectWork, getBlocks, getMultipliers, getUpcomingExams, getWeekLoads, type WorkItem } from "@/lib/plan/store";
import { getPrefs } from "@/lib/prefs";
import { getCourses } from "@/lib/queries";
import { addDays, dateKey, fmtDate, fmtDay, fmtDayLong, fmtRelative, fmtTime, isoWeek, startOfDay, type Lang } from "@/lib/time";

export const dynamic = "force-dynamic";

const TABS = ["now", "load", "exams", "time"] as const;
type Tab = (typeof TABS)[number];
const btn = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2";
const small = "rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-text";
const primary = "rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-surface";
const field = "rounded-lg border border-border bg-bg px-2 py-1.5 text-sm";

const hours = (min: number, lang: Lang) => new Intl.NumberFormat(lang === "sv" ? "sv-SE" : "en-GB", { maximumFractionDigits: 1 }).format(min / 60);

function StartTimer({ work, lang }: { work: WorkItem; lang: Lang }) {
  return (
    <form action={startTimerAction} className="flex gap-1">
      <input type="hidden" name="key" value={work.key} />
      <button className={small} title={t(lang, "timer.start")}>▶</button>
      <button name="target" value="25" className={small} title={t(lang, "timer.focus", { n: 25 })}>25</button>
      <button name="target" value="50" className={small} title={t(lang, "timer.focus", { n: 50 })}>50</button>
    </form>
  );
}

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ tab?: string; t?: string; e?: string }> }) {
  const { lang } = await getPrefs();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "now";
  const db = getDb();
  const now = new Date();
  const today = dateKey(now);
  const work = collectWork(db, now);
  const courses = [...getCourses(db).values()].filter((c) => !c.hidden && !c.id.startsWith("timeedit:")).sort((a, b) => a.shortName.localeCompare(b.shortName, "sv"));

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">{t(lang, "plan.title")}</h1>
      <div className="flex gap-1 rounded-lg bg-surface-2 p-1 text-sm">
        {TABS.map((k) => (
          <Link key={k} href={k === "now" ? "/plan" : `/plan?tab=${k}`} className={`flex-1 rounded-md px-2 py-1.5 text-center font-medium ${tab === k ? "bg-surface shadow-sm" : "text-muted hover:text-text"}`}>
            {t(lang, `plan.tab.${k}`)}
          </Link>
        ))}
      </div>

      {tab === "now" && <NowTab />}
      {tab === "load" && <LoadTab />}
      {tab === "exams" && <ExamsTab />}
      {tab === "time" && <TimeTab />}
    </div>
  );

  /* ---------- Now: what to do, and the proposed blocks ---------- */
  function NowTab() {
    const available = [15, 30, 60, 120, 180].includes(Number(sp.t)) ? Number(sp.t) : 60;
    const energy: Energy = sp.e === "low" || sp.e === "high" ? sp.e : "medium";
    const picks = pickNext(work.map((w) => ({ key: w.key, title: w.title, courseId: w.course?.id ?? null, type: w.type, remainingMin: w.remainingMin, dueAt: w.dueAt })), { now, availableMin: available, energy });
    const byKey = new Map(work.map((w) => [w.key, w]));
    const upcoming = getBlocks(db, now, startOfDay(addDays(today, 8)));
    const proposed = upcoming.filter((b) => b.status === "proposed");
    const accepted = upcoming.filter((b) => b.status === "accepted");
    // What would not fit: recomputed from the items still unplanned after the current proposals.
    const plannedMin = new Map<string, number>();
    for (const b of upcoming) if (b.workKey && b.kind === "study") plannedMin.set(b.workKey, (plannedMin.get(b.workKey) ?? 0) + (b.endAt.getTime() - b.startAt.getTime()) / 60_000);
    const weekEnd = startOfDay(addDays(today, 7));
    const short = proposed.length > 0 ? work.filter((w) => w.dueAt && w.dueAt > now && w.dueAt < weekEnd && w.type !== "admin" && w.remainingMin - (plannedMin.get(w.key) ?? 0) >= 30) : [];

    const BlockRow = ({ b }: { b: Block }) => (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
        <div className="tnum w-28 shrink-0 text-xs text-muted"><div className="font-medium text-text">{fmtDay(b.startAt, lang)}</div>{fmtTime(b.startAt)}–{fmtTime(b.endAt)}</div>
        <div className="min-w-0 flex-1 basis-40">
          <div className="truncate font-medium">{b.title}</div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <CourseTag course={b.courseId ? getCourses(db).get(b.courseId) ?? null : null} />
            {b.kind === "busy" && <span>{t(lang, "blocks.busy")}</span>}
          </div>
        </div>
        <details className="relative">
          <summary className={`${small} cursor-pointer list-none`}>{t(lang, "blocks.move")}</summary>
          <form action={moveBlockAction.bind(null, b.id)} className="absolute right-0 z-10 mt-1 flex gap-1 rounded-lg border border-border bg-surface p-2 shadow-lg">
            <input type="date" name="date" defaultValue={dateKey(b.startAt)} className={field} />
            <input type="time" name="start" defaultValue={fmtTime(b.startAt)} step={300} className={field} />
            <button className={small}>OK</button>
          </form>
        </details>
        {b.status === "proposed" && <form action={acceptBlockAction.bind(null, b.id)}><button className={`${small} border-accent text-accent`}>{t(lang, "blocks.accept")}</button></form>}
        <form action={removeBlockAction.bind(null, b.id)}><button className={small}>{t(lang, "blocks.reject")}</button></form>
      </li>
    );

    return (
      <>
        <Card title={t(lang, "now.title")}>
          <form method="get" action="/plan" className="flex flex-wrap items-end gap-2 border-b border-border px-4 py-3">
            <label className="text-xs text-muted">{t(lang, "now.time")}<br />
              <select name="t" defaultValue={available} className={field}>{[15, 30, 60, 120, 180].map((n) => <option key={n} value={n}>{n < 60 ? `${n} min` : `${n / 60} h`}</option>)}</select>
            </label>
            <label className="text-xs text-muted">{t(lang, "now.energy")}<br />
              <select name="e" defaultValue={energy} className={field}>{(["low", "medium", "high"] as const).map((e) => <option key={e} value={e}>{t(lang, `now.e.${e}`)}</option>)}</select>
            </label>
            <button className={primary}>{t(lang, "now.go")}</button>
          </form>
          {picks.length === 0 ? <Empty>{t(lang, "now.none")}</Empty> : (
            <ul className="divide-y divide-border">
              {picks.slice(0, 3).map((p, i) => {
                const w = byKey.get(p.candidate.key)!;
                return (
                  <li key={w.key} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${i === 0 ? "bg-accent-soft/50" : ""}`}>
                    <div className="min-w-0 flex-1 basis-56">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t(lang, i === 0 ? "now.pick" : "now.else")}</div>
                      <div className={i === 0 ? "text-base font-semibold" : "font-medium"}>{w.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                        <CourseTag course={w.course} />
                        <span>{t(lang, "now.minutes", { n: p.minutes })}</span>
                        {w.dueAt && <span>· {fmtDay(w.dueAt, lang)} ({fmtRelative(w.dueAt, lang, now)})</span>}
                        {p.reasons.length > 0 && <span>· {p.reasons.map((r) => t(lang, `now.r.${r}`)).join(", ")}</span>}
                      </div>
                    </div>
                    <StartTimer work={w} lang={lang} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title={`${t(lang, "blocks.title")}${proposed.length ? ` (${proposed.length})` : ""}`} hint={t(lang, "blocks.hint")}
          action={<form action={proposeBlocksAction}><button className={primary}>{t(lang, "blocks.propose")}</button></form>}>
          {proposed.length === 0 ? <Empty>{t(lang, "blocks.none")}</Empty> : (
            <>
              <ul className="divide-y divide-border">{proposed.map((b) => <BlockRow key={b.id} b={b} />)}</ul>
              <div className="flex gap-2 border-t border-border px-4 py-3">
                <form action={acceptAllBlocksAction}><button className={primary}>{t(lang, "blocks.acceptAll")}</button></form>
                <form action={clearProposalsAction}><button className={btn}>{t(lang, "blocks.clear")}</button></form>
              </div>
            </>
          )}
          {short.length > 0 && (
            <div className="border-t border-border bg-danger-soft px-4 py-3 text-sm text-danger">
              <p className="font-semibold">{t(lang, "blocks.unplaced")}</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {short.map((w) => <li key={w.key}>{w.title}: {hours(w.remainingMin - (plannedMin.get(w.key) ?? 0), lang)} h · {fmtDay(w.dueAt!, lang)}</li>)}
              </ul>
            </div>
          )}
        </Card>

        <Card title={t(lang, "blocks.accepted")}>
          {accepted.length === 0 ? <Empty>{t(lang, "blocks.noAccepted")}</Empty> : <ul className="divide-y divide-border">{accepted.map((b) => <BlockRow key={b.id} b={b} />)}</ul>}
          <details className="border-t border-border">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-accent">{t(lang, "blocks.add")}</summary>
            <form action={addBlockAction} className="flex flex-wrap items-end gap-2 px-4 pb-4">
              <input name="title" required placeholder={t(lang, "blocks.what")} className={`${field} min-w-0 flex-1 basis-48`} />
              <select name="kind" className={field} aria-label={t(lang, "tasks.f.kind")}><option value="busy">{t(lang, "blocks.kind.busy")}</option><option value="study">{t(lang, "blocks.kind.study")}</option></select>
              <input type="date" name="date" required defaultValue={today} className={field} aria-label={t(lang, "tasks.f.date")} />
              <label className="text-xs text-muted">{t(lang, "blocks.from")}<br /><input type="time" name="from" required defaultValue="17:00" step={300} className={field} /></label>
              <label className="text-xs text-muted">{t(lang, "blocks.to")}<br /><input type="time" name="to" required defaultValue="21:00" step={300} className={field} /></label>
              <button className={btn}>{t(lang, "capture.add")}</button>
            </form>
          </details>
        </Card>
      </>
    );
  }

  /* ---------- Workload heatmap ---------- */
  function LoadTab() {
    const weeks = getWeekLoads(db, now, 8);
    const cs = getCourses(db);
    const scale = Math.max(1, ...weeks.map((w) => Math.max(w.studyMin, w.capacityMin)));
    const projectNames = new Map(db.select({ id: projects.id, title: projects.title }).from(projects).all().map((p) => [`project:${p.id}`, p.title]));
    const label = (id: string) => cs.get(id)?.shortName ?? projectNames.get(id) ?? t(lang, "load.other");
    const color = (id: string) => cs.get(id)?.color ?? (projectNames.has(id) ? "#8b5cf6" : "var(--muted)");
    return (
      <Card title={t(lang, "load.title")} hint={t(lang, "load.hint")}>
        <ul className="divide-y divide-border">
          {weeks.map((w) => {
            const over = w.crunch;
            const tone = over ? "var(--danger)" : w.ratio > 0.6 ? "var(--warn)" : "var(--ok)";
            return (
              <li key={w.monday} className="grid grid-cols-[4.5rem_1fr] items-center gap-3 px-4 py-3 sm:grid-cols-[6rem_1fr_9rem]">
                <div>
                  <div className="font-semibold">{t(lang, "today.week", { n: isoWeek(w.monday).week })}</div>
                  <div className="text-xs text-muted">{fmtDate(startOfDay(w.monday), lang)}</div>
                </div>
                <div className="min-w-0">
                  <div className="relative h-5 rounded bg-surface-2">
                    <div className="flex h-5 overflow-hidden rounded" style={{ width: `${(w.studyMin / scale) * 100}%` }}>
                      {[...w.byCourse].sort((a, b) => b[1] - a[1]).map(([id, min]) => (
                        <div key={id} title={`${label(id)}: ${hours(min, lang)} h`} style={{ width: `${(min / w.studyMin) * 100}%`, background: color(id) }} />
                      ))}
                    </div>
                    {/* the line marks how much free study time the week has */}
                    <div className="absolute inset-y-[-3px] w-0.5 bg-text" style={{ left: `${(w.capacityMin / scale) * 100}%` }} title={`${t(lang, "load.free")}: ${hours(w.capacityMin, lang)} h`} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                    {[...w.byCourse].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, min]) => (
                      <span key={id} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: color(id) }} />{label(id)} {hours(min, lang)} h</span>
                    ))}
                  </div>
                </div>
                <div className="col-span-2 text-xs sm:col-span-1 sm:text-right">
                  <div className="font-semibold" style={{ color: tone }}>{hours(w.studyMin, lang)} / {hours(w.capacityMin, lang)} h{over ? ` · ${t(lang, "load.crunch")}` : ""}</div>
                  <div className="text-muted">{t(lang, "load.classes")} {hours(w.classMin, lang)} h</div>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-border px-4 py-2 text-xs text-muted">{t(lang, "load.study")} / {t(lang, "load.free").toLowerCase()} · <Link href="/settings" className="text-accent hover:underline">{t(lang, "ps.title")}</Link></p>
      </Card>
    );
  }

  /* ---------- Exams ---------- */
  function ExamsTab() {
    const exams = getUpcomingExams(db, now);
    const plans = db.select().from(examPlans).orderBy(examPlans.examAt).all().filter((p) => p.examAt > now);
    const planBlocks = getBlocks(db, now, new Date(now.getTime() + 200 * 86_400_000)).filter((b) => b.source === "exam");
    const PlanForm = ({ title, date, time, courseId }: { title: string; date: string; time: string; courseId: string }) => (
      <form action={createExamPlanAction} className="grid gap-2 px-4 pb-4 sm:grid-cols-4">
        <label className="text-xs text-muted sm:col-span-2">{t(lang, "exam.name")}<input name="title" required defaultValue={title} className={`${field} w-full`} /></label>
        <label className="text-xs text-muted">{t(lang, "exam.date")}<input type="date" name="date" required defaultValue={date} className={`${field} w-full`} /></label>
        <label className="text-xs text-muted">{t(lang, "tasks.f.time")}<input type="time" name="time" defaultValue={time} className={`${field} w-full`} /></label>
        <label className="text-xs text-muted sm:col-span-2 sm:row-span-2">{t(lang, "exam.topics")}<textarea name="topics" rows={5} className={`${field} w-full`} /></label>
        <label className="text-xs text-muted">{t(lang, "exam.oldExams")}<input type="number" name="oldExams" min={0} max={20} defaultValue={3} className={`${field} w-full`} /></label>
        <label className="text-xs text-muted">{t(lang, "exam.buffer")}<input type="number" name="bufferDays" min={0} max={7} defaultValue={2} className={`${field} w-full`} /></label>
        <label className="text-xs text-muted sm:col-span-2">{t(lang, "tasks.f.course")}
          <select name="course" defaultValue={courseId} className={`${field} w-full`}><option value="">{t(lang, "tasks.f.noCourse")}</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.shortName}</option>)}</select>
        </label>
        <div className="sm:col-span-4"><button className={primary}>{t(lang, "exam.plan")}</button></div>
      </form>
    );
    return (
      <>
        <Card title={t(lang, "exam.upcoming")} hint={t(lang, "exam.hint")}>
          {exams.length === 0 && <Empty>{t(lang, "exam.none")}</Empty>}
          <ul className="divide-y divide-border">
            {exams.map((e) => (
              <li key={e.id}>
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3">
                    <div className="tnum w-28 shrink-0 text-xs text-muted"><div className="font-medium text-text">{fmtDay(e.startAt, lang)}</div>{fmtTime(e.startAt)} · {fmtRelative(e.startAt, lang, now)}</div>
                    <div className="min-w-0 flex-1"><div className="font-medium">{e.title}</div><div className="text-xs text-muted">{e.location}</div></div>
                    <span className={small}>{t(lang, "exam.plan")}</span>
                  </summary>
                  <PlanForm title={e.title} date={dateKey(e.startAt)} time={fmtTime(e.startAt)} courseId={e.course?.id ?? ""} />
                </details>
              </li>
            ))}
            <li>
              <details>
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-accent">{t(lang, "exam.manual")}</summary>
                <PlanForm title="" date={addDays(today, 21)} time="08:00" courseId="" />
              </details>
            </li>
          </ul>
        </Card>
        {plans.length > 0 && (
          <Card title={t(lang, "exam.plans")}>
            <ul className="divide-y divide-border">
              {plans.map((p) => {
                const mine = planBlocks.filter((b) => b.planId === p.id);
                const total = mine.reduce((n, b) => n + (b.endAt.getTime() - b.startAt.getTime()) / 60_000, 0);
                return (
                  <li key={p.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div><span className="font-semibold">{p.title}</span> <span className="text-xs text-muted">· {fmtDayLong(p.examAt, lang)} · {t(lang, "exam.sessions", { n: mine.length, h: hours(total, lang) })}</span></div>
                      <form action={deleteExamPlanAction.bind(null, p.id)}><button className={`${small} text-danger`}>{t(lang, "exam.delete")}</button></form>
                    </div>
                    <ol className="mt-2 space-y-0.5 text-xs">
                      {mine.map((b) => (
                        <li key={b.id} className="flex gap-3"><span className="tnum w-36 shrink-0 text-muted">{fmtDay(b.startAt, lang)} {fmtTime(b.startAt)}–{fmtTime(b.endAt)}</span><span className={b.status === "proposed" ? "text-muted" : ""}>{b.title.replace(`${p.title} · `, "")}{b.status === "proposed" ? ` (${t(lang, "blocks.proposed")})` : ""}</span></li>
                      ))}
                    </ol>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </>
    );
  }

  /* ---------- Time & estimates ---------- */
  function TimeTab() {
    const mult = getMultipliers(db, now);
    const cs = getCourses(db);
    const entries = db.select().from(timeEntries).where(isNotNull(timeEntries.endedAt)).orderBy(desc(timeEntries.startedAt)).limit(12).all();
    const sorted = [...work].sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity));
    return (
      <>
        <Card title={t(lang, "est.title")} hint={t(lang, "est.hint")}>
          {sorted.length === 0 ? <Empty>{t(lang, "est.none")}</Empty> : (
            <ul className="divide-y divide-border">
              {sorted.map((w) => (
                <li key={w.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
                  <div className="min-w-0 flex-1 basis-52">
                    <div className="truncate font-medium">{w.title}</div>
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      <CourseTag course={w.course} />
                      {w.dueAt && <span>{fmtDay(w.dueAt, lang)}</span>}
                      <span>· {t(lang, "est.logged")} {hours(w.loggedMin, lang)} h · {t(lang, "est.left")} {hours(w.remainingMin, lang)} h{w.factor !== 1 ? ` (×${w.factor})` : ""}</span>
                    </div>
                  </div>
                  <form action={setEstimateAction.bind(null, w.key)} className="flex items-center gap-1">
                    <select name="type" defaultValue={w.type} className={`${field} max-w-36 text-xs`} aria-label={t(lang, "tasks.f.kind")}>{WORK_TYPES.map((k) => <option key={k} value={k}>{t(lang, `wt.${k}`)}</option>)}</select>
                    <input name="hours" inputMode="decimal" defaultValue={w.own ? hours(w.estimateMin, lang) : ""} placeholder={hours(w.estimateMin, lang)} aria-label={t(lang, "est.estimate")} className={`${field} w-14 text-right`} />
                    <span className="text-xs text-muted">h</span>
                    <button className={small}>{t(lang, "tasks.save")}</button>
                  </form>
                  <StartTimer work={w} lang={lang} />
                </li>
              ))}
            </ul>
          )}
          {sorted.length > 0 && (
            <details className="border-t border-border">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-accent">{t(lang, "est.addLog")}</summary>
              <form action={logTimeAction} className="flex flex-wrap gap-2 px-4 pb-4">
                <select name="key" className={`${field} min-w-0 flex-1 basis-56`}>{sorted.map((w) => <option key={w.key} value={w.key}>{w.title}</option>)}</select>
                <input name="minutes" type="number" min={1} max={1440} required placeholder={t(lang, "est.minutes")} className={`${field} w-24`} />
                <button className={btn}>{t(lang, "capture.add")}</button>
              </form>
            </details>
          )}
        </Card>

        <Card title={t(lang, "est.mult")} hint={t(lang, "est.multHint")}>
          {mult.byCourseType.size + mult.byType.size === 0 ? <Empty>{t(lang, "est.multNone")}</Empty> : (
            <ul className="divide-y divide-border text-sm">
              {[...mult.byCourseType].map(([k, v]) => {
                const [courseId, type] = k.split("|");
                return <li key={k} className="flex justify-between gap-3 px-4 py-2"><span>{cs.get(courseId)?.shortName ?? courseId} · {t(lang, `wt.${type as "other"}`)}</span><span className="tnum font-semibold">×{v.factor} <span className="font-normal text-muted">({t(lang, "est.samples", { n: v.n })})</span></span></li>;
              })}
              {[...mult.byType].map(([k, v]) => <li key={k} className="flex justify-between gap-3 px-4 py-2"><span>{t(lang, `wt.${k}`)}</span><span className="tnum font-semibold">×{v.factor} <span className="font-normal text-muted">({t(lang, "est.samples", { n: v.n })})</span></span></li>)}
            </ul>
          )}
        </Card>

        <Card title={t(lang, "est.log")}>
          {entries.length === 0 ? <Empty>{t(lang, "est.logNone")}</Empty> : (
            <ul className="divide-y divide-border text-sm">
              {entries.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2">
                  <span className="tnum w-28 shrink-0 text-xs text-muted">{fmtDay(e.startedAt, lang)} {fmtTime(e.startedAt)}</span>
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                  <span className="tnum font-medium">{Math.round((e.endedAt!.getTime() - e.startedAt.getTime()) / 60_000)} {t(lang, "est.minutes")}</span>
                  <form action={deleteEntryAction.bind(null, e.id)}><button className={small} aria-label={t(lang, "tasks.delete")}>×</button></form>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </>
    );
  }
}
