import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { setThemeAction, toggleLangAction } from "./actions";
import "katex/dist/katex.min.css";
import "./globals.css";
import { CommandPalette, PaletteButton } from "@/components/CommandPalette";
import { NavLinks, type NavItem } from "@/components/NavLinks";
import { SyncButton } from "@/components/SyncButton";
import { TimerChip } from "@/components/TimerChip";
import { runningTimer } from "@/lib/plan/store";
import { PROVIDER_LABEL } from "@/components/ui";
import { eq } from "drizzle-orm";
import { getDb, isDemo } from "@/lib/db";
import { suggestions, tasks } from "@/lib/db/schema";
import { t } from "@/lib/i18n";
import { getPrefs } from "@/lib/prefs";
import { getRadarCounts } from "@/lib/queries";
import { getProviderStatus } from "@/lib/sync/engine";
import { getProviders } from "@/lib/sync/run";
import { fmtDateTime, fmtRelative } from "@/lib/time";

export const metadata: Metadata = {
  title: "Kompass",
  description: "Study & life command center synced with Studium",
  appleWebApp: { capable: true, title: "Kompass", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/180" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0f1115" }, { color: "#f6f7f9" }] };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { lang, theme } = await getPrefs();
  const db = getDb();
  const now = new Date();
  const providers = getProviders();
  const status = getProviderStatus(db, providers.map((p) => p.id));
  const counts = getRadarCounts(db, now);
  const lastOk = status.map((s) => s.lastOkAt).filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const stale = status.filter((s) => s.stale);

  const inbox = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.status, "inbox")).all().length;
  const found = db.select({ id: suggestions.id }).from(suggestions).where(eq(suggestions.status, "pending")).all().length;
  const main: NavItem[] = [
    { href: "/", label: t(lang, "nav.today") },
    { href: "/week", label: t(lang, "nav.week") },
    { href: "/semester", label: t(lang, "nav.semester") },
    { href: "/plan", label: t(lang, "nav.plan") },
    { href: "/tasks", label: t(lang, "nav.tasks"), badge: inbox, badgeTone: "muted" },
    { href: "/notes", label: t(lang, "nav.notes") },
    { href: "/radar", label: t(lang, "nav.radar"), badge: counts.action || counts.unread, badgeTone: counts.action ? "action" : "muted" },
    { href: "/found", label: t(lang, "nav.found"), badge: found, badgeTone: "action" },
  ];
  const timer = runningTimer(db);
  const more: NavItem[] = [
    { href: "/courses", label: t(lang, "nav.courses") },
    { href: "/projects", label: t(lang, "nav.projects") },
    { href: "/career", label: t(lang, "nav.career") },
    { href: "/degree", label: t(lang, "nav.degree") },
    { href: "/stats", label: t(lang, "nav.stats") },
  ];
  const system: NavItem[] = [{ href: "/sync", label: t(lang, "nav.sync") }, { href: "/settings", label: t(lang, "nav.settings") }];
  const nav: NavItem[] = [...main, ...more, ...system];
  const ctl = "rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-text";

  return (
    <html lang={lang} data-theme={theme === "system" ? undefined : theme}>
      <body>
        <div className="mx-auto flex min-h-full max-w-[1280px]">
          <aside className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border px-3 py-5 md:flex">
            <Link href="/" className="mb-4 flex items-center gap-2 px-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon.svg" alt="" width={24} height={24} className="rounded-md" />
              <span className="text-base font-semibold tracking-tight">Kompass</span>
            </Link>
            <NavLinks items={main} variant="side" />
            <div className="my-1.5 border-t border-border" />
            <NavLinks items={more} variant="side" />
            <div className="my-1.5 border-t border-border" />
            <NavLinks items={system} variant="side" />
            <div className="mt-auto px-3 text-xs text-muted">
              {isDemo() && <p className="mb-2 inline-block rounded-full bg-warn-soft px-2 py-0.5 font-medium text-warn">{t(lang, "app.demo")}</p>}
              <p>{lastOk ? `${t(lang, "sync.last")} ${fmtRelative(lastOk, lang, now)}` : t(lang, "sync.never")}</p>
            </div>
          </aside>

          <div className="min-w-0 flex-1 pb-20 md:pb-8">
            <header className="flex items-center justify-between gap-2 px-4 pt-4 md:px-8 md:pt-5">
              <span className="text-base font-semibold md:hidden">Kompass{isDemo() ? " · demo" : ""}</span>
              <span className="hidden md:block" />
              <div className="flex min-w-0 items-center gap-2">
                {timer && <TimerChip startedAt={timer.startedAt.getTime()} targetMin={timer.targetMin} title={timer.title} stopLabel={t(lang, "timer.stop")} doneLabel={t(lang, "timer.done")} />}
                <PaletteButton />
                <Link href="/search" className={`${ctl} md:hidden`} aria-label={t(lang, "nav.search")}>⌕</Link>
                <Link href="/notes" className={`${ctl} md:hidden`} aria-label={t(lang, "nav.notes")}>✎</Link>
                <Link href="/settings" className={`${ctl} md:hidden`} aria-label={t(lang, "nav.settings")}>⚙</Link>
                {providers.length > 0 && <SyncButton label={t(lang, "sync.now")} busyLabel={t(lang, "sync.running")} />}
                <form action={toggleLangAction} className="hidden md:block"><button className={ctl}>{t(lang, "prefs.language")}</button></form>
                <form action={setThemeAction.bind(null, "light")} className="theme-light max-md:!hidden"><button className={ctl} title={t(lang, "prefs.theme")} aria-label={t(lang, "prefs.theme")}>☀</button></form>
                <form action={setThemeAction.bind(null, "dark")} className="theme-dark max-md:!hidden"><button className={ctl} title={t(lang, "prefs.theme")} aria-label={t(lang, "prefs.theme")}>☾</button></form>
              </div>
            </header>

            {providers.length === 0 && <Banner tone="warn">{t(lang, "sync.none")}</Banner>}
            {stale.map((s) => {
              const provider = PROVIDER_LABEL[s.provider] ?? s.provider;
              const text = s.lastRun?.status === "partial"
                ? t(lang, "sync.partial", { provider })
                : s.lastOkAt ? t(lang, "sync.stale", { provider, when: fmtDateTime(s.lastOkAt, lang, now) }) : t(lang, "sync.staleNever", { provider });
              return (
                <Banner key={s.provider} tone={s.lastRun?.status === "partial" ? "warn" : "danger"}>
                  {text} <Link href="/sync" className="font-medium underline">{t(lang, "sync.details")}</Link>
                </Banner>
              );
            })}

            <main className="px-4 py-5 md:px-8">{children}</main>
          </div>
        </div>

        <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-surface md:hidden">
          <NavLinks items={main.filter((n) => !["/found", "/notes", "/semester"].includes(n.href))} variant="bottom" />
        </nav>
        <CommandPalette pages={[...nav, { href: "/search", label: t(lang, "nav.search") }].map((n) => ({ href: n.href, label: n.label }))} labels={{ placeholder: t(lang, "palette.placeholder"), add: t(lang, "palette.add"), hint: t(lang, "palette.hint"), search: t(lang, "palette.search") }} />
      </body>
    </html>
  );
}

function Banner({ tone, children }: { tone: "warn" | "danger"; children: React.ReactNode }) {
  return (
    <div role="status" className={`mx-4 mt-3 rounded-lg px-3 py-2 text-sm md:mx-8 ${tone === "danger" ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn"}`}>
      {children}
    </div>
  );
}
