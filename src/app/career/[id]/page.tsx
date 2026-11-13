import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { applicationNotesAction, deleteApplicationAction, updateApplicationAction } from "../../actions";
import { Card } from "@/components/ui";
import { getDb } from "@/lib/db";
import { APPLICATION_STATUSES, APPLICATION_TYPES, applications, contacts } from "@/lib/db/schema";
import { t } from "@/lib/i18n";
import { getDoc } from "@/lib/notes/store";
import { getPrefs } from "@/lib/prefs";
import { fmtDate, startOfDay } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { lang } = await getPrefs();
  const id = Number((await params).id);
  const db = getDb();
  const a = Number.isInteger(id) ? db.select().from(applications).where(eq(applications.id, id)).get() : undefined;
  if (!a) notFound();
  const people = a.company ? db.select().from(contacts).all().filter((c) => c.company.trim().toLowerCase() === a.company.trim().toLowerCase()) : [];
  const hasNotes = Boolean(a.docId && getDoc(db, a.docId));
  const field = "w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <nav className="text-xs text-muted"><Link href="/career" className="hover:text-accent">{t(lang, "career.title")}</Link> / {t(lang, `career.st.${a.status}`)}</nav>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{a.company}{a.role ? <span className="font-normal text-muted"> · {a.role}</span> : null}</h1>
        <p className="mt-1 text-xs text-muted">
          {t(lang, `career.ty.${a.type}`)}
          {a.appliedAt && ` · ${t(lang, "career.applied", { date: fmtDate(startOfDay(a.appliedAt), lang) })}`}
          {a.url && <> · <a href={a.url} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">{t(lang, "career.posting")} ↗</a></>}
        </p>
      </header>

      <Card>
        <form action={updateApplicationAction.bind(null, a.id)} className="grid gap-3 p-4 sm:grid-cols-2">
          <label className="text-xs text-muted">{t(lang, "career.f.company")}<input name="company" required defaultValue={a.company} className={field} /></label>
          <label className="text-xs text-muted">{t(lang, "career.f.role")}<input name="role" defaultValue={a.role} className={field} /></label>
          <label className="text-xs text-muted">{t(lang, "career.f.status")}<select name="status" defaultValue={a.status} className={field}>{APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{t(lang, `career.st.${s}`)}</option>)}</select></label>
          <label className="text-xs text-muted">{t(lang, "career.f.type")}<select name="type" defaultValue={a.type} className={field}>{APPLICATION_TYPES.map((s) => <option key={s} value={s}>{t(lang, `career.ty.${s}`)}</option>)}</select></label>
          <label className="text-xs text-muted">{t(lang, "career.f.deadline")}<input type="date" name="deadline" defaultValue={a.deadline ?? ""} className={field} /></label>
          <label className="text-xs text-muted">{t(lang, "career.f.follow")}<input type="date" name="followUpAt" defaultValue={a.followUpAt ?? ""} className={field} /></label>
          <label className="text-xs text-muted sm:col-span-2">{t(lang, "career.f.url")}<input name="url" defaultValue={a.url ?? ""} placeholder="https://" className={field} /></label>
          <label className="text-xs text-muted">{t(lang, "career.f.cv")}<input name="cvVersion" defaultValue={a.cvVersion ?? ""} className={field} /></label>
          <label className="text-xs text-muted">{t(lang, "career.f.letter")}<input name="letterVersion" defaultValue={a.letterVersion ?? ""} className={field} /></label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-surface">{t(lang, "tasks.save")}</button>
            <button formAction={applicationNotesAction.bind(null, a.id)} formNoValidate className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2">{hasNotes ? t(lang, "career.notes") : t(lang, "career.notesNew")} →</button>
          </div>
        </form>
      </Card>

      {people.length > 0 && (
        <Card title={t(lang, "career.sameCompany", { company: a.company })}>
          <ul className="divide-y divide-border">
            {people.map((c) => <li key={c.id} className="px-4 py-2.5"><span className="font-medium">{c.name}</span> <span className="text-xs text-muted">{[c.title, c.email, c.metAt].filter(Boolean).join(" · ")}</span></li>)}
          </ul>
          <Link href="/career?tab=contacts" className="block border-t border-border px-4 py-2.5 text-sm font-medium text-accent hover:underline">{t(lang, "career.tab.contacts")} →</Link>
        </Card>
      )}

      <form action={deleteApplicationAction.bind(null, a.id)}><button className="text-xs text-muted hover:text-danger hover:underline">{t(lang, "career.delete")}</button></form>
    </div>
  );
}
