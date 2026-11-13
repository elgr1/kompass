import Link from "next/link";
import { createPageAction, createRetrospectiveAction } from "../actions";
import { Card, Empty } from "@/components/ui";
import { getDb } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { t } from "@/lib/i18n";
import { getPrefs } from "@/lib/prefs";
import { getCourses } from "@/lib/queries";
import { estimateAccuracy } from "@/lib/stats/logic";
import { accuracySamples, currentStreak, healthByCourse, weeklyTime } from "@/lib/stats/store";
import { addDays, dateKey, fmtDate, isoWeek, startOfDay } from "@/lib/time";

export const dynamic = "force-dynamic";
const LEVEL = { ok: "bg-ok-soft text-ok", watch: "bg-warn-soft text-warn", behind: "bg-danger-soft text-danger" } as const;

export default async function StatsPage() {
  const { lang } = await getPrefs();
  const db = getDb();
  const now = new Date();
  const today = dateKey(now);
  const cs = getCourses(db);
  const h = (min: number) => new Intl.NumberFormat(lang === "sv" ? "sv-SE" : "en-GB", { maximumFractionDigits: 1 }).format(min / 60);
  const weeks = weeklyTime(db, now, 8);
  const max = Math.max(1, ...weeks.map((w) => w.total));
  const projectNames = new Map(db.select({ id: projects.id, title: projects.title }).from(projects).all().map((p) => [`project:${p.id}`, p.title]));
  const label = (k: string) => cs.get(k)?.shortName ?? projectNames.get(k) ?? t(lang, "load.other");
  const color = (k: string) => cs.get(k)?.color ?? (projectNames.has(k) ? "#8b5cf6" : "var(--muted)");
  const acc = estimateAccuracy(accuracySamples(db, new Date(now.getTime() - 400 * 86_400_000), now, now));
  const streak = currentStreak(db, now);
  const health = [...healthByCourse(db, now)].sort((a, b) => a[1].score - b[1].score);
  const field = "rounded-lg border border-border bg-bg px-2 py-1.5 text-sm";
  const btn = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2";

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">{t(lang, "st.title")}</h1>

      <Card title={t(lang, "st.hours")} hint={t(lang, "st.hoursHint")}>
        {weeks.every((w) => w.total === 0) ? <Empty>{t(lang, "st.noTime")}</Empty> : (
          <ul className="divide-y divide-border">
            {weeks.map((w) => (
              <li key={w.monday} className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-3 px-4 py-2">
                <div className="text-xs"><span className="font-semibold">{t(lang, "today.week", { n: isoWeek(w.monday).week })}</span><br /><span className="text-muted">{fmtDate(startOfDay(w.monday), lang)}</span></div>
                <div className="min-w-0">
                  <div className="flex h-4 overflow-hidden rounded bg-surface-2">
                    {[...w.byKey].sort((a, b) => b[1] - a[1]).map(([k, m]) => <div key={k} title={`${label(k)}: ${h(m)} h`} style={{ width: `${(m / max) * 100}%`, background: color(k) }} />)}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted">
                    {[...w.byKey].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, m]) => <span key={k} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: color(k) }} />{label(k)} {h(m)}</span>)}
                  </div>
                </div>
                <div className="tnum text-right text-sm font-semibold">{h(w.total)} h</div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card title={t(lang, "st.accuracy")}>
          {acc.n === 0 ? <Empty>{t(lang, "st.accuracyNone")}</Empty> : (
            <div className="space-y-3 p-4 text-sm">
              <p>{t(lang, "st.accuracyText", { n: acc.n, ratio: String(acc.medianRatio), within: acc.within25 ?? 0 })}</p>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t(lang, "st.worst")}</p>
                <ul className="space-y-0.5 text-xs text-muted">{acc.worst.map((w, i) => <li key={i} className="flex justify-between gap-3"><span className="truncate">{w.title}</span><span className="tnum shrink-0">{t(lang, "st.vs", { a: h(w.actualMin), e: h(w.estimateMin) })}</span></li>)}</ul>
              </div>
              <Link href="/plan?tab=time" className="text-xs text-accent hover:underline">{t(lang, "plan.tab.time")} →</Link>
            </div>
          )}
        </Card>

        <Card title={t(lang, "st.streak")} hint={t(lang, "st.streakHint")}>
          <div className="flex items-center justify-between gap-4 p-4">
            <span className="tnum text-4xl font-semibold">{streak}</span>
            <form action={createPageAction}><input type="hidden" name="template" value="weekly_review" /><button className={btn}>{t(lang, "st.startReview")}</button></form>
          </div>
        </Card>
      </div>

      <Card title={t(lang, "st.health")} hint={t(lang, "st.healthHint")}>
        <ul className="divide-y divide-border">
          {health.map(([id, hl]) => (
            <li key={id}>
              <Link href={`/courses/${encodeURIComponent(id)}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-surface-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cs.get(id)?.color }} />
                <span className="min-w-0 flex-1 basis-48 font-medium">{cs.get(id)?.shortName}</span>
                <span className="text-xs text-muted">{hl.reasons.map((r) => t(lang, `st.r.${r.reason}`, { n: r.n })).join(" · ")}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${LEVEL[hl.level]}`}>{t(lang, `st.h.${hl.level}`)} · {hl.score}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t(lang, "st.retro")} hint={t(lang, "st.retroHint")}>
        <form action={createRetrospectiveAction} className="flex flex-wrap items-end gap-2 p-4">
          <label className="text-xs text-muted">{t(lang, "cev.from")}<br /><input type="date" name="from" required defaultValue={addDays(today, -70)} className={field} /></label>
          <label className="text-xs text-muted">{t(lang, "cev.to")}<br /><input type="date" name="to" required defaultValue={today} className={field} /></label>
          <button className={btn}>{t(lang, "st.retroGo")}</button>
        </form>
      </Card>
    </div>
  );
}
