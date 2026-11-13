"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { captureAction, searchAction } from "@/app/actions";
import type { SearchHit } from "@/lib/search";

type Labels = { placeholder: string; add: string; hint: string; search: string };
type Command = { id: string; label: string; run: () => void };

/** ⌘K / Ctrl+K: jump to a page, or type a line to capture it as a task from anywhere. */
export function CommandPalette({ pages, labels }: { pages: { href: string; label: string }[]; labels: Labels }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);

  // Search as you type, a moment after the last keystroke; a newer query always wins.
  useEffect(() => {
    const text = q.trim();
    if (!open || text.length < 2) {
      setHits([]);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      searchAction(text).then((r) => { if (current) setHits(r); }).catch(() => {});
    }, 180);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [q, open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("kompass:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("kompass:palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      input.current?.focus();
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const text = q.trim();
    const nav = pages
      .filter((p) => !text || p.label.toLowerCase().startsWith(text.toLowerCase()))
      .map((p) => ({ id: p.href, label: p.label, run: () => router.push(p.href) }));
    if (!text) return nav;
    const add: Command = {
      id: "add",
      label: `${labels.add}: ${text}`,
      run: () => start(async () => {
        const fd = new FormData();
        fd.set("text", text);
        await captureAction(fd);
      }),
    };
    const found: Command[] = hits.map((h) => ({
      id: `hit:${h.type}:${h.ref}`,
      label: `${h.title}${h.course ? ` · ${h.course}` : ""}${h.external ? " ↗" : ""}`,
      run: () => (h.external ? window.open(h.url, "_blank", "noopener,noreferrer") : router.push(h.url || "/search")),
    }));
    const all: Command = { id: "search", label: `${labels.search}: ${text}`, run: () => router.push(`/search?q=${encodeURIComponent(text)}`) };
    return [...nav, add, all, ...found];
  }, [q, pages, labels.add, labels.search, router, hits]);

  if (!open) return null;
  const run = (c: Command | undefined) => {
    if (!c) return;
    setOpen(false);
    c.run();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[14vh]" onMouseDown={() => setOpen(false)} role="dialog" aria-modal="true">
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <input ref={input} value={q} placeholder={labels.placeholder} autoComplete="off"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, commands.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); run(commands[sel]); }
          }}
          className="w-full border-b border-border bg-transparent px-4 py-3 text-base outline-none" />
        <ul className="max-h-72 overflow-y-auto py-1">
          {commands.map((c, i) => (
            <li key={c.id}>
              <button type="button" onMouseEnter={() => setSel(i)} onClick={() => run(c)}
                className={`block w-full truncate px-4 py-2 text-left text-sm ${i === sel ? "bg-accent-soft text-accent" : ""}`}>
                {c.label}
              </button>
            </li>
          ))}
        </ul>
        <p className="border-t border-border px-4 py-2 text-xs text-muted">{labels.hint}</p>
      </div>
    </div>
  );
}

export function PaletteButton() {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event("kompass:palette"))}
      className="hidden rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-text md:block" aria-label="Command palette">
      ⌘K
    </button>
  );
}
