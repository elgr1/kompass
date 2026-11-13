"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveDocAction } from "@/app/actions";

type Labels = { saved: string; saving: string; unsaved: string; done: string; preview: string; titlePh: string; help: string; tb: Record<"h" | "task" | "callout" | "code" | "math" | "link" | "table", string> };

const SNIPPETS: Record<keyof Labels["tb"], { before: string; after: string; block?: boolean }> = {
  h: { before: "## ", after: "", block: true },
  task: { before: "- [ ] ", after: "", block: true },
  callout: { before: "> [!note] ", after: "\n> ", block: true },
  code: { before: "```\n", after: "\n```", block: true },
  math: { before: "$$\n", after: "\n$$", block: true },
  link: { before: "[[", after: "]]" },
  table: { before: "| A | B |\n| --- | --- |\n| ", after: " |  |", block: true },
};

/** Markdown source on the left, the real rendering on the right. Saves by itself while you type. */
export function DocEditor({ id, initialTitle, initialContent, initialHtml, labels }: { id: number; initialTitle: string; initialContent: string; initialHtml: string; labels: Labels }) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [html, setHtml] = useState(initialHtml);
  const [state, setState] = useState<"saved" | "saving" | "unsaved">("saved");
  const area = useRef<HTMLTextAreaElement>(null);
  const latest = useRef({ title, content });
  latest.current = { title, content };
  const seq = useRef(0);

  const save = useCallback(async () => {
    const mine = ++seq.current;
    setState("saving");
    const { title: t, content: c } = latest.current;
    const res = await saveDocAction(id, t, c);
    // Only the newest save may update the preview, so a slow response cannot show stale text.
    if (mine === seq.current) {
      setHtml(res.html);
      setState(latest.current.title === t && latest.current.content === c ? "saved" : "unsaved");
    }
  }, [id]);

  useEffect(() => {
    if (title === initialTitle && content === initialContent && seq.current === 0) return;
    setState("unsaved");
    const timer = setTimeout(save, 700);
    return () => clearTimeout(timer);
  }, [title, content, initialTitle, initialContent, save]);

  // Start writing at the end of the page, not before its first character.
  useEffect(() => {
    const el = area.current;
    if (el) el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const done = useCallback(async () => {
    await save();
    router.push(`/notes/${id}`);
    router.refresh();
  }, [save, router, id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
      else if (e.key === "Enter") { e.preventDefault(); void done(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, done]);

  const insert = (key: keyof Labels["tb"]) => {
    const el = area.current;
    if (!el) return;
    const s = SNIPPETS[key];
    const { selectionStart: a, selectionEnd: b } = el;
    const lead = s.block && a > 0 && content[a - 1] !== "\n" ? "\n" : "";
    const next = content.slice(0, a) + lead + s.before + content.slice(a, b) + s.after + content.slice(b);
    setContent(next);
    const pos = a + lead.length + s.before.length + (b - a);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
  };

  // Tab indents instead of leaving the editor; Enter continues a list or checklist.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const { selectionStart: a, selectionEnd: b } = el;
    if (e.key === "Tab") {
      e.preventDefault();
      setContent(content.slice(0, a) + "  " + content.slice(b));
      requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
    } else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && a === b) {
      const lineStart = content.lastIndexOf("\n", a - 1) + 1;
      const line = content.slice(lineStart, a);
      const m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/);
      if (!m) return;
      e.preventDefault();
      if (line.trim() === m[0].trim()) {
        // an empty item ends the list
        setContent(content.slice(0, lineStart) + content.slice(a));
        requestAnimationFrame(() => el.setSelectionRange(lineStart, lineStart));
        return;
      }
      const num = m[2].match(/^(\d+)([.)])$/);
      const bullet = num ? `${Number(num[1]) + 1}${num[2]}` : m[2];
      const add = `\n${m[1]}${bullet} ${m[3] ? "[ ] " : ""}`;
      setContent(content.slice(0, a) + add + content.slice(a));
      requestAnimationFrame(() => el.setSelectionRange(a + add.length, a + add.length));
    }
  };

  const tb = "rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-text";
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={labels.titlePh} aria-label={labels.titlePh}
          className="min-w-0 flex-1 border-0 bg-transparent text-2xl font-semibold tracking-tight outline-none" />
        <span className={`shrink-0 text-xs ${state === "saved" ? "text-muted" : "text-warn"}`}>{labels[state]}</span>
        <button type="button" onClick={() => void done()} className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-surface">{labels.done}</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(SNIPPETS) as (keyof Labels["tb"])[]).map((k) => <button key={k} type="button" onClick={() => insert(k)} className={tb}>{labels.tb[k]}</button>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <textarea ref={area} value={content} onChange={(e) => setContent(e.target.value)} onKeyDown={onKeyDown} spellCheck autoFocus
          className="min-h-[60vh] w-full resize-y rounded-xl border border-border bg-surface p-4 font-mono text-[13px] leading-6 outline-none focus:border-accent" />
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted">{labels.preview}</p>
          <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
      <p className="text-xs text-muted">{labels.help}</p>
    </div>
  );
}
