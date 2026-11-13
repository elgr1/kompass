import { asc } from "drizzle-orm";
import Link from "next/link";
import {
  addApplicationAction, addCareerEventAction, deleteCareerEventAction, deleteContactAction, moveApplicationAction, resetExjobbStepsAction, saveContactAction, saveExjobbAction, touchContactAction,
} from "../actions";
import { Board } from "@/components/Board";
import { Card, Empty } from "@/components/ui";
import { contactsDue, exjobbDates } from "@/lib/career/logic";
import { getExjobb } from "@/lib/career/store";
import { getDb } from "@/lib/db";
import { APPLICATION_STATUSES, applications, careerEvents, contacts, type Contact } from "@/lib/db/schema";
import { t } from "@/lib/i18n";
import { getPrefs } from "@/lib/prefs";
import { dateKey, fmtDate, fmtDay, fmtRelative, startOfDay, type Lang } from "@/lib/time";

export const dynamic = "force-dynamic";
const TABS = ["pipeline", "contacts", "events", "exjobb"] as const;
type Tab = (typeof TABS)[number];
const field = "rounded-lg border border-border bg-bg px-2 py-1.5 text-sm";
const btn = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2";
const small = "rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-text";
const primary = "rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-surface";
const day = (key: string, lang: Lang) => fmtDate(startOfDay(key), lang);

function ContactForm({ c, lang }: { c: Contact | null; lang: Lang }) {
  return (
    <form action={saveContactAction.bind(null, c?.id ?? null)} className="grid gap-2 p-4 sm:grid-cols-3">
      <label className="text-xs text-muted">{t(lang, "contacts.name")}<input name="name" required defaultValue={c?.name ?? ""} className={`${field} w-full`} /></label>
      <label className="text-xs text-muted">{t(lang, "career.f.company")}<input name="company" defaultValue={c?.company ?? ""} className={`${field} w-full`} /></label>
      <label className="text-xs text-muted">{t(lang, "contacts.role")}<input name="title" defaultValue={c?.title ?? ""} className={`${field} w-full`} /></label>
      <label className="text-xs text-muted">{t(lang, "contacts.email")}<input name="email" type="email" defaultValue={c?.email ?? ""} className={`${field} w-full`} /></label>
      <label className="text-xs text-muted">{t(lang, "contacts.link")}<input name="link" defaultValue={c?.link ?? ""} className={`${field} w-full`} /></label>
      <label className="text-xs text-muted">{t(lang, "contacts.met")}<input name="metAt" defaultValue={c?.metAt ?? ""} className={`${field} w-full`} /></label>
      <label className="text-xs text-muted">{t(lang, "contacts.last")}<input name="lastContacted" type="date" defaultValue={c?.lastContacted ?? ""} className={`${field} w-full`} /></label>
      <label className="text-xs text-muted">{t(lang, "contacts.nudge")}<input name="nudgeDays" type="number" min={1} defaultValue={c?.nudgeDays ?? 90} className={`${field} w-full`} /></label>
      <label className="text-xs text-muted sm:col-span-3">{t(lang, "contacts.notes")}<input name="notes" defaultValue={c?.notes ?? ""} className={`${field} w-full`} /></label>
      <div className="flex gap-2 sm:col-span-3">
        <button className={primary}>{t(lang, "tasks.save")}</button>
        {c && <button formAction={deleteContactAction.bind(null, c.id)} formNoValidate className={`${btn} text-danger`}>{t(lang, "tasks.delete")}</button>}
      </div>
    </form>
  );
}

export default async function CareerPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { lang } = await getPrefs();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "pipeline";
  const db = getDb();
  const now = new Date();
  const today = dateKey(now);

  let body: React.ReactNode = null;

  if (tab === "pipeline") {
    const apps = db.select().from(applications).all();
    const columns = APPLICATION_STATUSES.map((st) => ({
      key: st,
      label: t(lang, `career.st.${st}`),
      cards: apps
        .filter((a) => a.status === st)
        .sort((a, b) => (a.deadline ?? "9").localeCompare(b.deadline ?? "9"))
        .map((a) => ({ id: a.id, title: a.company, meta: [a.role, t(lang, `career.ty.${a.type}`), a.deadline && !a.appliedAt ? `⏱ ${day(a.deadline, lang)}` : null, a.appliedAt ? t(lang, "career.applied", { date: day(a.appliedAt, lang) }) : null].filter((x): x is string => Boolean(x)) })),
    }));
    body = (
      <>
        <p className="text-sm text-muted">{t(lang, "career.hint")}</p>
        <Board columns={columns} noneLabel="" addLabel={t(lang, "career.newCompany")} hrefPrefix="/career/" moveAction={moveApplicationAction} addAction={addApplicationAction} />
      </>
    );
  }

  if (tab === "contacts") {
    const all = db.select().from(contacts).orderBy(asc(contacts.name)).all();
    const due = contactsDue(all, today);
    const Row = ({ c, nudge }: { c: Contact; nudge?: boolean }) => (
      <li>
        <details>
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
            <div className="min-w-0 flex-1 basis-48">
              <div className="font-medium">{c.name}</div>
              <div className="truncate text-xs text-muted">{[c.title, c.company, c.metAt].filter(Boolean).join(" · ")}</div>
            </div>
            <span className={`text-xs ${nudge ? "font-semibold text-warn" : "text-muted"}`}>{t(lang, "contacts.last")}: {c.lastContacted ? fmtRelative(startOfDay(c.lastContacted), lang, now) : t(lang, "contacts.never")}</span>
          </summary>
          <div className="flex flex-wrap gap-2 px-4">
            <form action={touchContactAction.bind(null, c.id)}><button className={small}>✓ {t(lang, "contacts.touch")}</button></form>
            {c.email && <a href={`mailto:${c.email}`} className={small}>{c.email}</a>}
            {c.link && <a href={c.link} target="_blank" rel="noreferrer noopener" className={small}>↗ {t(lang, "contacts.link")}</a>}
          </div>
          <ContactForm c={c} lang={lang} />
        </details>
      </li>
    );
    body = (
      <>
        {due.length > 0 && <Card title={`${t(lang, "contacts.due")} (${due.length})`}><ul className="divide-y divide-border">{due.map((c) => <Row key={c.id} c={c} nudge />)}</ul></Card>}
        <Card title={`${t(lang, "contacts.all")} (${all.length})`}>
          {all.length === 0 ? <Empty>{t(lang, "contacts.none")}</Empty> : <ul className="divide-y divide-border">{all.map((c) => <Row key={c.id} c={c} />)}</ul>}
          <details className="border-t border-border">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-accent">{t(lang, "contacts.add")}</summary>
            <ContactForm c={null} lang={lang} />
          </details>
        </Card>
      </>
    );
  }

  if (tab === "events") {
    const all = db.select().from(careerEvents).orderBy(asc(careerEvents.startDate)).all();
    const upcoming = all.filter((e) => (e.endDate ?? e.startDate) >= today);
    const past = all.filter((e) => (e.endDate ?? e.startDate) < today).reverse();
    const Row = ({ e }: { e: (typeof all)[number] }) => (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
        <div className="tnum w-36 shrink-0 text-xs text-muted"><span className="font-medium text-text">{fmtDay(startOfDay(e.startDate), lang)}</span>{e.endDate && e.endDate !== e.startDate ? ` – ${day(e.endDate, lang)}` : ""}</div>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{e.url ? <a href={e.url} target="_blank" rel="noreferrer noopener" className="hover:text-accent hover:underline">{e.title} ↗</a> : e.title}</div>
          <div className="text-xs text-muted">{[t(lang, `cev.kind.${e.kind}`), e.location].filter(Boolean).join(" · ")}</div>
        </div>
        <form action={deleteCareerEventAction.bind(null, e.id)}><button className={small} aria-label={t(lang, "tasks.delete")}>×</button></form>
      </li>
    );
    body = (
      <Card>
        {all.length === 0 && <Empty>{t(lang, "cev.none")}</Empty>}
        <ul className="divide-y divide-border">{upcoming.map((e) => <Row key={e.id} e={e} />)}</ul>
        {past.length > 0 && <details className="border-t border-border"><summary className="cursor-pointer px-4 py-2.5 text-sm text-muted">{t(lang, "cev.past")} ({past.length})</summary><ul className="divide-y divide-border opacity-70">{past.map((e) => <Row key={e.id} e={e} />)}</ul></details>}
        <form action={addCareerEventAction} className="flex flex-wrap items-end gap-2 border-t border-border p-4">
          <input name="title" required placeholder={t(lang, "cev.add")} className={`${field} min-w-0 flex-1 basis-56`} />
          <select name="kind" className={field} aria-label={t(lang, "career.f.type")}>{(["fair", "window", "other"] as const).map((k) => <option key={k} value={k}>{t(lang, `cev.kind.${k}`)}</option>)}</select>
          <label className="text-xs text-muted">{t(lang, "cev.from")}<br /><input type="date" name="startDate" required className={field} /></label>
          <label className="text-xs text-muted">{t(lang, "cev.to")}<br /><input type="date" name="endDate" className={field} /></label>
          <input name="location" placeholder={t(lang, "cev.place")} className={`${field} w-36`} />
          <input name="url" placeholder="https://" className={`${field} w-40`} />
          <button className={btn}>{t(lang, "capture.add")}</button>
        </form>
      </Card>
    );
  }

  if (tab === "exjobb") {
    const plan = getExjobb(db, lang);
    const steps = exjobbDates(plan, today);
    body = (
      <Card title={t(lang, "exj.title")} hint={t(lang, "exj.hint")}>
        <form action={saveExjobbAction}>
          <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-3">
            <label className="text-xs text-muted">{t(lang, "exj.start")}<input type="date" name="start" defaultValue={plan.start ?? ""} className={`${field} w-full`} /></label>
            <label className="text-xs text-muted">{t(lang, "exj.contact")}<input name="contact" defaultValue={plan.contact} className={`${field} w-full`} /></label>
            <label className="text-xs text-muted">{t(lang, "exj.reviewer")}<input name="reviewer" defaultValue={plan.reviewer} className={`${field} w-full`} /></label>
            <label className="text-xs text-muted sm:col-span-3">{t(lang, "exj.notes")}<textarea name="notes" rows={2} defaultValue={plan.notes} className={`${field} w-full`} /></label>
          </div>
          {!plan.start && <p className="border-b border-border bg-warn-soft px-4 py-2 text-sm text-warn">{t(lang, "exj.noStart")}</p>}
          <ol className="divide-y divide-border">
            {steps.map((s) => (
              <li key={s.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 ${s.done ? "opacity-60" : ""}`}>
                <input type="checkbox" name={`done_${s.id}`} defaultChecked={s.done} aria-label={t(lang, "tasks.markDone")} className="h-4 w-4 accent-[var(--accent)]" />
                <div className={`tnum w-28 shrink-0 text-xs ${s.late ? "font-semibold text-danger" : "text-muted"}`}>
                  {s.date ? <><span className="font-medium">{day(s.date, lang)}</span> {s.date.slice(0, 4)}{s.late ? ` · ${t(lang, "exj.late")}` : ""}</> : "–"}
                </div>
                <input name={`title_${s.id}`} defaultValue={s.title} aria-label={t(lang, "tasks.f.title")} className={`${field} min-w-0 flex-1 basis-64 ${s.done ? "line-through" : ""}`} />
                <label className="flex items-center gap-1 text-xs text-muted"><input name={`offset_${s.id}`} type="number" defaultValue={-s.offset} aria-label={t(lang, "exj.days")} className={`${field} w-20 text-right`} />d</label>
                <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" name={`del_${s.id}`} />{t(lang, "exj.remove")}</label>
              </li>
            ))}
            <li className="flex flex-wrap items-center gap-3 px-4 py-2">
              <span className="w-4" /><span className="w-28" />
              <input name="newTitle" placeholder={t(lang, "exj.newStep")} className={`${field} min-w-0 flex-1 basis-64`} />
              <label className="flex items-center gap-1 text-xs text-muted"><input name="newOffset" type="number" placeholder="30" className={`${field} w-20 text-right`} />d</label>
            </li>
          </ol>
          <div className="flex flex-wrap items-center gap-3 border-t border-border p-4">
            <button className={primary}>{t(lang, "tasks.save")}</button>
            <button formAction={resetExjobbStepsAction} className={btn}>{t(lang, "exj.reset")}</button>
            <Link href="/found" className="text-xs text-accent hover:underline">{t(lang, "exj.found")}</Link>
          </div>
        </form>
      </Card>
    );
  }

  return (
    <div className={`mx-auto space-y-5 ${tab === "pipeline" ? "max-w-none" : "max-w-4xl"}`}>
      <h1 className="text-2xl font-semibold tracking-tight">{t(lang, "career.title")}</h1>
      <div className="flex max-w-3xl gap-1 rounded-lg bg-surface-2 p-1 text-sm">
        {TABS.map((k) => <Link key={k} href={k === "pipeline" ? "/career" : `/career?tab=${k}`} className={`flex-1 rounded-md px-2 py-1.5 text-center font-medium ${tab === k ? "bg-surface shadow-sm" : "text-muted hover:text-text"}`}>{t(lang, `career.tab.${k}`)}</Link>)}
      </div>
      {body}
    </div>
  );
}
