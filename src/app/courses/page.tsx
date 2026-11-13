import Link from "next/link";
import { acknowledgeFeedbackAction } from "../actions";
import { Card, CourseTag, Empty } from "@/components/ui";
import { getFeedback, healthByCourse } from "@/lib/stats/store";
import { truncate } from "@/lib/text";
import { fmtRelative } from "@/lib/time";
import { getDb } from "@/lib/db";
import { courses } from "@/lib/db/schema";
import { t } from "@/lib/i18n";
import { getPrefs } from "@/lib/prefs";
import { getDeadlines } from "@/lib/queries";
import { fmtDay } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function CoursesPage() {
  const { lang } = await getPrefs();
  const db = getDb();
  const now = new Date();
  const all = db.select().from(courses).all().filter((c) => c.active && c.provider !== "timeedit").sort((a, b) => a.shortName.localeCompare(b.shortName, "sv"));
  const open = getDeadlines(db, now, new Date(now.getTime() + 120 * 86_400_000), now, { tasks: false }).filter((d) => d.state === "open");
  const health = healthByCourse(db, now);
  const feedback = getFeedback(db);
  const fresh = feedback.filter((f) => !f.acknowledged);
  const LEVEL = { ok: "bg-ok-soft text-ok", watch: "bg-warn-soft text-warn", behind: "bg-danger-soft text-danger" } as const;
  const Feedback = ({ f }: { f: (typeof feedback)[number] }) => (
    <li className={`px-4 py-2.5 ${f.acknowledged ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-2 text-sm">
        <span className="font-medium">{f.url ? <a href={f.url} target="_blank" rel="noreferrer noopener" className="hover:text-accent hover:underline">{f.title}</a> : f.title}</span>
        <CourseTag course={f.course} />
        <span className="text-xs text-muted">· {f.author} · {fmtRelative(f.at, lang, now)}</span>
      </div>
      <blockquote className="mt-1 border-l-2 border-border pl-3 text-sm text-muted">{truncate(f.text, 400)}</blockquote>
      {!f.acknowledged && <form action={acknowledgeFeedbackAction.bind(null, f.id)} className="mt-1.5"><button className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-text">✓ {t(lang, "fb.ack")}</button></form>}
    </li>
  );
  const Row = ({ c }: { c: (typeof all)[number] }) => {
    const mine = open.filter((d) => d.course?.id === c.id);
    return (
      <li>
        <Link href={`/courses/${encodeURIComponent(c.id)}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
          <div className="min-w-0 flex-1 basis-56">
            <div className="font-semibold">{c.shortName}</div>
            <div className="truncate text-xs text-muted">{[c.code, c.term, (c.teachers ?? []).slice(0, 2).join(", ")].filter(Boolean).join(" · ")}</div>
          </div>
          {mine.length > 0 && <span className="text-xs text-muted">{t(lang, "crs.open", { n: mine.length })} · {fmtDay(mine[0].dueAt, lang)}</span>}
          {health.get(c.id) && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${LEVEL[health.get(c.id)!.level]}`}>{t(lang, `st.h.${health.get(c.id)!.level}`)}</span>}
        </Link>
      </li>
    );
  };
  const shown = all.filter((c) => !c.hidden);
  const hidden = all.filter((c) => c.hidden);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">{t(lang, "crs.title")}</h1>
      <Card>{shown.length === 0 ? <Empty>{t(lang, "crs.none")}</Empty> : <ul className="divide-y divide-border">{shown.map((c) => <Row key={c.id} c={c} />)}</ul>}</Card>
      <Card title={`${t(lang, "fb.title")}${fresh.length ? ` · ${t(lang, "fb.new", { n: fresh.length })}` : ""}`}>
        {feedback.length === 0 && <Empty>{t(lang, "fb.none")}</Empty>}
        <ul className="divide-y divide-border">{fresh.map((f) => <Feedback key={f.id} f={f} />)}</ul>
        {feedback.length > fresh.length && (
          <details className={fresh.length ? "border-t border-border" : ""}>
            <summary className="cursor-pointer px-4 py-2.5 text-sm text-muted">{t(lang, "fb.older", { n: feedback.length - fresh.length })}</summary>
            <ul className="divide-y divide-border">{feedback.filter((f) => f.acknowledged).map((f) => <Feedback key={f.id} f={f} />)}</ul>
          </details>
        )}
      </Card>
      {hidden.length > 0 && <Card title={t(lang, "crs.hidden")}><ul className="divide-y divide-border opacity-70">{hidden.map((c) => <Row key={c.id} c={c} />)}</ul></Card>}
    </div>
  );
}
