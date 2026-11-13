import { createPageAction } from "../../actions";
import { Card } from "@/components/ui";
import { t } from "@/lib/i18n";
import { PAGE_TEMPLATES } from "@/lib/notes/templates";
import { getPrefs } from "@/lib/prefs";

export const dynamic = "force-dynamic";

/** Where a [[link]] to a page that does not exist yet leads: one click creates it. */
export default async function NewPage({ searchParams }: { searchParams: Promise<{ title?: string; parent?: string }> }) {
  const { lang } = await getPrefs();
  const sp = await searchParams;
  const field = "rounded-lg border border-border bg-bg px-3 py-2 text-sm";
  return (
    <div className="mx-auto max-w-xl pt-4">
      <Card title={t(lang, "notes.newPage")}>
        <form action={createPageAction} className="flex flex-wrap gap-2 p-4">
          <input type="hidden" name="parentId" value={sp.parent ?? ""} />
          <input name="title" defaultValue={sp.title ?? ""} placeholder={t(lang, "notes.titlePh")} autoFocus className={`${field} min-w-0 flex-1 basis-56`} />
          <select name="template" aria-label={t(lang, "notes.template")} className={field}>{PAGE_TEMPLATES.map((p) => <option key={p.key} value={p.key}>{p.name[lang]}</option>)}</select>
          <button className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-surface">{t(lang, "notes.create")}</button>
        </form>
      </Card>
    </div>
  );
}
