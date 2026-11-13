import type { PropDef, ViewDef } from "../db/schema";

/** Filtering, sorting and grouping of database rows. Pure. */

export type Row = { id: number; title: string; props: Record<string, unknown>; updatedAt: Date; content?: string };

export const newId = () => Math.random().toString(36).slice(2, 10);

export function valueOf(row: Row, propId: string): unknown {
  if (propId === "title") return row.title;
  if (propId === "updated") return row.updatedAt.toISOString();
  return row.props[propId];
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || v === false;
const text = (v: unknown) => (isEmpty(v) ? "" : String(v));

export function matches(row: Row, f: NonNullable<ViewDef["filters"]>[number], today: string): boolean {
  const v = valueOf(row, f.prop);
  const want = f.value === "today" ? today : f.value ?? "";
  switch (f.op) {
    case "empty": return isEmpty(v);
    case "not_empty": return !isEmpty(v);
    case "is": return typeof v === "boolean" ? String(v) === want.toLowerCase() : text(v).toLowerCase() === want.toLowerCase();
    case "is_not": return typeof v === "boolean" ? String(v) !== want.toLowerCase() : text(v).toLowerCase() !== want.toLowerCase();
    case "contains": return text(v).toLowerCase().includes(want.toLowerCase());
    // dates are stored as YYYY-MM-DD, so string comparison is date comparison
    case "before": return !isEmpty(v) && text(v) < want;
    case "after": return !isEmpty(v) && text(v) > want;
  }
}

function compare(a: unknown, b: unknown, type: PropDef["type"] | "text"): number {
  // empty values always sort last, whatever the direction
  if (isEmpty(a) || isEmpty(b)) return 0;
  if (type === "number") return Number(a) - Number(b);
  if (type === "checkbox") return Number(Boolean(a)) - Number(Boolean(b));
  return text(a).localeCompare(text(b), "sv", { numeric: true });
}

export function applyView(rows: Row[], props: PropDef[], view: Pick<ViewDef, "filters" | "sortBy" | "sortDir">, today: string): Row[] {
  const filters = (view.filters ?? []).filter((f) => f.prop && (f.prop === "title" || props.some((p) => p.id === f.prop)));
  const out = rows.filter((r) => filters.every((f) => matches(r, f, today)));
  const by = view.sortBy;
  if (!by) return out;
  const def = props.find((p) => p.id === by);
  const type = def?.type ?? "text";
  const dir = view.sortDir === "desc" ? -1 : 1;
  // For select properties, sort in the order the options were defined (a pipeline, not the alphabet).
  const rank = def?.type === "select" && def.options ? new Map(def.options.map((o, i) => [o, i])) : null;
  return [...out].sort((x, y) => {
    const a = valueOf(x, by);
    const b = valueOf(y, by);
    if (isEmpty(a) !== isEmpty(b)) return isEmpty(a) ? 1 : -1;
    const c = rank ? (rank.get(text(a)) ?? 999) - (rank.get(text(b)) ?? 999) : compare(a, b, type);
    return c !== 0 ? c * dir : x.id - y.id;
  });
}

/** Groups in option order, then unknown values, then "" for rows without a value. Empty option groups are kept (board columns). */
export function groupRows(rows: Row[], prop: PropDef | undefined): { key: string; rows: Row[] }[] {
  if (!prop) return [{ key: "", rows }];
  const groups = new Map<string, Row[]>((prop.options ?? []).map((o) => [o, []]));
  const none: Row[] = [];
  for (const r of rows) {
    const v = text(valueOf(r, prop.id));
    if (!v) none.push(r);
    else groups.set(v, [...(groups.get(v) ?? []), r]);
  }
  const out = [...groups].map(([key, rs]) => ({ key, rows: rs }));
  if (none.length || out.length === 0) out.push({ key: "", rows: none });
  return out;
}

/** Normalizes a submitted value for storage. */
export function coerce(def: PropDef, raw: string): unknown {
  const v = raw.trim();
  if (def.type === "checkbox") return v === "true" || v === "on" || v === "1";
  if (v === "") return null;
  if (def.type === "number") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  if (def.type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  if (def.type === "url") return /^https?:\/\//i.test(v) ? v : `https://${v}`;
  return v.slice(0, 2000);
}
