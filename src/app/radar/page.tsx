import Link from "next/link";
import { markAllReadAction } from "../actions";
import { ChangeCard } from "@/components/ChangeCard";
import { Card, Empty } from "@/components/ui";
import { getDb } from "@/lib/db";
import { changes } from "@/lib/db/schema";
import { t } from "@/lib/i18n";
import { getPrefs } from "@/lib/prefs";
import { getRadar, getRadarCounts, type RadarFilter } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function RadarPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { lang } = await getPrefs();
  const { show } = await searchParams;
  const filter: RadarFilter = show === "action" || show === "all" ? show : "unread";
  const db = getDb();
  const now = new Date();
  const entries = getRadar(db, filter, now);
  const counts = getRadarCounts(db, now);
  const everAny = db.select({ id: changes.id }).from(changes).limit(1).all().length > 0;
  const action = entries.filter((c) => c.triage === "action");
  const fyi = entries.filter((c) => c.triage !== "action");

  const tabs: { key: RadarFilter; label: string; n?: number }[] = [
    { key: "unread", label: t(lang, "radar.filter.unread"), n: counts.unread },
    { key: "action", label: t(lang, "radar.filter.action"), n: counts.action },
    { key: "all", label: t(lang, "radar.filter.all") },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t(lang, "radar.title")}</h1>
          <p className="mt-0.5 text-sm text-muted">{t(lang, "radar.subtitle")}</p>
        </div>
        {counts.unread > 0 && (
          <form action={markAllReadAction}>
            <button className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2">{t(lang, "radar.markAllRead")}</button>
          </form>
        )}
      </div>

      <div className="flex gap-1 rounded-lg bg-surface-2 p-1 text-sm">
        {tabs.map((tab) => (
          <Link key={tab.key} href={tab.key === "unread" ? "/radar" : `/radar?show=${tab.key}`}
            className={`flex-1 rounded-md px-3 py-1.5 text-center font-medium ${filter === tab.key ? "bg-surface shadow-sm" : "text-muted hover:text-text"}`}>
            {tab.label}{tab.n ? <span className="tnum ml-1.5 text-muted">{tab.n}</span> : null}
          </Link>
        ))}
      </div>

      {entries.length === 0 && <Card><Empty>{everAny ? t(lang, "radar.empty") : t(lang, "radar.emptyFirst")}</Empty></Card>}
      {action.length > 0 && (
        <Card title={`${t(lang, "radar.action")} (${action.length})`}>
          <ul className="divide-y divide-border">{action.map((c) => <ChangeCard key={c.id} c={c} lang={lang} now={now} />)}</ul>
        </Card>
      )}
      {fyi.length > 0 && (
        <Card title={`${t(lang, "radar.fyi")} (${fyi.length})`}>
          <ul className="divide-y divide-border">{fyi.map((c) => <ChangeCard key={c.id} c={c} lang={lang} now={now} />)}</ul>
        </Card>
      )}
    </div>
  );
}
