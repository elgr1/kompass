import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteDocAction } from "../../actions";
import { DocEditor } from "@/components/DocEditor";
import { PropInput } from "@/components/PropInput";
import { RenderedDoc } from "@/components/RenderedDoc";
import { getDb } from "@/lib/db";
import { docs } from "@/lib/db/schema";
import { t } from "@/lib/i18n";
import { taskProgress } from "@/lib/notes/markdown";
import { getBacklinks, getDatabase, getDoc, renderDoc } from "@/lib/notes/store";
import { getPrefs } from "@/lib/prefs";
import { getCourses } from "@/lib/queries";
import { fmtRelative } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function DocPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { lang } = await getPrefs();
  const id = Number((await params).id);
  const editing = (await searchParams).edit === "1";
  const db = getDb();
  const doc = Number.isInteger(id) ? getDoc(db, id) : null;
  if (!doc) notFound();
  const now = new Date();
  const html = renderDoc(db, doc.content, lang);
  const database = doc.databaseId ? getDatabase(db, doc.databaseId) : null;
  const parent = doc.parentId ? getDoc(db, doc.parentId) : null;
  const children = db.select({ id: docs.id, title: docs.title }).from(docs).where(eq(docs.parentId, doc.id)).all();
  const backlinks = getBacklinks(db, doc.id);
  const progress = taskProgress(doc.content);
  const courses = [...getCourses(db).values()].filter((c) => !c.id.startsWith("timeedit:")).map((c) => ({ id: c.id, name: c.shortName }));
  const small = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2";

  const crumbs = (
    <nav className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
      <Link href="/notes" className="hover:text-accent">{t(lang, "notes.title")}</Link>
      {database && <><span>/</span><Link href={`/db/${database.id}`} className="hover:text-accent">{database.title}</Link></>}
      {parent && <><span>/</span><Link href={`/notes/${parent.id}`} className="hover:text-accent">{parent.title}</Link></>}
    </nav>
  );

  if (editing) {
    return (
      <div className="mx-auto max-w-6xl space-y-3">
        {crumbs}
        <DocEditor id={doc.id} initialTitle={doc.title} initialContent={doc.content} initialHtml={html}
          labels={{
            saved: t(lang, "notes.saved"), saving: t(lang, "notes.saving"), unsaved: t(lang, "notes.unsaved"), done: t(lang, "notes.done"), preview: t(lang, "notes.preview"),
            titlePh: t(lang, "notes.titlePh"), help: t(lang, "notes.help"),
            tb: { h: t(lang, "notes.tb.h"), task: t(lang, "notes.tb.task"), callout: t(lang, "notes.tb.callout"), code: t(lang, "notes.tb.code"), math: t(lang, "notes.tb.math"), link: t(lang, "notes.tb.link"), table: t(lang, "notes.tb.table") },
          }} />
      </div>
    );
  }

  return (
    <article className="mx-auto max-w-3xl space-y-5">
      {crumbs}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight">{doc.title}</h1>
          <p className="mt-1 text-xs text-muted">
            {t(lang, "notes.updated", { when: fmtRelative(doc.updatedAt, lang, now) })}
            {progress.total > 0 && ` · ☑ ${progress.done}/${progress.total}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/notes/${doc.id}?edit=1`} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-surface">{t(lang, "notes.edit")}</Link>
          {!database && <Link href={`/notes/new?parent=${doc.id}`} className={small}>{t(lang, "notes.subpage")}</Link>}
        </div>
      </header>

      {database && database.props.length > 0 && (
        <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-surface p-3">
          {database.props.map((p) => (
            <div key={p.id} className="contents">
              <dt className="text-sm text-muted">{p.name}</dt>
              <dd className="min-w-0"><PropInput rowId={doc.id} def={p} value={doc.props[p.id]} courses={courses} emptyLabel="–" /></dd>
            </div>
          ))}
        </dl>
      )}

      <div className="rounded-xl border border-border bg-surface p-5 md:p-7">
        {doc.content.trim() ? <RenderedDoc id={doc.id} html={html} /> : <p className="text-sm text-muted">{t(lang, "notes.empty")}</p>}
      </div>

      {children.length > 0 && (
        <section>
          <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{t(lang, "notes.subpages")}</h2>
          <ul className="flex flex-wrap gap-2">{children.map((c) => <li key={c.id}><Link href={`/notes/${c.id}`} className={small}>{c.title}</Link></li>)}</ul>
        </section>
      )}
      {backlinks.length > 0 && (
        <section>
          <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{t(lang, "notes.backlinks")}</h2>
          <ul className="flex flex-wrap gap-2">{backlinks.map((b) => <li key={b.id}><Link href={`/notes/${b.id}`} className={small}>← {b.title}</Link></li>)}</ul>
        </section>
      )}

      <form action={deleteDocAction.bind(null, doc.id)} className="pt-4">
        <button className="text-xs text-muted hover:text-danger hover:underline">{t(lang, "notes.delete")}</button>
      </form>
    </article>
  );
}
