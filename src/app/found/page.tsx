import { asc, eq } from "drizzle-orm";
import { acceptSuggestionAction, dismissSuggestionAction, importTextAction } from "../actions";
import { Card, CourseTag, Empty } from "@/components/ui";
import { getDb } from "@/lib/db";
import { suggestions } from "@/lib/db/schema";
import { hasKey, t } from "@/lib/i18n";
import Link from "next/link";
import { llmEnabled } from "@/lib/llm/extract";
import { llmCandidates } from "@/lib/llm/run";
import { getSetting } from "@/lib/settings";
import { getPrefs } from "@/lib/prefs";
import { getCourses } from "@/lib/queries";
import { fmtDay, fmtRelative, fmtTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function FoundPage() {
  const { lang } = await getPrefs();
  const db = getDb();
  const now = new Date();
  const cs = getCourses(db);
  const pending = db.select().from(suggestions).where(eq(suggestions.status, "pending")).orderBy(asc(suggestions.dueAt)).all()
    .filter((s) => !(s.courseId && cs.get(s.courseId)?.hidden));
  const courses = [...cs.values()].filter((c) => !c.hidden && !c.id.startsWith("timeedit:")).sort((a, b) => a.shortName.localeCompare(b.shortName, "sv"));
  const field = "w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm";
  const aiCount = llmEnabled() ? llmCandidates(db, now).filter((c) => !c.tooLong).length : 0;
  const aiLast = (() => { try { return JSON.parse(getSetting(db, "llm_last") ?? "null") as { sent: number; added: number; errors: string[] } | null; } catch { return null; } })();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t(lang, "found.title")}</h1>
        <p className="mt-0.5 text-sm text-muted">{t(lang, "found.subtitle")}</p>
      </div>

      <Card>
        {pending.length === 0 ? <Empty>{t(lang, "found.empty")}</Empty> : (
          <ul className="divide-y divide-border">
            {pending.map((s) => {
              const ai = s.sourceLabel.startsWith("ai:");
              const kindKey = `kind.${s.sourceLabel.replace(/^ai:/, "")}`;
              return (
                <li key={s.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn">{t(lang, `tkind.${s.kind}`)}</span>
                    <span className="font-semibold">
                      {s.precision === "week" ? `${t(lang, "found.week")} ` : ""}{fmtDay(s.dueAt, lang)}{s.hasTime ? ` ${fmtTime(s.dueAt)}` : ""}
                    </span>
                    <span className="text-xs text-muted">· {fmtRelative(s.dueAt, lang, now)}</span>
                    {s.confidence < 50 && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{t(lang, "found.unsure")}</span>}
                    {ai && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">{t(lang, "ai.badge")}</span>}
                  </div>
                  <blockquote className="mt-2 border-l-2 border-accent pl-3 text-sm">{s.quote}</blockquote>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <CourseTag course={s.courseId ? cs.get(s.courseId) ?? null : null} />
                    <span>{hasKey(kindKey) ? t(lang, kindKey) : ""}{hasKey(kindKey) ? ": " : ""}{s.title}</span>
                    {s.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">{t(lang, "source.studium")}</a>}
                  </div>
                  <div className="mt-2.5 flex gap-2">
                    <form action={acceptSuggestionAction.bind(null, s.id)}><button className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-surface">{t(lang, "found.accept")}</button></form>
                    <form action={dismissSuggestionAction.bind(null, s.id)}><button className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2">{t(lang, "found.dismiss")}</button></form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title={t(lang, "ai.title")}>
        <div className="space-y-2 p-4 text-sm">
          {llmEnabled() ? (
            <>
              <p className="text-muted">{t(lang, "ai.on", { n: aiCount })}</p>
              {aiCount > 0 && <Link href="/found/ai" className="inline-block rounded-lg border border-border bg-surface px-3 py-1.5 font-medium hover:bg-surface-2">{t(lang, "ai.review")} →</Link>}
            </>
          ) : <p className="text-muted">{t(lang, "ai.off")}</p>}
          {aiLast && <p className="text-xs text-muted">{t(lang, "ai.last", { sent: aiLast.sent, added: aiLast.added })}{aiLast.errors.length ? ` ${t(lang, "ai.errors")}: ${aiLast.errors.join("; ")}` : ""}</p>}
        </div>
      </Card>

      <Card title={t(lang, "found.import.title")} hint={`${t(lang, "found.import.hint")} ${t(lang, "found.pdf")}`}>
        <form action={importTextAction} className="space-y-2 p-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <input name="title" placeholder={t(lang, "found.import.name")} className={field} />
            <select name="course" defaultValue="" className={field} aria-label={t(lang, "tasks.f.course")}>
              <option value="">{t(lang, "tasks.f.noCourse")}</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.shortName}</option>)}
            </select>
          </div>
          <textarea name="text" required rows={6} className={field} />
          <button className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2">{t(lang, "found.import.go")}</button>
        </form>
      </Card>
    </div>
  );
}
