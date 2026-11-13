import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import type { AgendaEvent, CourseLite, Deadline } from "@/lib/queries";
import { fmtDay, fmtRelative, fmtTime, type Lang } from "@/lib/time";

export const PROVIDER_LABEL: Record<string, string> = {
  canvas: "Studium",
  "canvas-ics": "Studium",
  timeedit: "TimeEdit",
  demo: "Demo",
};

export function Card({ title, hint, action, children }: { title?: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-surface">
      {title && (
        <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="px-4 py-6 text-sm text-muted">{children}</p>;

export function CourseTag({ course }: { course: CourseLite | null }) {
  if (!course) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: course.color }} />
      <span className="truncate">{course.shortName}</span>
    </span>
  );
}

/** Every mirrored item links back to where it came from. Demo items have no source. */
export function SourceLink({ href, provider, lang, children }: { href: string | null; provider?: string; lang: Lang; children?: ReactNode }) {
  if (!href) return children ? <>{children}</> : null;
  // Links to places inside the app (an application, the thesis plan) are ordinary links.
  if (href.startsWith("/")) return <a href={href} className="hover:text-accent hover:underline">{children ?? t(lang, "source.open")}</a>;
  const label = provider === "timeedit" ? t(lang, "source.timeedit") : provider?.startsWith("canvas") ? t(lang, "source.studium") : t(lang, "source.open");
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" title={label} className="hover:text-accent hover:underline">
      {children ?? label}
      <span className="sr-only"> ({label})</span>
    </a>
  );
}

const STATE_STYLE: Record<Deadline["state"], string> = {
  open: "bg-surface-2 text-muted",
  submitted: "bg-ok-soft text-ok",
  graded: "bg-ok-soft text-ok",
  missing: "bg-danger-soft text-danger",
};

export function StateBadge({ d, lang }: { d: Deadline; lang: Lang }) {
  const text = d.origin === "task"
    ? t(lang, d.state === "open" ? `tkind.${d.kind as "task"}` : "tasks.isDone")
    : d.state === "graded" && d.grade ? `${t(lang, "deadline.graded")}: ${d.grade}` : t(lang, `deadline.${d.state}`);
  const style = d.origin === "task" && d.state === "open" ? "bg-accent-soft text-accent" : STATE_STYLE[d.state];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${style}`}>{text}</span>;
}

export function DeadlineRow({ d, lang, now }: { d: Deadline; lang: Lang; now: Date }) {
  const overdue = d.dueAt < now && (d.state === "open" || d.state === "missing");
  const hours = (d.dueAt.getTime() - now.getTime()) / 3_600_000;
  const urgent = !overdue && hours < 48 && d.state === "open";
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <div className={`tnum w-24 shrink-0 text-xs leading-5 ${overdue ? "font-semibold text-danger" : urgent ? "font-semibold text-warn" : "text-muted"}`}>
        <div>{fmtDay(d.dueAt, lang)}</div>
        {d.hasTime && <div>{fmtTime(d.dueAt)}</div>}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`line-clamp-2 font-medium ${d.state === "open" || d.state === "missing" ? "" : "text-muted"}`}>
          {d.origin === "task" && !d.htmlUrl ? <a href="/tasks" className="hover:text-accent hover:underline">{d.title}</a> : <SourceLink href={d.htmlUrl} provider="canvas" lang={lang}>{d.title}</SourceLink>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
          <CourseTag course={d.course} />
          <span className="whitespace-nowrap text-xs text-muted">· {fmtRelative(d.dueAt, lang, now)}</span>
        </div>
      </div>
      <StateBadge d={d} lang={lang} />
    </li>
  );
}

export function EventRow({ e, lang, now }: { e: AgendaEvent; lang: Lang; now: Date }) {
  const end = e.endAt ?? e.startAt;
  const past = end < now;
  const live = e.startAt <= now && now < end;
  return (
    <li className={`flex items-start gap-3 px-4 py-2.5 ${past ? "opacity-55" : ""}`}>
      <div className="tnum w-24 shrink-0 text-xs leading-5 text-muted">
        {e.allDay ? t(lang, "today.allDay") : (<><div className="font-medium text-text">{fmtTime(e.startAt)}</div>{e.endAt && <div>{fmtTime(e.endAt)}</div>}</>)}
      </div>
      <div className="min-w-0 flex-1 border-l-[3px] pl-3" style={{ borderColor: e.course?.color ?? "var(--border)" }}>
        <div className="line-clamp-2 font-medium"><SourceLink href={e.htmlUrl} provider={e.provider} lang={lang}>{e.title}</SourceLink></div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <CourseTag course={e.course} />
          {e.location && <span className="truncate">{e.course ? "· " : ""}{e.location}</span>}
        </div>
      </div>
      {e.block && <span className="shrink-0 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted">{t(lang, e.block.kind === "busy" ? "blocks.busy" : e.block.status === "proposed" ? "blocks.proposed" : "blocks.kind.study")}</span>}
      {live && <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">{t(lang, "today.now")}</span>}
    </li>
  );
}
