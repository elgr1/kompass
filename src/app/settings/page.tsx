import { desc, ne } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { backupNowAction, exportAllAction, setThemeAction, toggleLangAction, regenerateFeedAction, savePlanSettingsAction, setCourseAction, testNotificationAction } from "../actions";
import { getPlanSettings } from "@/lib/plan/store";
import { fmtWeekdayShort, startOfDay } from "@/lib/time";
import { Card } from "@/components/ui";
import { getDb } from "@/lib/db";
import { courses as coursesTable, sentNotifications } from "@/lib/db/schema";
import { t } from "@/lib/i18n";
import { getChannels } from "@/lib/notify/channels";
import { getPrefs } from "@/lib/prefs";
import { getFeedToken, getSetting } from "@/lib/settings";
import { fmtRelative } from "@/lib/time";
import { fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { lang } = await getPrefs();
  const db = getDb();
  const now = new Date();
  const list = db.select().from(coursesTable).where(ne(coursesTable.provider, "timeedit")).all()
    .filter((c) => c.active).sort((a, b) => Number(a.hidden) - Number(b.hidden) || a.shortName.localeCompare(b.shortName, "sv"));
  const channels = getChannels();
  const recent = db.select().from(sentNotifications).where(ne(sentNotifications.title, "(superseded)")).orderBy(desc(sentNotifications.sentAt)).limit(6).all();
  const host = (await headers()).get("host") ?? "127.0.0.1:3210";
  const feedUrl = `http://${host}/api/calendar/${getFeedToken(db)}.ics`;
  const json = <T,>(key: string): T | null => { try { return JSON.parse(getSetting(db, key) ?? "null") as T | null; } catch { return null; } };
  const lastBackup = json<{ at: number }>("backup_last");
  const lastExport = json<{ dir: string; pages: number; records: number }>("export_last");
  const ps = getPlanSettings(db);
  const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const inp = "rounded-lg border border-border bg-bg px-2 py-1.5 text-sm";
  const btn = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">{t(lang, "settings.title")}</h1>

      <Card title={t(lang, "settings.courses")} hint={t(lang, "settings.coursesHint")}>
        <ul className="divide-y divide-border">
          {list.map((c) => (
            <li key={c.id} className={`flex flex-wrap items-center gap-2 px-4 py-2.5 ${c.hidden ? "opacity-60" : ""}`}>
              <div className="min-w-0 flex-1 basis-56">
                <div className="flex items-center gap-2 font-medium"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} /><span className="truncate">{c.shortName}</span></div>
                <div className="text-xs text-muted">{[c.code, c.term, c.hidden ? t(lang, "settings.hidden") : null].filter(Boolean).join(" · ")}</div>
              </div>
              <form action={setCourseAction.bind(null, c.id)} className="flex gap-2">
                <input name="nicknames" defaultValue={c.nicknames} placeholder={t(lang, "settings.nicknames")} aria-label={t(lang, "settings.nicknames")} className="w-36 rounded-lg border border-border bg-bg px-2 py-1.5 text-sm" />
                <button className={btn}>{t(lang, "tasks.save")}</button>
              </form>
              <form action={setCourseAction.bind(null, c.id)}>
                <input type="hidden" name="hidden" value={c.hidden ? "0" : "1"} />
                <button className={btn}>{t(lang, c.hidden ? "settings.show" : "settings.hide")}</button>
              </form>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t(lang, "ps.title")} hint={t(lang, "ps.hint")}>
        <form action={savePlanSettingsAction} className="space-y-3 p-4 text-sm">
          <div className="flex flex-wrap gap-3">
            <label className="text-xs text-muted">{t(lang, "ps.start")}<br /><input type="time" name="dayStart" defaultValue={clock(ps.dayStart)} className={inp} /></label>
            <label className="text-xs text-muted">{t(lang, "ps.end")}<br /><input type="time" name="dayEnd" defaultValue={clock(ps.dayEnd)} className={inp} /></label>
            <label className="text-xs text-muted">{t(lang, "ps.lunch")}<br /><input type="time" name="lunchStart" defaultValue={clock(ps.lunchStart)} className={inp} /> – <input type="time" name="lunchEnd" defaultValue={clock(ps.lunchEnd)} className={inp} aria-label={t(lang, "ps.lunch")} /></label>
            <label className="text-xs text-muted">{t(lang, "ps.max")}<br /><input name="maxHours" inputMode="decimal" defaultValue={String(ps.maxPerDay / 60)} className={`${inp} w-20`} /></label>
            <label className="text-xs text-muted">{t(lang, "ps.block")}<br /><input name="blockMin" inputMode="numeric" defaultValue={ps.blockMin} className={`${inp} w-20`} /></label>
          </div>
          <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <legend className="mb-1 text-xs text-muted">{t(lang, "ps.days")}</legend>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <label key={d} className="inline-flex items-center gap-1"><input type="checkbox" name={`day${d}`} defaultChecked={ps.days.includes(d)} />{fmtWeekdayShort(startOfDay(`2026-11-${15 + d}`), lang)}</label>
            ))}
          </fieldset>
          <button className={btn}>{t(lang, "tasks.save")}</button>
        </form>
      </Card>

      <Card title={t(lang, "settings.notify")} hint={t(lang, "settings.notifyHint")}>
        <div className="space-y-3 p-4 text-sm">
          <p>
            <span className="text-muted">{t(lang, "settings.channels")}: </span>
            {channels.length ? channels.map((c) => <span key={c.id} className="mr-1.5 rounded-full bg-ok-soft px-2 py-0.5 text-xs font-medium text-ok">{c.id}</span>) : <span>{t(lang, "settings.noChannels")}</span>}
          </p>
          <p className="text-xs text-muted">{t(lang, "settings.channelHelp")}</p>
          {channels.length > 0 && <form action={testNotificationAction}><button className={btn}>{t(lang, "settings.test")}</button></form>}
          {recent.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">{t(lang, "settings.recent")}</p>
              <ul className="space-y-0.5 text-xs text-muted">{recent.map((r) => <li key={r.key}><span className="tnum">{fmtDateTime(r.sentAt, lang, now)}</span> · {r.title}</li>)}</ul>
            </div>
          )}
        </div>
      </Card>

      <Card title={t(lang, "settings.feed")} hint={t(lang, "settings.feedHint")}>
        <div className="space-y-3 p-4">
          <input readOnly value={feedUrl} aria-label={t(lang, "settings.feed")} className="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs" />
          <form action={regenerateFeedAction}><button className={btn}>{t(lang, "settings.feedNew")}</button></form>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap gap-2 p-4">
          <form action={toggleLangAction}><button className={btn}>{t(lang, "prefs.language")}</button></form>
          <form action={setThemeAction.bind(null, "light")}><button className={btn}>☀ Light</button></form>
          <form action={setThemeAction.bind(null, "dark")}><button className={btn}>☾ Dark</button></form>
        </div>
      </Card>

      <Card title={t(lang, "bk.title")} hint={t(lang, "bk.hint")}>
        <div className="space-y-2 p-4 text-sm">
          <div className="flex flex-wrap gap-2">
            <form action={backupNowAction}><button className={btn}>{t(lang, "bk.now")}</button></form>
            <form action={exportAllAction}><button className={btn}>{t(lang, "bk.export")}</button></form>
          </div>
          <p className="text-xs text-muted">{lastBackup ? t(lang, "bk.last", { when: `${fmtDateTime(new Date(lastBackup.at), lang, now)} (${fmtRelative(new Date(lastBackup.at), lang, now)})` }) : t(lang, "bk.never")}</p>
          {lastExport && <p className="text-xs text-muted">{t(lang, "bk.lastExport", { pages: lastExport.pages, records: lastExport.records })} <code className="break-all">{lastExport.dir}</code></p>}
        </div>
      </Card>

      <Card>
        <ul className="divide-y divide-border">
          {(["semester", "courses", "projects", "career", "degree", "stats", "notes", "found", "sync"] as const).map((k) => (
            <li key={k}><Link href={`/${k}`} className="block px-4 py-2.5 text-sm font-medium text-accent hover:underline">{t(lang, k === "sync" ? "settings.syncLink" : `nav.${k}`)} →</Link></li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
