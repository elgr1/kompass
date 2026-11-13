"use client";

import { useTransition } from "react";
import { setRowPropAction } from "@/app/actions";
import type { PropDef } from "@/lib/db/schema";

const base = "w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-border focus:border-accent focus:bg-bg focus:outline-none";

/** One editable database cell. Saves on blur (text, number, date, url) or on change (select, checkbox, course). */
export function PropInput({ rowId, def, value, courses, emptyLabel }: { rowId: number; def: PropDef; value: unknown; courses: { id: string; name: string }[]; emptyLabel: string }) {
  const [pending, start] = useTransition();
  const current = value === null || value === undefined ? "" : String(value);
  const save = (next: string) => {
    if (next !== current) start(() => setRowPropAction(rowId, def.id, next));
  };
  const cls = `${base} ${pending ? "opacity-50" : ""}`;

  if (def.type === "checkbox") {
    return <input type="checkbox" aria-label={def.name} defaultChecked={value === true} onChange={(e) => save(String(e.target.checked))} className="mx-1.5 h-4 w-4 accent-[var(--accent)]" />;
  }
  if (def.type === "select" || def.type === "course") {
    const opts = def.type === "course" ? courses.map((c) => ({ value: c.id, label: c.name })) : (def.options ?? []).map((o) => ({ value: o, label: o }));
    // keep a value that is no longer among the options visible instead of silently dropping it
    const known = opts.some((o) => o.value === current);
    return (
      <select aria-label={def.name} defaultValue={current} onChange={(e) => save(e.target.value)} className={cls}>
        <option value="">{emptyLabel}</option>
        {!known && current && <option value={current}>{current}</option>}
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  const type = def.type === "number" ? "text" : def.type === "date" ? "date" : "text";
  return (
    <span className="flex items-center">
      <input type={type} inputMode={def.type === "number" ? "decimal" : undefined} aria-label={def.name} defaultValue={current} key={current}
        onBlur={(e) => save(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        className={`${cls} ${def.type === "number" ? "text-right tnum" : ""}`} />
      {def.type === "url" && current && <a href={current} target="_blank" rel="noreferrer noopener" className="px-1 text-accent" aria-label={def.name}>↗</a>}
    </span>
  );
}
