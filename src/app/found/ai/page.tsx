import Link from "next/link";
import { redirect } from "next/navigation";
import { runLlmAction } from "../../actions";
import { Card, Empty } from "@/components/ui";
import { getDb } from "@/lib/db";
import { hasKey, t } from "@/lib/i18n";
import { buildPrompt, llmEnabled, llmModel } from "@/lib/llm/extract";
import { llmCandidates } from "@/lib/llm/run";
import { getPrefs } from "@/lib/prefs";
import { dateKey } from "@/lib/time";

export const dynamic = "force-dynamic";

/** The consent step: shows every character that would be sent before anything leaves the machine. */
export default async function AiPreviewPage() {
  if (!llmEnabled()) redirect("/found");
  const { lang } = await getPrefs();
  const now = new Date();
  const today = dateKey(now);
  const list = llmCandidates(getDb(), now);
  const sendable = list.filter((c) => !c.tooLong);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <nav className="text-xs text-muted"><Link href="/found" className="hover:text-accent">{t(lang, "found.title")}</Link> / AI</nav>
      <h1 className="text-2xl font-semibold tracking-tight">{t(lang, "ai.pageTitle")}</h1>
      <p className="rounded-xl border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">{t(lang, "ai.pageHint", { model: llmModel() })}</p>
      <form action={runLlmAction} className="space-y-5">
        <Card>
          {list.length === 0 && <Empty>{t(lang, "ai.none")}</Empty>}
          <ul className="divide-y divide-border">
            {list.map((c) => {
              const k = `kind.${c.kind}`;
              const prompt = buildPrompt(c.source, today);
              return (
                <li key={c.id} className="px-4 py-3">
                  <label className="flex items-start gap-3">
                    <input type="checkbox" name="id" value={c.id} defaultChecked={!c.tooLong} disabled={c.tooLong} className="mt-1 h-4 w-4" />
                    <span className="min-w-0">
                      <span className="block font-medium">{c.title}</span>
                      <span className="block text-xs text-muted">{[hasKey(k) ? t(lang, k) : c.kind, c.course, c.source.posted].filter(Boolean).join(" · ")}{c.tooLong ? ` · ${t(lang, "ai.tooLong")}` : ""}</span>
                    </span>
                  </label>
                  {!c.tooLong && (
                    <details className="ml-7 mt-1.5">
                      <summary className="cursor-pointer text-xs text-accent">{t(lang, "ai.showText", { n: prompt.user.length })}</summary>
                      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-bg p-3 text-xs">{prompt.user}</pre>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
        {sendable.length > 0 && (
          <>
            <details className="rounded-xl border border-border bg-surface">
              <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-muted">{t(lang, "ai.instruction")}</summary>
              <pre className="whitespace-pre-wrap border-t border-border p-4 text-xs">{buildPrompt(sendable[0].source, today).system}</pre>
            </details>
            <button className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-surface">{t(lang, "ai.send")}</button>
          </>
        )}
      </form>
    </div>
  );
}
