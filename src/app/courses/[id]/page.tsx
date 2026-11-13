import { and, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, DeadlineRow, Empty, EventRow } from "@/components/ui";
import { labSeries, type LabStep } from "@/lib/courses/labs";
import { getDb } from "@/lib/db";
import { courses, fileTexts, items, opened } from "@/lib/db/schema";
import { healthByCourse } from "@/lib/stats/store";
import { t } from "@/lib/i18n";
import { getPrefs } from "@/lib/prefs";
import { getDeadlines, getEvents } from "@/lib/queries";
import { truncate } from "@/lib/text";
import { fmtDate, fmtRelative, type Lang } from "@/lib/time";

export const dynamic = "force-dynamic";

const STEP_STYLE: Record<LabStep, string> = { todo: "bg-surface-2 text-muted", submitted: "bg-accent-soft text-accent", done: "bg-ok-soft text-ok", missing: "bg-danger-soft text-danger" };
function Step({ step, url, lang }: { step: LabStep | null; url: string | null; lang: Lang }) {
  if (!step) return <span className="text-muted">–</span>;
  const chip = <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STEP_STYLE[step]}`}>{t(lang, `crs.step.${step}`)}</span>;
  return url ? <a href={url} target="_blank" rel="noreferrer noopener" title={t(lang, "source.studium")}>{chip}</a> : chip;
}

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { lang } = await getPrefs();
  const id = decodeURIComponent((await params).id);
  const db = getDb();
  const course = db.select().from(courses).where(eq(courses.id, id)).get();
  if (!course) notFound();
  const now = new Date();
  const all = db.select().from(items).where(and(eq(items.courseId, id), isNull(items.deletedAt))).all();
  const of = (kind: string) => all.filter((i) => i.kind === kind);

  // Deadlines of this course only (hidden courses included: this is the one place they stay visible).
  const far = new Date(now.getTime() + 400 * 86_400_000);
  const past = new Date(now.getTime() - 400 * 86_400_000);
  const deadlines = getDeadlines(db, past, far, now, { tasks: false }).filter((d) => d.course?.id === id);
  const fallback = course.hidden ? of("assignment").filter((a) => a.dueAt) : [];
  const labs = labSeries(of("assignment").map((a) => ({
    title: a.title, dueAt: a.dueAt, url: a.htmlUrl, grade: typeof a.fields.grade === "string" ? a.fields.grade : null,
    state: a.fields.submission_state === "graded" ? "graded" : a.fields.submission_state === "submitted" || a.fields.submission_state === "pending_review" ? "submitted" : a.fields.missing === true ? "missing" : "open",
  })));
  const upcoming = deadlines.filter((d) => d.dueAt >= now || d.state === "open" || d.state === "missing");
  const done = deadlines.filter((d) => !upcoming.includes(d)).reverse();
  const modules = of("module").sort((a, b) => Number(a.fields.position ?? 0) - Number(b.fields.position ?? 0));
  const announcements = of("announcement").sort((a, b) => String(b.fields.posted_at ?? "").localeCompare(String(a.fields.posted_at ?? ""))).slice(0, 5);
  const feedback = of("submission_comment").sort((a, b) => String(b.fields.created_at ?? "").localeCompare(String(a.fields.created_at ?? "")));
  const health = healthByCourse(db, now).get(id);
  const openedIds = new Set(db.select({ id: opened.itemId }).from(opened).all().map((o) => o.id));
  const pdfPages = new Map(db.select({ id: fileTexts.itemId, pages: fileTexts.pages }).from(fileTexts).all().map((f) => [f.id, f.pages]));
  const material = [...of("file"), ...of("page")].filter((m) => m.htmlUrl).sort((a, b) => String(b.fields.modified_at ?? b.changedAt.toISOString()).localeCompare(String(a.fields.modified_at ?? a.changedAt.toISOString())));
  const unopened = material.filter((m) => !openedIds.has(m.id)).length;
  const MaterialRow = ({ m }: { m: (typeof material)[number] }) => (
    <li className="flex items-center gap-2 px-4 py-1.5 text-sm">
      <span className={openedIds.has(m.id) ? "text-border" : "text-accent"} aria-hidden>●</span>
      <a href={`/go/${encodeURIComponent(m.id)}`} target="_blank" rel="noreferrer noopener" className={`min-w-0 flex-1 truncate hover:text-accent hover:underline ${openedIds.has(m.id) ? "text-muted" : "font-medium"}`}>{m.title}</a>
      {pdfPages.get(m.id) ? <span className="shrink-0 text-[11px] text-muted" title={t(lang, "mat.read", { n: pdfPages.get(m.id)! })}>PDF {pdfPages.get(m.id)}</span> : null}
      {typeof m.fields.modified_at === "string" && <span className="tnum shrink-0 text-xs text-muted">{fmtDate(new Date(m.fields.modified_at), lang)}</span>}
    </li>
  );
  const schedule = getEvents(db, now, new Date(now.getTime() + 14 * 86_400_000)).filter((e) => e.course?.id === id).slice(0, 8);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight"><span className="h-3 w-3 rounded-full" style={{ background: course.color }} />{course.shortName}</h1>
        <p className="mt-1 text-sm text-muted">
          {[course.code, course.term].filter(Boolean).join(" · ")}
          {course.htmlUrl && <> · <a href={course.htmlUrl} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">{t(lang, "source.studium")} ↗</a></>}
          {" · "}{t(lang, "crs.files", { n: of("file").length, p: of("page").length })}
        </p>
        {health && health.reasons.length > 0 && (
          <p className="mt-1 text-sm"><span className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${health.level === "ok" ? "bg-ok-soft text-ok" : health.level === "watch" ? "bg-warn-soft text-warn" : "bg-danger-soft text-danger"}`}>{t(lang, `st.h.${health.level}`)}</span><span className="text-muted">{health.reasons.map((r) => t(lang, `st.r.${r.reason}`, { n: r.n })).join(" · ")}</span></p>
        )}
        {(course.teachers ?? []).length > 0 && <p className="mt-1 text-sm"><span className="text-muted">{t(lang, "crs.teachers")}:</span> {(course.teachers ?? []).join(", ")}</p>}
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Card title={t(lang, "crs.deadlines")}>
            {deadlines.length + fallback.length === 0 && <Empty>{t(lang, "crs.noDeadlines")}</Empty>}
            <ul className="divide-y divide-border">{upcoming.map((d) => <DeadlineRow key={d.id} d={d} lang={lang} now={now} />)}</ul>
            {done.length > 0 && <details className="border-t border-border"><summary className="cursor-pointer px-4 py-2.5 text-sm text-muted">{t(lang, "tasks.isDone")} ({done.length})</summary><ul className="divide-y divide-border">{done.map((d) => <DeadlineRow key={d.id} d={d} lang={lang} now={now} />)}</ul></details>}
          </Card>

          {labs.length > 0 && (
            <Card title={t(lang, "crs.labs")}>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-left text-xs text-muted"><th className="px-4 py-2 font-semibold" /><th className="px-2 py-2 font-semibold">{t(lang, "crs.prep")}</th><th className="px-2 py-2 font-semibold">{t(lang, "crs.report")}</th><th className="px-4 py-2 font-semibold">{t(lang, "crs.approved")}</th></tr></thead>
                <tbody>
                  {labs.map((r) => (
                    <tr key={r.n} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-medium" title={r.report?.title ?? r.prep?.title}>{t(lang, "crs.lab", { n: r.n })}</td>
                      <td className="px-2 py-2"><Step step={r.prepStep} url={r.prep?.url ?? null} lang={lang} /></td>
                      <td className="px-2 py-2"><Step step={r.reportStep} url={r.report?.url ?? null} lang={lang} /></td>
                      <td className="px-4 py-2">{r.approved ? <span className="font-semibold text-ok">✓ {r.report?.grade ?? ""}</span> : <span className="text-muted">–</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {schedule.length > 0 && <Card title={t(lang, "crs.schedule")}><ul className="divide-y divide-border">{schedule.map((e) => <EventRow key={e.id} e={e} lang={lang} now={now} />)}</ul></Card>}
        </div>

        <div className="space-y-5">
          {feedback.length > 0 && (
            <Card title={`${t(lang, "crs.feedback")} (${feedback.length})`}>
              <ul className="divide-y divide-border">
                {feedback.map((f) => (
                  <li key={f.id} className="px-4 py-2.5">
                    <div className="text-sm font-medium">{f.htmlUrl ? <a href={f.htmlUrl} target="_blank" rel="noreferrer noopener" className="hover:text-accent hover:underline">{f.title}</a> : f.title}</div>
                    <blockquote className="mt-1 border-l-2 border-border pl-3 text-sm text-muted">{truncate(f.bodyText ?? "", 400)}</blockquote>
                    <div className="mt-1 text-xs text-muted">{String(f.fields.author ?? "")}{typeof f.fields.created_at === "string" ? ` · ${fmtDate(new Date(f.fields.created_at), lang)}` : ""}</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title={t(lang, "crs.announcements")}>
            {announcements.length === 0 ? <Empty>{t(lang, "crs.none")}</Empty> : (
              <ul className="divide-y divide-border">
                {announcements.map((a) => (
                  <li key={a.id} className="px-4 py-2.5">
                    <div className="font-medium">{a.htmlUrl ? <a href={a.htmlUrl} target="_blank" rel="noreferrer noopener" className="hover:text-accent hover:underline">{a.title}</a> : a.title}</div>
                    <p className="mt-0.5 line-clamp-2 text-sm text-muted">{truncate((a.bodyText ?? "").replace(/\s+/g, " "), 220)}</p>
                    {typeof a.fields.posted_at === "string" && <div className="mt-0.5 text-xs text-muted">{fmtRelative(new Date(a.fields.posted_at), lang, now)}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {material.length > 0 && (
            <Card title={`${t(lang, "mat.title")} · ${t(lang, "mat.unopened", { n: unopened })}`} hint={t(lang, "mat.hint")}>
              <ul className="divide-y divide-border">{material.slice(0, 8).map((m) => <MaterialRow key={m.id} m={m} />)}</ul>
              {material.length > 8 && <details className="border-t border-border"><summary className="cursor-pointer px-4 py-2.5 text-sm text-muted">{t(lang, "mat.all", { n: material.length })}</summary><ul className="divide-y divide-border">{material.slice(8).map((m) => <MaterialRow key={m.id} m={m} />)}</ul></details>}
            </Card>
          )}

          <Card title={`${t(lang, "crs.modules")} (${modules.length})`}>
            {modules.length === 0 ? <Empty>{t(lang, "crs.none")}</Empty> : (
              <ul className="divide-y divide-border">
                {modules.map((m) => {
                  const list = Array.isArray(m.fields.items) ? (m.fields.items as string[]) : [];
                  return (
                    <li key={m.id}>
                      <details>
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm"><span className="font-medium">{m.title}</span><span className="tnum text-xs text-muted">{list.length}</span></summary>
                        <ul className="space-y-0.5 px-4 pb-3 text-sm text-muted">
                          {list.map((x, i) => <li key={i} className="truncate">· {x}</li>)}
                          {m.htmlUrl && <li><a href={m.htmlUrl} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">{t(lang, "source.studium")} ↗</a></li>}
                        </ul>
                      </details>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
