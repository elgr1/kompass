import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addMilestoneAction, addProjectTaskAction, deleteEntryAction, deleteMilestoneAction, deleteProjectAction, moveProjectTaskAction, projectNotesAction, startTimerAction, toggleMilestoneAction, updateProjectAction,
} from "../../actions";
import { Board } from "@/components/Board";
import { Card, Empty } from "@/components/ui";
import { getDb } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { t } from "@/lib/i18n";
import { getPrefs } from "@/lib/prefs";
import { getMilestones, getProject, projectKey, projectTime } from "@/lib/projects/store";
import { dateKey, fmtDate, fmtDay, fmtTime, startOfDay } from "@/lib/time";

export const dynamic = "force-dynamic";
const STATUSES = ["active", "paused", "idea", "done"] as const;

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { lang } = await getPrefs();
  const id = Number((await params).id);
  const db = getDb();
  const p = Number.isInteger(id) ? getProject(db, id) : null;
  if (!p) notFound();
  const now = new Date();
  const today = dateKey(now);
  const h = (min: number) => new Intl.NumberFormat(lang === "sv" ? "sv-SE" : "en-GB", { maximumFractionDigits: 1 }).format(min / 60);
  const time = projectTime(db, p.id, now);
  const ms = getMilestones(db, p.id);
  const ts = db.select().from(tasks).where(eq(tasks.projectId, p.id)).all();
  const card = (x: (typeof ts)[number]) => ({ id: x.id, title: x.title, href: "/tasks", meta: [x.dueAt ? fmtDate(x.dueAt, lang) : null, ...x.tags.map((g) => `#${g}`)].filter((v): v is string => Boolean(v)) });
  const columns = [
    { key: "todo", label: t(lang, "proj.col.todo"), cards: ts.filter((x) => x.status === "todo" || x.status === "inbox").map(card) },
    { key: "doing", label: t(lang, "proj.col.doing"), cards: ts.filter((x) => x.status === "doing").map(card) },
    { key: "done", label: t(lang, "proj.col.done"), cards: ts.filter((x) => x.status === "done").sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0)).slice(0, 12).map(card) },
  ];
  const field = "w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm";
  const btn = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2";
  const small = "rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-text";
  const pct = p.weeklyBudgetMin ? Math.min(100, (time.thisWeek / p.weeklyBudgetMin) * 100) : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <nav className="text-xs text-muted"><Link href="/projects" className="hover:text-accent">{t(lang, "proj.title")}</Link> / {t(lang, `proj.st.${p.status}`)}</nav>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{p.title}</h1>
          {p.goal && <p className="mt-1 max-w-2xl whitespace-pre-line text-sm text-muted">{p.goal}</p>}
          <p className="mt-2 flex flex-wrap gap-2 text-xs">
            {p.repoUrl && <a href={p.repoUrl} target="_blank" rel="noreferrer noopener" className={small}>↗ {t(lang, "proj.repo")}</a>}
            {p.docsUrl && <a href={p.docsUrl} target="_blank" rel="noreferrer noopener" className={small}>↗ {t(lang, "proj.docs")}</a>}
            {p.targetDate && <span className="self-center text-muted">{t(lang, "proj.target")}: {fmtDate(startOfDay(p.targetDate), lang)}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={startTimerAction} className="flex gap-1">
            <input type="hidden" name="key" value={projectKey(p.id)} />
            <button className={btn}>▶ {t(lang, "timer.start")}</button>
            <button name="target" value="50" className={btn}>50</button>
          </form>
          <form action={projectNotesAction.bind(null, p.id)}><button className={btn}>{t(lang, "proj.notes")} →</button></form>
        </div>
      </header>

      <div className="grid gap-5 md:grid-cols-[1fr_20rem] [&>*]:min-w-0">
        <Card title={t(lang, "proj.milestones")}>
          {ms.length === 0 && <Empty>–</Empty>}
          <ul className="divide-y divide-border">
            {ms.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-2">
                <form action={toggleMilestoneAction.bind(null, m.id, !m.done)}><button aria-label={t(lang, m.done ? "tasks.markOpen" : "tasks.markDone")} className={`flex h-5 w-5 items-center justify-center rounded-md border text-xs ${m.done ? "border-ok bg-ok-soft text-ok" : "border-border hover:border-accent"}`}>{m.done ? "✓" : ""}</button></form>
                <span className={`min-w-0 flex-1 ${m.done ? "text-muted line-through" : "font-medium"}`}>{m.title}</span>
                {m.dueDate && <span className={`tnum text-xs ${!m.done && m.dueDate < today ? "font-semibold text-danger" : "text-muted"}`}>{fmtDate(startOfDay(m.dueDate), lang)}</span>}
                <form action={deleteMilestoneAction.bind(null, m.id)}><button className={small} aria-label={t(lang, "tasks.delete")}>×</button></form>
              </li>
            ))}
          </ul>
          <form action={addMilestoneAction.bind(null, p.id)} className="flex flex-wrap gap-2 border-t border-border p-3">
            <input name="title" required placeholder={t(lang, "proj.newMilestone")} autoComplete="off" className="min-w-0 flex-1 basis-40 rounded-lg border border-border bg-bg px-2 py-1.5 text-sm" />
            <input type="date" name="dueDate" aria-label={t(lang, "tasks.f.date")} className="w-36 shrink-0 rounded-lg border border-border bg-bg px-2 py-1.5 text-sm" />
            <button className={`${btn} shrink-0 whitespace-nowrap`}>{t(lang, "capture.add")}</button>
          </form>
        </Card>

        <Card title={t(lang, "proj.timeLog")}>
          <div className="space-y-3 p-4 text-sm">
            <div>
              <div className="mb-1 flex justify-between"><span className="text-muted">{t(lang, "proj.week")}</span><span className="tnum font-semibold">{p.weeklyBudgetMin ? t(lang, "proj.ofBudget", { h: h(time.thisWeek), b: h(p.weeklyBudgetMin) }) : `${h(time.thisWeek)} h`}</span></div>
              {p.weeklyBudgetMin > 0 && <div className="h-2 rounded bg-surface-2"><div className="h-2 rounded bg-accent" style={{ width: `${pct}%` }} /></div>}
            </div>
            <div className="flex justify-between"><span className="text-muted">{t(lang, "proj.total")}</span><span className="tnum font-semibold">{h(time.total)} h</span></div>
          </div>
          <ul className="divide-y divide-border border-t border-border text-xs">
            {time.entries.filter((e) => e.endedAt).slice(0, 6).map((e) => (
              <li key={e.id} className="flex items-center gap-2 px-4 py-1.5">
                <span className="tnum w-24 shrink-0 text-muted">{fmtDay(e.startedAt, lang)} {fmtTime(e.startedAt)}</span>
                <span className="min-w-0 flex-1 truncate">{e.title}</span>
                <span className="tnum font-medium">{Math.round((e.endedAt!.getTime() - e.startedAt.getTime()) / 60_000)} min</span>
                <form action={deleteEntryAction.bind(null, e.id)}><button className="text-muted hover:text-danger" aria-label={t(lang, "tasks.delete")}>×</button></form>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{t(lang, "proj.board")}</h2>
        <Board columns={columns} noneLabel="" addLabel={t(lang, "proj.newTask")} moveAction={moveProjectTaskAction} addAction={addProjectTaskAction.bind(null, p.id)} />
      </section>

      <details className="rounded-xl border border-border bg-surface">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-muted">{t(lang, "proj.settings")}</summary>
        <form action={updateProjectAction.bind(null, p.id)} className="grid gap-3 border-t border-border p-4 sm:grid-cols-3">
          <label className="text-xs text-muted sm:col-span-2">{t(lang, "tasks.f.title")}<input name="title" required defaultValue={p.title} className={field} /></label>
          <label className="text-xs text-muted">{t(lang, "career.f.status")}<select name="status" defaultValue={p.status} className={field}>{STATUSES.map((s) => <option key={s} value={s}>{t(lang, `proj.st.${s}`)}</option>)}</select></label>
          <label className="text-xs text-muted sm:col-span-3">{t(lang, "proj.goal")}<textarea name="goal" rows={2} defaultValue={p.goal} className={field} /></label>
          <label className="text-xs text-muted">{t(lang, "proj.budget")}<input name="budgetHours" inputMode="decimal" defaultValue={p.weeklyBudgetMin ? String(p.weeklyBudgetMin / 60) : ""} className={field} /></label>
          <label className="text-xs text-muted">{t(lang, "proj.target")}<input type="date" name="targetDate" defaultValue={p.targetDate ?? ""} className={field} /></label>
          <span />
          <label className="text-xs text-muted">{t(lang, "proj.repo")}<input name="repoUrl" defaultValue={p.repoUrl ?? ""} placeholder="https://github.com/…" className={field} /></label>
          <label className="text-xs text-muted sm:col-span-2">{t(lang, "proj.docs")}<input name="docsUrl" defaultValue={p.docsUrl ?? ""} placeholder="https://" className={field} /></label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
            <button className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-surface">{t(lang, "tasks.save")}</button>
            <button formAction={deleteProjectAction.bind(null, p.id)} formNoValidate className="text-xs text-muted hover:text-danger hover:underline">{t(lang, "proj.delete")}</button>
          </div>
        </form>
      </details>
    </div>
  );
}
