import { radarToTaskAction, setReadAction, setTriageAction, snoozeAction } from "@/app/actions";
import { t } from "@/lib/i18n";
import type { RadarEntry } from "@/lib/queries";
import { describeChange } from "@/lib/radar/describe";
import { fmtDateTime, fmtRelative, type Lang } from "@/lib/time";
import { CourseTag, PROVIDER_LABEL, SourceLink } from "./ui";

const btn = "rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-text";

export function ChangeCard({ c, lang, now, compact = false }: { c: RadarEntry; lang: Lang; now: Date; compact?: boolean }) {
  const d = describeChange({ type: c.type, kind: c.kind, title: c.title, diffs: c.diffs, startAt: c.item?.startAt, bodyText: c.item?.bodyText, fields: c.item?.fields }, lang, now);
  const action = c.triage === "action";
  const snoozed = c.snoozedUntil && c.snoozedUntil > now;
  return (
    <li className={`px-4 py-3 ${c.readAt ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${action ? "bg-danger" : "bg-border"}`} title={t(lang, action ? "radar.action" : "radar.fyi")} />
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug">{d.headline}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            <CourseTag course={c.course} />
            <span>{PROVIDER_LABEL[c.provider] ?? c.provider}</span>
            <span>· {fmtRelative(c.detectedAt, lang, now)}</span>
            {c.htmlUrl && <span>· <SourceLink href={c.htmlUrl} provider={c.provider} lang={lang} /></span>}
            {snoozed && <span>· {t(lang, "radar.snoozedUntil", { when: fmtDateTime(c.snoozedUntil!, lang, now) })}</span>}
          </div>
          {!compact && d.excerpt && <blockquote className="mt-2 border-l-2 border-border pl-3 text-sm text-muted">{d.excerpt}</blockquote>}
          {!compact && d.lines.length > 0 && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {d.lines.map((l, i) => (
                <div key={i} className="contents">
                  <dt className="text-muted">{l.label}</dt>
                  <dd className="min-w-0">
                    {l.text ?? (<><span className="text-muted line-through decoration-1">{l.before}</span><span className="mx-1.5 text-muted">→</span><span className="font-medium">{l.after}</span></>)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {!compact && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {c.taskId
                ? <a href="/tasks" className={`${btn} text-ok`}>✓ {t(lang, "radar.isTask")}</a>
                : c.type !== "removed" && <form action={radarToTaskAction.bind(null, c.id)}><button className={`${btn} border-accent text-accent`}>{t(lang, "radar.toTask")}</button></form>}
              <form action={setReadAction.bind(null, c.id, !c.readAt)}><button className={btn}>{t(lang, c.readAt ? "radar.markUnread" : "radar.markRead")}</button></form>
              {!c.readAt && (<>
                <form action={snoozeAction.bind(null, c.id, 1)}><button className={btn}>{t(lang, "radar.snooze1")}</button></form>
                <form action={snoozeAction.bind(null, c.id, 7)}><button className={btn}>{t(lang, "radar.snooze7")}</button></form>
                <form action={setTriageAction.bind(null, c.id, action ? "fyi" : "action")}><button className={btn}>{t(lang, action ? "radar.toFyi" : "radar.toAction")}</button></form>
              </>)}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
