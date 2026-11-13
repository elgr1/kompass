import Link from "next/link";
import { createDatabaseAction, createPageAction } from "../actions";
import { Card, Empty } from "@/components/ui";
import { getDb } from "@/lib/db";
import { t } from "@/lib/i18n";
import { getDatabases, getDocTree, getRows, type DocNode } from "@/lib/notes/store";
import { DB_TEMPLATES, PAGE_TEMPLATES } from "@/lib/notes/templates";
import { getPrefs } from "@/lib/prefs";
import { fmtRelative, type Lang } from "@/lib/time";

export const dynamic = "force-dynamic";
const field = "rounded-lg border border-border bg-bg px-2 py-1.5 text-sm";
const primary = "rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-surface";

function Tree({ nodes, lang, now, depth = 0 }: { nodes: DocNode[]; lang: Lang; now: Date; depth?: number }) {
  return (
    <ul className={depth ? "border-l border-border" : "divide-y divide-border"} style={depth ? { marginLeft: 22 } : undefined}>
      {nodes.map((n) => (
        <li key={n.id}>
          <Link href={`/notes/${n.id}`} className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-surface-2">
            <span className="min-w-0 truncate font-medium">{n.title}</span>
            <span className="shrink-0 text-xs text-muted">{fmtRelative(n.updatedAt, lang, now)}</span>
          </Link>
          {n.children.length > 0 && <Tree nodes={n.children} lang={lang} now={now} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

export default async function NotesPage() {
  const { lang } = await getPrefs();
  const db = getDb();
  const now = new Date();
  const tree = getDocTree(db);
  const dbs = getDatabases(db);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t(lang, "notes.title")}</h1>
        <p className="mt-0.5 text-sm text-muted">{t(lang, "notes.subtitle")}</p>
      </div>

      <Card title={t(lang, "notes.pages")}
        action={
          <form action={createPageAction} className="flex gap-2">
            <select name="template" aria-label={t(lang, "notes.template")} className={field}>{PAGE_TEMPLATES.map((p) => <option key={p.key} value={p.key}>{p.name[lang]}</option>)}</select>
            <button className={primary}>{t(lang, "notes.newPage")}</button>
          </form>
        }>
        {tree.length === 0 ? <Empty>{t(lang, "notes.noPages")}</Empty> : <Tree nodes={tree} lang={lang} now={now} />}
      </Card>

      <Card title={t(lang, "notes.databases")}
        action={
          <form action={createDatabaseAction} className="flex gap-2">
            <select name="template" aria-label={t(lang, "notes.template")} className={field}>{DB_TEMPLATES.map((p) => <option key={p.key} value={p.key}>{p.name[lang]}</option>)}</select>
            <button className={primary}>{t(lang, "notes.newDb")}</button>
          </form>
        }>
        {dbs.length === 0 ? <Empty>{t(lang, "notes.noDbs")}</Empty> : (
          <ul className="divide-y divide-border">
            {dbs.map((d) => (
              <li key={d.id}>
                <Link href={`/db/${d.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-2">
                  <span className="font-medium">{d.title}</span>
                  <span className="text-xs text-muted">{t(lang, "notes.rows", { n: getRows(db, d.id).length })} · {d.views.map((v) => v.name).join(", ")}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
