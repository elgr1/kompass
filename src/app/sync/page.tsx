import { linkCourseAction } from "../actions";
import { Card, Empty, PROVIDER_LABEL } from "@/components/ui";
import { and, eq, isNull, sql } from "drizzle-orm";
import { courses as coursesTable, items as itemsTable } from "@/lib/db/schema";
import { getDb } from "@/lib/db";
import { hasKey, t } from "@/lib/i18n";
import { getPrefs } from "@/lib/prefs";
import { TimeEditIcsProvider } from "@/lib/providers/ics";
import { getCourses, getKindCounts, getRecentRuns, getScopeIssues } from "@/lib/queries";
import { getProviderStatus } from "@/lib/sync/engine";
import { getProviders, SYNC_INTERVAL_MIN } from "@/lib/sync/run";
import { isDemo } from "@/lib/db";
import { fmtDateTime, fmtRelative, type Lang } from "@/lib/time";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = {
  ok: "bg-ok-soft text-ok", partial: "bg-warn-soft text-warn", error: "bg-danger-soft text-danger",
  running: "bg-accent-soft text-accent", unavailable: "bg-surface-2 text-muted",
};
function Status({ s, lang }: { s: string; lang: Lang }) {
  const k = `sync.status.${s}`;
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[s] ?? TONE.unavailable}`}>{hasKey(k) ? t(lang, k) : s}</span>;
}

export default async function SyncPage() {
  const { lang } = await getPrefs();
  const db = getDb();
  const now = new Date();
  const providers = getProviders();
  const status = getProviderStatus(db, providers.map((p) => p.id));
  const counts = getKindCounts(db);
  const issues = getScopeIssues(db);
  const runs = getRecentRuns(db);
  const courses = getCourses(db);
  const allCourses = db.select().from(coursesTable).where(eq(coursesTable.active, true)).all();
  const unlinked = allCourses.filter((c) => c.provider === "timeedit");
  const targets = allCourses.filter((c) => c.provider !== "timeedit").sort((a, b) => a.shortName.localeCompare(b.shortName, "sv"));
  const eventCount = new Map(
    db.select({ id: itemsTable.courseId, n: sql<number>`count(*)` }).from(itemsTable)
      .where(and(eq(itemsTable.provider, "timeedit"), isNull(itemsTable.deletedAt))).groupBy(itemsTable.courseId).all().map((r) => [r.id, r.n]),
  );

  /** "canvas|course:123:files" -> "Kvantfysik F · files" */
  const scopeLabel = (key: string) => {
    const [provider, rest] = key.split("|");
    const m = rest.match(/^course:([^:]+):(.+)$/);
    if (!m) return `${PROVIDER_LABEL[provider] ?? provider} · ${rest}`;
    return `${courses.get(`${provider}:${m[1]}`)?.shortName ?? m[1]} · ${m[2]}`;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t(lang, "sync.title")}</h1>
        <p className="mt-0.5 text-sm text-muted">{t(lang, "sync.interval", { n: SYNC_INTERVAL_MIN })}</p>
      </div>

      <Card title={t(lang, "sync.sources")}>
        {providers.length === 0 ? <Empty>{t(lang, "sync.none")}</Empty> : (
          <ul className="divide-y divide-border">
            {providers.map((p) => {
              const s = status.find((x) => x.provider === p.id)!;
              const st = s.lastRun?.stats;
              return (
                <li key={p.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{p.label}</span>
                    {s.lastRun ? <Status s={s.lastRun.status} lang={lang} /> : <span className="text-xs text-muted">{t(lang, "sync.never")}</span>}
                  </div>
                  <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted">
                    <dt>{t(lang, "sync.lastOk")}</dt>
                    <dd>{s.lastOkAt ? `${fmtDateTime(s.lastOkAt, lang, now)} (${fmtRelative(s.lastOkAt, lang, now)})` : "–"}</dd>
                    {s.lastRun && (<><dt>{t(lang, "sync.lastAttempt")}</dt><dd>{fmtDateTime(s.lastRun.finishedAt ?? s.lastRun.startedAt, lang, now)}</dd></>)}
                    {st && (<><dt /><dd>{t(lang, "sync.stats", { items: st.items, added: st.added, updated: st.updated, removed: st.removed })}{st.requests ? ` · ${t(lang, "sync.requests", { n: st.requests })}` : ""}</dd></>)}
                  </dl>
                  {s.lastRun?.error && <p className="mt-2 rounded-md bg-danger-soft px-2 py-1.5 text-xs text-danger">{s.lastRun.error}</p>}
                </li>
              );
            })}
          </ul>
        )}
        {!isDemo() && !TimeEditIcsProvider.fromEnv() && <p className="border-t border-border px-4 py-3 text-xs text-muted">{t(lang, "sync.timeeditHint")}</p>}
      </Card>

      {unlinked.length > 0 && targets.length > 0 && (
        <Card title={t(lang, "sync.link.title")} hint={t(lang, "sync.link.hint")}>
          <ul className="divide-y divide-border">
            {unlinked.map((c) => (
              <li key={c.id} className="px-4 py-3">
                <form action={linkCourseAction.bind(null, c.id)} className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="flex items-center gap-2 font-medium"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} /><span className="truncate">{c.name}</span></div>
                    <div className="text-xs text-muted">{t(lang, "sync.link.events", { n: eventCount.get(c.id) ?? 0 })}</div>
                  </div>
                  <select name="to" required defaultValue="" aria-label={t(lang, "sync.link.choose")} className="min-w-0 max-w-full flex-1 basis-56 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm">
                    <option value="" disabled>{t(lang, "sync.link.choose")}</option>
                    {targets.map((x) => <option key={x.id} value={x.id}>{x.shortName}{x.term ? ` (${x.term})` : ""}</option>)}
                  </select>
                  <button className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2">{t(lang, "sync.link.save")}</button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={t(lang, "sync.mirrored")}>
        {counts.length === 0 ? <Empty>–</Empty> : (
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 px-4 py-3 text-sm sm:grid-cols-3">
            {counts.sort((a, b) => b.n - a.n).map((c) => {
              const k = `kind.${c.kind}`;
              return <li key={c.provider + c.kind} className="flex justify-between gap-2"><span className="truncate text-muted">{hasKey(k) ? t(lang, k) : c.kind}</span><span className="tnum font-medium">{c.n}</span></li>;
            })}
          </ul>
        )}
      </Card>

      <Card title={t(lang, "sync.issues")} hint={t(lang, "sync.issuesHint")}>
        {issues.length === 0 ? <Empty>{t(lang, "sync.noIssues")}</Empty> : (
          <ul className="divide-y divide-border text-sm">
            {issues.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="min-w-0 truncate">{scopeLabel(s.key)}{s.lastStatus === "error" && s.lastError ? <span className="text-muted"> · {s.lastError}</span> : null}</span>
                <Status s={s.lastStatus} lang={lang} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t(lang, "sync.runs")}>
        {runs.length === 0 ? <Empty>–</Empty> : (
          <ul className="divide-y divide-border text-sm">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="tnum text-muted">{fmtDateTime(r.startedAt, lang, now)}</span>
                <span className="min-w-0 flex-1 truncate">{PROVIDER_LABEL[r.provider] ?? r.provider}{r.stats ? <span className="text-muted"> · +{r.stats.added} / ~{r.stats.updated} / −{r.stats.removed}</span> : null}</span>
                <Status s={r.status} lang={lang} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
