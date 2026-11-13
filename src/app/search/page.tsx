import Link from "next/link";
import { Card, Empty } from "@/components/ui";
import { getDb } from "@/lib/db";
import { hasKey, t } from "@/lib/i18n";
import { getPrefs } from "@/lib/prefs";
import { search, type SearchHit } from "@/lib/search";
import type { Lang } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Snippets mark matches with control characters; turn them into <mark> without using raw HTML. */
function Snippet({ text }: { text: string }) {
  return <>{text.split(/[\u0002\u0003]/).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>))}</>;
}

function kindLabel(h: SearchHit, lang: Lang): string {
  const own = `search.kind.${h.kind}`;
  const mirrored = `kind.${h.kind}`;
  return hasKey(own) ? t(lang, own) : hasKey(mirrored) ? t(lang, mirrored) : h.kind;
}

function Hits({ hits, lang }: { hits: SearchHit[]; lang: Lang }) {
  return (
    <ul className="divide-y divide-border">
      {hits.map((h) => {
        const body = (
          <>
            <div className="font-medium">{h.title}{h.external && <span className="ml-1 text-xs text-muted">↗</span>}</div>
            <div className="text-xs text-muted">{[kindLabel(h, lang), h.course].filter(Boolean).join(" · ")}</div>
            {h.snippet && <p className="mt-1 text-sm text-muted"><Snippet text={h.snippet} /></p>}
          </>
        );
        const cls = "block px-4 py-3 hover:bg-surface-2";
        return (
          <li key={`${h.type}:${h.ref}`}>
            {!h.url ? <div className={cls}>{body}</div> : h.external ? <a href={h.url} target="_blank" rel="noreferrer noopener" className={cls}>{body}</a> : <Link href={h.url} className={cls}>{body}</Link>}
          </li>
        );
      })}
    </ul>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { lang } = await getPrefs();
  const q = ((await searchParams).q ?? "").slice(0, 200);
  const hits = q.trim() ? search(getDb(), q) : [];
  const mine = hits.filter((h) => !h.external);
  const mirrored = hits.filter((h) => h.external);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">{t(lang, "search.title")}</h1>
      <form method="get" action="/search" className="flex gap-2">
        <input name="q" defaultValue={q} autoFocus placeholder={t(lang, "search.placeholder")} autoComplete="off"
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 py-2.5 text-base outline-none focus:border-accent" />
        <button className="rounded-xl bg-accent px-4 text-sm font-semibold text-surface">{t(lang, "search.title")}</button>
      </form>
      <p className="text-xs text-muted">{t(lang, "search.hint")}</p>
      {q.trim() && hits.length === 0 && <Card><Empty>{t(lang, "search.none", { q })}</Empty></Card>}
      {mine.length > 0 && <Card title={`${t(lang, "search.mine")} (${mine.length})`}><Hits hits={mine} lang={lang} /></Card>}
      {mirrored.length > 0 && <Card title={`${t(lang, "search.mirrored")} (${mirrored.length})`}><Hits hits={mirrored} lang={lang} /></Card>}
    </div>
  );
}
