"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";

export type BoardCard = { id: number; title: string; meta: string[]; href?: string };
export type BoardColumn = { key: string; label?: string; cards: BoardCard[] };

/**
 * Kanban board used by databases, the application pipeline and project tasks.
 * Drag a card to another column, or use the dropdown on the card (keyboard and touch).
 */
export function Board({ columns, noneLabel, addLabel, hrefPrefix, moveAction, addAction, addExtra }: {
  columns: BoardColumn[];
  noneLabel: string;
  addLabel: string;
  hrefPrefix?: string;
  moveAction: (cardId: number, to: string) => Promise<void>;
  addAction?: (formData: FormData) => Promise<void>;
  /** extra hidden fields for the add form */
  addExtra?: Record<string, string>;
}) {
  const [cols, setCols] = useState(columns);
  const [over, setOver] = useState<string | null>(null);
  const [, start] = useTransition();
  useEffect(() => setCols(columns), [columns]);
  const name = (c: BoardColumn) => c.label ?? (c.key || noneLabel);

  const move = (cardId: number, to: string) => {
    const from = cols.find((c) => c.cards.some((x) => x.id === cardId));
    if (!from || from.key === to) return;
    const card = from.cards.find((x) => x.id === cardId)!;
    // show the move at once; the server result replaces this state when it arrives
    setCols(cols.map((c) => (c.key === from.key ? { ...c, cards: c.cards.filter((x) => x.id !== cardId) } : c.key === to ? { ...c, cards: [...c.cards, card] } : c)));
    start(() => moveAction(cardId, to));
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {cols.map((col) => (
        <section key={col.key} onDragOver={(e) => { e.preventDefault(); setOver(col.key); }} onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
          onDrop={(e) => { e.preventDefault(); setOver(null); const id = Number(e.dataTransfer.getData("text/plain")); if (id) move(id, col.key); }}
          className={`flex w-60 shrink-0 flex-col rounded-xl border bg-surface-2 p-2 ${over === col.key ? "border-accent" : "border-border"}`}>
          <header className="flex items-center justify-between px-1.5 pb-2 text-sm font-semibold">
            <span className={col.key ? "" : "text-muted"}>{name(col)}</span>
            <span className="tnum text-xs font-normal text-muted">{col.cards.length}</span>
          </header>
          <ul className="flex min-h-10 flex-col gap-2">
            {col.cards.map((card) => {
              const href = card.href ?? (hrefPrefix ? `${hrefPrefix}${card.id}` : null);
              return (
                <li key={card.id} draggable onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(card.id)); e.dataTransfer.effectAllowed = "move"; }}
                  className="cursor-grab rounded-lg border border-border bg-surface p-2.5 shadow-sm active:cursor-grabbing">
                  {href ? <Link href={href} className="font-medium hover:text-accent hover:underline">{card.title}</Link> : <span className="font-medium">{card.title}</span>}
                  {card.meta.length > 0 && <p className="mt-1 text-xs text-muted">{card.meta.join(" · ")}</p>}
                  <select aria-label={card.title} value={col.key} onChange={(e) => move(card.id, e.target.value)} className="mt-1.5 w-full rounded border border-border bg-bg px-1 py-0.5 text-xs text-muted">
                    {cols.map((c) => <option key={c.key} value={c.key}>{name(c)}</option>)}
                  </select>
                </li>
              );
            })}
          </ul>
          {addAction && (
            <form action={addAction} className="mt-2">
              {Object.entries(addExtra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <input type="hidden" name="presetValue" value={col.key} />
              <input name="title" required placeholder={addLabel} autoComplete="off" className="w-full rounded-lg border border-dashed border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-accent focus:bg-surface" />
            </form>
          )}
        </section>
      ))}
    </div>
  );
}
