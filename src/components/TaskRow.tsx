import { deleteTaskAction, toggleTaskAction, updateTaskAction } from "@/app/actions";
import type { Task } from "@/lib/db/schema";
import { t } from "@/lib/i18n";
import type { CourseLite } from "@/lib/queries";
import { dateKey, fmtDay, fmtRelative, fmtTime, type Lang } from "@/lib/time";
import { CourseTag } from "./ui";

const KINDS = ["task", "signup", "booking", "exam", "deadline"] as const;
const field = "w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm";

export function TaskRow({ task, courses, lang, now }: { task: Task; courses: CourseLite[]; lang: Lang; now: Date }) {
  const done = task.status === "done";
  const overdue = !done && task.dueAt !== null && task.dueAt < now;
  const course = task.courseId ? courses.find((c) => c.id === task.courseId) ?? null : null;
  return (
    <li className="px-4 py-2.5">
      <div className="flex items-start gap-3">
        <form action={toggleTaskAction.bind(null, task.id, !done)}>
          <button aria-label={t(lang, done ? "tasks.markOpen" : "tasks.markDone")} title={t(lang, done ? "tasks.markOpen" : "tasks.markDone")}
            className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-md border text-xs ${done ? "border-ok bg-ok-soft text-ok" : "border-border hover:border-accent"}`}>
            {done ? "✓" : ""}
          </button>
        </form>
        <details className="group min-w-0 flex-1">
          <summary className="cursor-pointer list-none">
            <div className={`font-medium leading-snug ${done ? "text-muted line-through" : ""}`}>{task.title}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
              {task.dueAt && (
                <span className={overdue ? "font-semibold text-danger" : ""}>
                  {fmtDay(task.dueAt, lang)}{task.hasTime ? ` ${fmtTime(task.dueAt)}` : ""} · {fmtRelative(task.dueAt, lang, now)}
                </span>
              )}
              <CourseTag course={course} />
              {task.kind !== "task" && <span className="rounded-full bg-warn-soft px-1.5 font-medium text-warn">{t(lang, `tkind.${task.kind}`)}</span>}
              {task.tags.map((tag) => <span key={tag}>#{tag}</span>)}
              <span className="text-accent group-open:hidden">{t(lang, "tasks.edit")}</span>
            </div>
          </summary>
          {task.sourceQuote && <blockquote className="mt-2 border-l-2 border-border pl-3 text-xs text-muted">{task.sourceQuote}</blockquote>}
          {task.sourceUrl && (
            <p className="mt-1 text-xs">
              {task.sourceUrl.startsWith("/")
                ? <a href={task.sourceUrl} className="text-accent hover:underline">{t(lang, "source.open")} →</a>
                : <a href={task.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">{t(lang, "tasks.source")}: {t(lang, "source.studium")}</a>}
            </p>
          )}
          <form action={updateTaskAction.bind(null, task.id)} className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="col-span-2 text-xs text-muted sm:col-span-4">{t(lang, "tasks.f.title")}<input name="title" defaultValue={task.title} required className={field} /></label>
            <label className="text-xs text-muted">{t(lang, "tasks.f.date")}<input type="date" name="date" defaultValue={task.dueAt ? dateKey(task.dueAt) : ""} className={field} /></label>
            <label className="text-xs text-muted">{t(lang, "tasks.f.time")}<input type="time" name="time" defaultValue={task.dueAt && task.hasTime ? fmtTime(task.dueAt) : ""} className={field} /></label>
            <label className="text-xs text-muted">{t(lang, "tasks.f.course")}
              <select name="course" defaultValue={task.courseId ?? ""} className={field}>
                <option value="">{t(lang, "tasks.f.noCourse")}</option>
                {courses.filter((c) => !c.hidden || c.id === task.courseId).map((c) => <option key={c.id} value={c.id}>{c.shortName}</option>)}
              </select>
            </label>
            <label className="text-xs text-muted">{t(lang, "tasks.f.kind")}
              <select name="kind" defaultValue={task.kind} className={field}>{KINDS.map((k) => <option key={k} value={k}>{t(lang, `tkind.${k}`)}</option>)}</select>
            </label>
            <label className="col-span-2 text-xs text-muted">{t(lang, "tasks.f.tags")}<input name="tags" defaultValue={task.tags.join(" ")} className={field} /></label>
            <label className="col-span-2 text-xs text-muted">{t(lang, "tasks.f.notes")}<input name="notes" defaultValue={task.notes ?? ""} className={field} /></label>
            <div className="col-span-2 flex gap-2 sm:col-span-4">
              <button className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-surface">{t(lang, "tasks.save")}</button>
              <button formAction={deleteTaskAction.bind(null, task.id)} formNoValidate className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-soft">{t(lang, "tasks.delete")}</button>
            </div>
          </form>
        </details>
      </div>
    </li>
  );
}
