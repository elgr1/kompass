import Link from "next/link";
import {
  addStudiumCourseAction, deleteDegreeCourseAction, deleteExamAction, importLadokAction, saveDegreeCourseAction, saveExamAction, setDegreeTargetAction,
} from "../actions";
import { Card, CourseTag, Empty } from "@/components/ui";
import { getDb } from "@/lib/db";
import { courses as coursesTable, degreeCourses, exams, type DegreeCourse, type Exam } from "@/lib/db/schema";
import { isPass } from "@/lib/degree/ladok";
import { fmtHp, missingPrereqs, summarize, termOrder } from "@/lib/degree/summary";
import { t } from "@/lib/i18n";
import { getUpcomingExams } from "@/lib/plan/store";
import { getPrefs } from "@/lib/prefs";
import { getCourses } from "@/lib/queries";
import { getSetting } from "@/lib/settings";
import { addDays, dateKey, fmtDate, fmtDay, fmtRelative, fmtTime, startOfDay, type Lang } from "@/lib/time";

export const dynamic = "force-dynamic";
const field = "rounded-lg border border-border bg-bg px-2 py-1.5 text-sm";
const btn = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2";
const primary = "rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-surface";
const STATUSES = ["done", "ongoing", "planned"] as const;

function CourseForm({ c, lang }: { c: DegreeCourse | null; lang: Lang }) {
  return (
    <form action={saveDegreeCourseAction.bind(null, c?.id ?? null)} className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-6">
      <label className="text-xs text-muted">{t(lang, "deg.code")}<input name="code" defaultValue={c?.code ?? ""} className={`${field} w-full`} /></label>
      <label className="col-span-2 text-xs text-muted sm:col-span-3">{t(lang, "deg.name")}<input name="name" required defaultValue={c?.name ?? ""} className={`${field} w-full`} /></label>
      <label className="text-xs text-muted">{t(lang, "deg.hp")}<input name="hp" inputMode="decimal" defaultValue={c ? fmtHp(c.hp, lang) : ""} className={`${field} w-full`} /></label>
      <label className="text-xs text-muted">{t(lang, "deg.grade")}<input name="grade" defaultValue={c?.grade ?? ""} className={`${field} w-full`} /></label>
      <label className="text-xs text-muted">{t(lang, "deg.status")}<select name="status" defaultValue={c?.status ?? "planned"} className={`${field} w-full`}>{STATUSES.map((s) => <option key={s} value={s}>{t(lang, `deg.${s}`)}</option>)}</select></label>
      <label className="text-xs text-muted">{t(lang, "deg.term")}<input name="term" defaultValue={c?.term ?? ""} placeholder="VT2027" className={`${field} w-full`} /></label>
      <label className="col-span-2 text-xs text-muted">{t(lang, "deg.category")}<input name="category" defaultValue={c?.category ?? ""} list="deg-categories" className={`${field} w-full`} /></label>
      <label className="col-span-2 text-xs text-muted">{t(lang, "deg.prereq")}<input name="prereq" defaultValue={c?.prereq ?? ""} placeholder="1FA535, 1MA209" className={`${field} w-full`} /></label>
      <div className="col-span-2 flex gap-2 sm:col-span-6">
        <button className={primary}>{t(lang, "tasks.save")}</button>
        {c && <button formAction={deleteDegreeCourseAction.bind(null, c.id)} formNoValidate className={`${btn} text-danger`}>{t(lang, "tasks.delete")}</button>}
      </div>
    </form>
  );
}

export default async function DegreePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { lang } = await getPrefs();
  const tab = (await searchParams).tab === "exams" ? "exams" : "progress";
  const db = getDb();
  const now = new Date();
  const today = dateKey(now);
  const cs = getCourses(db);
  let body: React.ReactNode;

  if (tab === "progress") {
    const list = db.select().from(degreeCourses).all();
    const target = Number(getSetting(db, "degree_target") ?? 3000);
    const s = summarize(list, target);
    const passed = new Set(list.filter((c) => c.status === "done" && c.code).map((c) => c.code!.toUpperCase()));
    const known = new Set(list.map((c) => c.code).filter(Boolean));
    const missingFromStudium = db.select().from(coursesTable).all().filter((c) => c.active && !c.hidden && c.provider !== "timeedit" && c.code && !known.has(c.code));
    const last = (() => { try { return JSON.parse(getSetting(db, "ladok_last") ?? "null") as { added: number; updated: number; skipped: number } | null; } catch { return null; } })();
    const pct = (x: number) => `${Math.min(100, (x / Math.max(1, target)) * 100)}%`;
    const groups = STATUSES.map((st) => ({ st, rows: list.filter((c) => c.status === st).sort((a, b) => termOrder(a.term ?? "") - termOrder(b.term ?? "") || (a.date ?? "").localeCompare(b.date ?? "") || a.name.localeCompare(b.name, "sv")) }));
    const categories = [...new Set(list.map((c) => c.category).filter(Boolean))];
    const Stat = ({ label, value, tone }: { label: string; value: number; tone: string }) => (
      <div><div className="text-xs text-muted">{label}</div><div className="tnum text-xl font-semibold" style={{ color: tone }}>{fmtHp(value, lang)} <span className="text-xs font-normal text-muted">{t(lang, "deg.hp")}</span></div></div>
    );
    body = (
      <>
        <datalist id="deg-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        <Card>
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap gap-x-8 gap-y-2">
                <Stat label={t(lang, "deg.done")} value={s.done} tone="var(--ok)" />
                <Stat label={t(lang, "deg.ongoing")} value={s.ongoing} tone="var(--accent)" />
                <Stat label={t(lang, "deg.planned")} value={s.planned} tone="var(--warn)" />
                <Stat label={t(lang, "deg.unplanned")} value={s.unplanned} tone="var(--muted)" />
              </div>
              <form action={setDegreeTargetAction} className="flex items-end gap-1.5">
                <label className="text-xs text-muted">{t(lang, "deg.target")}<br /><input name="target" inputMode="decimal" defaultValue={fmtHp(target, lang)} className={`${field} w-20 text-right`} /></label>
                <button className={btn}>{t(lang, "tasks.save")}</button>
              </form>
            </div>
            <div className="flex h-4 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${fmtHp(s.done, lang)} / ${fmtHp(target, lang)}`}>
              <div style={{ width: pct(s.done), background: "var(--ok)" }} /><div style={{ width: pct(s.ongoing), background: "var(--accent)" }} /><div style={{ width: pct(s.planned), background: "var(--warn)", opacity: 0.6 }} />
            </div>
          </div>
          {(s.byCategory.length > 1 || s.byTerm.length > 0) && (
            <div className="grid gap-x-8 gap-y-4 border-t border-border p-4 text-sm sm:grid-cols-2">
              {[{ title: t(lang, "deg.byCategory"), rows: s.byCategory.map((c) => ({ k: c.category || t(lang, "deg.noCategory"), ...c })) }, { title: t(lang, "deg.byTerm"), rows: s.byTerm.map((c) => ({ k: c.term, ...c })) }].map((g) => (
                <div key={g.title}>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</h3>
                  <ul className="space-y-1">
                    {g.rows.map((r) => <li key={r.k} className="flex justify-between gap-3"><span className="truncate">{r.k}</span><span className="tnum shrink-0 text-muted"><span className="font-medium text-text">{fmtHp(r.done, lang)}</span>{r.ongoing ? ` + ${fmtHp(r.ongoing, lang)}` : ""}{r.planned ? ` + (${fmtHp(r.planned, lang)})` : ""}</span></li>)}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>

        {missingFromStudium.length > 0 && (
          <Card title={t(lang, "deg.fromStudium")}>
            <ul className="flex flex-wrap gap-2 p-4">
              {missingFromStudium.map((c) => <li key={c.id}><form action={addStudiumCourseAction.bind(null, c.id)}><button className={btn}>+ {c.shortName} <span className="text-xs text-muted">{c.code}</span></button></form></li>)}
            </ul>
          </Card>
        )}

        <Card title={`${t(lang, "deg.courses")} (${list.length})`}>
          {list.length === 0 && <Empty>{t(lang, "deg.none")}</Empty>}
          {groups.filter((g) => g.rows.length).map((g) => (
            <section key={g.st}>
              <h3 className="border-b border-border bg-surface-2/60 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{t(lang, `deg.${g.st}`)} · {fmtHp(g.rows.reduce((n, c) => n + c.hp, 0), lang)} {t(lang, "deg.hp")}</h3>
              <ul className="divide-y divide-border">
                {g.rows.map((c) => {
                  const miss = c.status !== "done" ? missingPrereqs(c, passed) : [];
                  return (
                    <li key={c.id}>
                      <details>
                        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 px-4 py-2">
                          <span className="tnum w-16 shrink-0 text-xs text-muted">{c.code ?? ""}</span>
                          <span className="min-w-0 flex-1 basis-40 font-medium">{c.name}{c.category && <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-normal text-muted">{c.category}</span>}</span>
                          {miss.length > 0 && <span className="text-xs font-medium text-danger">{t(lang, "deg.missing", { codes: miss.join(", ") })}</span>}
                          <span className="text-xs text-muted">{c.term ?? (c.date ? c.date.slice(0, 7) : "")}</span>
                          <span className={`tnum w-10 text-right text-sm ${c.grade && !isPass(c.grade) ? "text-danger" : ""}`}>{c.grade ?? ""}</span>
                          <span className={`tnum w-16 text-right text-sm font-semibold ${c.hp === 0 ? "text-warn" : ""}`}>{c.hp === 0 ? t(lang, "deg.setHp") : fmtHp(c.hp, lang)}</span>
                        </summary>
                        <CourseForm c={c} lang={lang} />
                      </details>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <details className="border-t border-border">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-accent">{t(lang, "deg.add")}</summary>
            <CourseForm c={null} lang={lang} />
          </details>
        </Card>

        <Card title={t(lang, "deg.import")} hint={t(lang, "deg.importHint")}>
          <form action={importLadokAction} className="space-y-2 p-4">
            <textarea name="text" required rows={6} className={`${field} w-full font-mono text-xs`} placeholder={"1FA102\tMekanik II\t5,0\t4\t2025-01-17"} />
            <div className="flex flex-wrap items-center gap-3">
              <button className={btn}>{t(lang, "deg.importGo")}</button>
              {last && <span className="text-xs text-muted">{t(lang, "deg.importLast", last)}</span>}
            </div>
          </form>
        </Card>
      </>
    );
  } else {
    const mine = db.select().from(exams).all();
    const bySource = new Map(mine.filter((e) => e.sourceItemId).map((e) => [e.sourceItemId!, e]));
    type Row = { key: string; title: string; examAt: Date; location: string | null; courseId: string | null; sourceItemId: string | null; saved: Exam | null };
    const rows: Row[] = [
      ...getUpcomingExams(db, new Date(now.getTime() - 86_400_000)).map((e) => ({ key: e.id, title: e.title, examAt: e.startAt, location: e.location, courseId: e.course?.id ?? null, sourceItemId: e.id, saved: bySource.get(e.id) ?? null })),
      ...mine.filter((e) => !e.sourceItemId || e.examAt < now).filter((e) => !(e.sourceItemId && e.examAt >= now)).map((e) => ({ key: `own:${e.id}`, title: e.title, examAt: e.examAt, location: null, courseId: e.courseId, sourceItemId: e.sourceItemId, saved: e })),
    ].sort((a, b) => a.examAt.getTime() - b.examAt.getTime());
    const upcoming = rows.filter((r) => r.examAt >= now);
    const past = rows.filter((r) => r.examAt < now).reverse();
    const courseList = [...cs.values()].filter((c) => !c.hidden && !c.id.startsWith("timeedit:")).sort((a, b) => a.shortName.localeCompare(b.shortName, "sv"));

    const ExamRow = ({ r }: { r: Row }) => {
      const e = r.saved;
      const suggestion = addDays(dateKey(r.examAt), -12);
      const state = e?.registered ? { text: t(lang, "exr.registered"), cls: "bg-ok-soft text-ok" }
        : e?.regDeadline ? { text: `${t(lang, "exr.notRegistered")} · ${fmtDate(startOfDay(e.regDeadline), lang)}`, cls: e.regDeadline < today ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn" }
        : { text: t(lang, "exr.noDeadline"), cls: "bg-surface-2 text-muted" };
      return (
        <li>
          <details>
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <div className="tnum w-28 shrink-0 text-xs text-muted"><div className="font-medium text-text">{fmtDay(r.examAt, lang)}</div>{fmtTime(r.examAt)} · {fmtRelative(r.examAt, lang, now)}</div>
              <div className="min-w-0 flex-1 basis-48">
                <div className="font-medium">{r.title}{e?.retake && <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-normal text-muted">{t(lang, "exr.retake")}</span>}</div>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted"><CourseTag course={r.courseId ? cs.get(r.courseId) ?? null : null} />{r.location}</div>
              </div>
              {e?.result ? <span className="tnum text-sm font-semibold">{e.result}</span> : r.examAt >= now && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${state.cls}`}>{state.text}</span>}
            </summary>
            <form action={saveExamAction} className="grid grid-cols-2 gap-2 px-4 pb-4 sm:grid-cols-4">
              <input type="hidden" name="id" value={e?.id ?? ""} />
              <input type="hidden" name="sourceItemId" value={r.sourceItemId ?? ""} />
              <input type="hidden" name="course" value={r.courseId ?? ""} />
              <input type="hidden" name="title" value={r.title} />
              <input type="hidden" name="date" value={dateKey(r.examAt)} />
              <input type="hidden" name="time" value={fmtTime(r.examAt)} />
              <label className="col-span-2 text-xs text-muted">{t(lang, "exr.reg")}<input type="date" name="regDeadline" defaultValue={e?.regDeadline ?? ""} className={`${field} w-full`} />
                {!e?.regDeadline && r.examAt >= now && <span className="mt-0.5 block">{t(lang, "exr.suggest", { date: fmtDate(startOfDay(suggestion), lang) })}</span>}
              </label>
              <label className="text-xs text-muted">{t(lang, "exr.result")}<input name="result" defaultValue={e?.result ?? ""} className={`${field} w-full`} /></label>
              <div className="flex flex-col justify-end gap-1 text-sm">
                <label className="inline-flex items-center gap-1.5"><input type="checkbox" name="registered" defaultChecked={e?.registered ?? false} />{t(lang, "exr.registered")}</label>
                <label className="inline-flex items-center gap-1.5"><input type="checkbox" name="retake" defaultChecked={e?.retake ?? false} />{t(lang, "exr.retake")}</label>
              </div>
              <div className="col-span-2 flex gap-2 sm:col-span-4">
                <button className={primary}>{t(lang, "tasks.save")}</button>
                {e && <button formAction={deleteExamAction.bind(null, e.id)} className={`${btn} text-danger`}>{t(lang, "tasks.delete")}</button>}
              </div>
            </form>
          </details>
        </li>
      );
    };

    body = (
      <>
        <Card title={t(lang, "exr.title")} hint={t(lang, "exr.hint")}>
          {upcoming.length === 0 ? <Empty>{t(lang, "exr.none")}</Empty> : <ul className="divide-y divide-border">{upcoming.map((r) => <ExamRow key={r.key} r={r} />)}</ul>}
          <details className="border-t border-border">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-accent">{t(lang, "exr.add")}</summary>
            <form action={saveExamAction} className="grid grid-cols-2 gap-2 px-4 pb-4 sm:grid-cols-4">
              <label className="col-span-2 text-xs text-muted">{t(lang, "exam.name")}<input name="title" required className={`${field} w-full`} /></label>
              <label className="text-xs text-muted">{t(lang, "exam.date")}<input type="date" name="date" required className={`${field} w-full`} /></label>
              <label className="text-xs text-muted">{t(lang, "tasks.f.time")}<input type="time" name="time" defaultValue="08:00" className={`${field} w-full`} /></label>
              <label className="col-span-2 text-xs text-muted">{t(lang, "tasks.f.course")}<select name="course" defaultValue="" className={`${field} w-full`}><option value="">{t(lang, "tasks.f.noCourse")}</option>{courseList.map((c) => <option key={c.id} value={c.id}>{c.shortName}</option>)}</select></label>
              <label className="text-xs text-muted">{t(lang, "exr.reg")}<input type="date" name="regDeadline" className={`${field} w-full`} /></label>
              <label className="inline-flex items-end gap-1.5 pb-2 text-sm"><input type="checkbox" name="retake" defaultChecked />{t(lang, "exr.retake")}</label>
              <div className="col-span-2 sm:col-span-4"><button className={primary}>{t(lang, "capture.add")}</button></div>
            </form>
          </details>
        </Card>
        {past.length > 0 && <Card title={`${t(lang, "exr.past")} (${past.length})`}><ul className="divide-y divide-border">{past.map((r) => <ExamRow key={r.key} r={r} />)}</ul></Card>}
        <p className="text-xs text-muted"><Link href="/plan?tab=exams" className="text-accent hover:underline">{t(lang, "exam.plan")} →</Link></p>
      </>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">{t(lang, "deg.title")}</h1>
      <div className="flex max-w-md gap-1 rounded-lg bg-surface-2 p-1 text-sm">
        {(["progress", "exams"] as const).map((k) => <Link key={k} href={k === "progress" ? "/degree" : "/degree?tab=exams"} className={`flex-1 rounded-md px-2 py-1.5 text-center font-medium ${tab === k ? "bg-surface shadow-sm" : "text-muted hover:text-text"}`}>{t(lang, `deg.tab.${k}`)}</Link>)}
      </div>
      {body}
    </div>
  );
}
