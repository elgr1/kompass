import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addPropAction, addRowAction, addViewAction, moveRowAction, deleteDatabaseAction, deletePropAction, deleteViewAction, renameDatabaseAction, saveViewAction, updatePropAction,
} from "../../actions";
import { Board as KanbanBoard } from "@/components/Board";
import { PropInput } from "@/components/PropInput";
import { Card, Empty } from "@/components/ui";
import { getDb } from "@/lib/db";
import type { PropDef, ViewDef } from "@/lib/db/schema";
import { t } from "@/lib/i18n";
import { applyView, groupRows, valueOf, type Row } from "@/lib/notes/dbview";
import { excerpt } from "@/lib/notes/markdown";
import { getDatabase, getRows } from "@/lib/notes/store";
import { getPrefs } from "@/lib/prefs";
import { getCourses } from "@/lib/queries";
import { addDays, dateKey, fmtDate, fmtWeekdayShort, isDateKey, isoWeek, mondayOf, startOfDay, type Lang } from "@/lib/time";

export const dynamic = "force-dynamic";

const VIEW_TYPES = ["table", "board", "calendar", "timeline", "gallery"] as const;
const PROP_TYPES = ["text", "number", "select", "date", "checkbox", "url", "course"] as const;
const OPS = ["is", "is_not", "contains", "empty", "not_empty", "before", "after"] as const;
const field = "rounded-lg border border-border bg-bg px-2 py-1.5 text-sm";
const btn = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2";

export default async function DatabasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string; m?: string; from?: string }> }) {
  const { lang } = await getPrefs();
  const id = Number((await params).id);
  const sp = await searchParams;
  const db = getDb();
  const database = Number.isInteger(id) ? getDatabase(db, id) : null;
  if (!database) notFound();

  const today = dateKey(new Date());
  const view = database.views.find((v) => v.id === sp.view) ?? database.views[0];
  const props = database.props;
  const cs = getCourses(db);
  const courses = [...cs.values()].filter((c) => !c.id.startsWith("timeedit:")).map((c) => ({ id: c.id, name: c.shortName }));
  const allRows: Row[] = getRows(db, id).map((r) => ({ id: r.id, title: r.title, props: r.props, updatedAt: r.updatedAt, content: r.content }));
  const rows = applyView(allRows, props, view, today);
  const prop = (pid?: string | null) => props.find((p) => p.id === pid);
  const href = (extra: Record<string, string>) => `/db/${id}?${new URLSearchParams({ view: view.id, ...extra })}`;

  /** A value as short text, for cards and chips. */
  const show = (r: Row, p: PropDef): string => {
    const v = valueOf(r, p.id);
    if (v === null || v === undefined || v === "" || v === false) return "";
    if (p.type === "checkbox") return `✓ ${p.name}`;
    if (p.type === "course") return cs.get(String(v))?.shortName ?? "";
    if (p.type === "date" && isDateKey(v)) return fmtDate(startOfDay(v), lang);
    if (p.type === "url") return "↗";
    return String(v);
  };
  const meta = (r: Row, skip: (string | null | undefined)[] = []) => props.filter((p) => !skip.includes(p.id)).map((p) => show(r, p)).filter(Boolean).slice(0, 4);

  const NewRow = () => (
    <form action={addRowAction.bind(null, id)} className="flex gap-2 border-t border-border p-3">
      <input name="title" required placeholder={t(lang, "db.newRow")} autoComplete="off" className={`${field} min-w-0 flex-1`} />
      <button className={btn}>{t(lang, "db.add")}</button>
    </form>
  );

  /* ---- Table ---- */
  const Table = () => (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-3 py-2 font-semibold">{t(lang, "db.titleProp")}</th>
              {props.map((p) => <th key={p.id} className={`px-2 py-2 font-semibold ${p.type === "number" ? "text-right" : ""}`}>{p.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-2/50">
                <td className="max-w-72 px-3 py-1.5"><Link href={`/notes/${r.id}`} className="block truncate font-medium hover:text-accent hover:underline">{r.title}</Link></td>
                {props.map((p) => <td key={p.id} className="min-w-28 px-1 py-0.5"><PropInput rowId={r.id} def={p} value={r.props[p.id]} courses={courses} emptyLabel="–" /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <Empty>{t(lang, "db.empty")}</Empty>}
      <NewRow />
    </Card>
  );

  /* ---- Board ---- */
  const Board = () => {
    const g = prop(view.groupBy);
    if (!g || g.type !== "select") return <Card><Empty>{t(lang, "db.needGroup")}</Empty></Card>;
    const columns = groupRows(rows, g).map((col) => ({ key: col.key, cards: col.rows.map((r) => ({ id: r.id, title: r.title, meta: meta(r, [g.id]) })) }));
    return <KanbanBoard columns={columns} noneLabel={t(lang, "db.noValue")} addLabel={t(lang, "db.newRow")} hrefPrefix="/notes/" moveAction={moveRowAction.bind(null, g.id)} addAction={addRowAction.bind(null, id)} addExtra={{ presetProp: g.id }} />;
  };

  /* ---- Calendar (one month) ---- */
  const Calendar = () => {
    const d = prop(view.dateProp);
    if (!d || d.type !== "date") return <Card><Empty>{t(lang, "db.needDate")}</Empty></Card>;
    const month = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : today.slice(0, 7);
    const first = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    const shift = (n: number) => { const x = new Date(Date.UTC(y, m - 1 + n, 1)); return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`; };
    const start = mondayOf(first);
    const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(start, w * 7 + i))).filter((w) => w.some((k) => k.startsWith(month)));
    const undated = rows.filter((r) => !isDateKey(r.props[d.id]));
    const title = new Intl.DateTimeFormat(lang === "sv" ? "sv-SE" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
    return (
      <Card title={title.charAt(0).toUpperCase() + title.slice(1)}
        action={<div className="flex gap-1.5"><Link href={href({ m: shift(-1) })} className={btn}>←</Link><Link href={href({})} className={btn}>{t(lang, "tasks.today")}</Link><Link href={href({ m: shift(1) })} className={btn}>→</Link></div>}>
        <div className="overflow-x-auto">
          <div className="min-w-[680px]">
            <div className="grid grid-cols-7 border-b border-border text-xs font-semibold uppercase text-muted">
              {weeks[0].map((k) => <div key={k} className="px-2 py-1.5">{fmtWeekdayShort(startOfDay(k), lang)}</div>)}
            </div>
            {weeks.map((w) => (
              <div key={w[0]} className="grid grid-cols-7 border-b border-border last:border-0">
                {w.map((k) => (
                  <div key={k} className={`min-h-24 border-l border-border p-1 first:border-l-0 ${k.startsWith(month) ? "" : "bg-surface-2/60"} ${k === today ? "bg-accent-soft/60" : ""}`}>
                    <div className={`tnum mb-1 px-1 text-xs ${k === today ? "font-bold text-accent" : "text-muted"}`}>{Number(k.slice(8))}</div>
                    {rows.filter((r) => r.props[d.id] === k).map((r) => (
                      <Link key={r.id} href={`/notes/${r.id}`} className="mb-1 block truncate rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent hover:underline" title={r.title}>{r.title}</Link>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        {undated.length > 0 && (
          <p className="border-t border-border px-4 py-2 text-xs text-muted">{t(lang, "db.undated")}: {undated.map((r, i) => <span key={r.id}>{i > 0 && ", "}<Link href={`/notes/${r.id}`} className="text-accent hover:underline">{r.title}</Link></span>)}</p>
        )}
        <NewRow />
      </Card>
    );
  };

  /* ---- Timeline (eight weeks, one column per day) ---- */
  const Timeline = () => {
    const s = prop(view.dateProp);
    const e = prop(view.endProp);
    if (!s || s.type !== "date") return <Card><Empty>{t(lang, "db.needDate")}</Empty></Card>;
    const DAYS = 56;
    const from = mondayOf(isDateKey(sp.from) ? sp.from : addDays(today, -7));
    const to = addDays(from, DAYS - 1);
    const dayIndex = (k: string) => Math.round((Date.parse(k) - Date.parse(from)) / 86_400_000);
    const bars = rows.flatMap((r) => {
      const a = r.props[s.id];
      const b = e ? r.props[e.id] : null;
      // a row with only one of the two dates is drawn as a one-day marker
      const start = isDateKey(a) ? a : isDateKey(b) ? b : null;
      if (!start) return [];
      const end = isDateKey(b) && b >= start ? b : start;
      if (end < from || start > to) return [];
      const c0 = Math.max(0, dayIndex(start));
      const c1 = Math.min(DAYS - 1, dayIndex(end));
      return [{ r, c0, span: c1 - c0 + 1, cutLeft: start < from, cutRight: end > to }];
    });
    const off = rows.length - bars.length;
    const weeks = Array.from({ length: DAYS / 7 }, (_, i) => addDays(from, i * 7));
    const todayCol = today >= from && today <= to ? dayIndex(today) : null;
    return (
      <Card title={`${fmtDate(startOfDay(from), lang)} – ${fmtDate(startOfDay(to), lang)}`}
        action={<div className="flex gap-1.5"><Link href={href({ from: addDays(from, -28) })} className={btn}>←</Link><Link href={href({})} className={btn}>{t(lang, "tasks.today")}</Link><Link href={href({ from: addDays(from, 28) })} className={btn}>→</Link></div>}>
        <div className="overflow-x-auto">
          <div className="relative min-w-[760px]">
            <div className="grid border-b border-border text-xs text-muted" style={{ gridTemplateColumns: `repeat(${weeks.length}, 1fr)` }}>
              {weeks.map((w) => <div key={w} className="border-l border-border px-2 py-1.5 first:border-l-0"><span className="font-semibold">{t(lang, "today.week", { n: isoWeek(w).week })}</span> {fmtDate(startOfDay(w), lang)}</div>)}
            </div>
            <div className="relative py-2">
              <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${weeks.length}, 1fr)` }}>{weeks.map((w) => <div key={w} className="border-l border-border/60 first:border-l-0" />)}</div>
              {todayCol !== null && <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-danger" style={{ left: `${((todayCol + 0.5) / DAYS) * 100}%` }} />}
              {bars.length === 0 && <Empty>{t(lang, "db.empty")}</Empty>}
              {bars.map(({ r, c0, span, cutLeft, cutRight }) => (
                <div key={r.id} className="relative grid h-8 items-center" style={{ gridTemplateColumns: `repeat(${DAYS}, 1fr)` }}>
                  <Link href={`/notes/${r.id}`} title={r.title} style={{ gridColumn: `${c0 + 1} / span ${span}` }}
                    className={`relative z-10 mx-px truncate bg-accent px-2 py-1 text-xs font-medium text-surface hover:opacity-90 ${cutLeft ? "" : "rounded-l-md"} ${cutRight ? "" : "rounded-r-md"} ${span < 4 ? "overflow-visible whitespace-nowrap" : ""}`}>
                    {span < 4 ? <span className="absolute left-full top-1/2 ml-1.5 -translate-y-1/2 text-text">{r.title}</span> : r.title}
                    {span < 4 && " "}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>
        {off > 0 && <p className="border-t border-border px-4 py-2 text-xs text-muted">{t(lang, "db.undated")}: {off}</p>}
        <NewRow />
      </Card>
    );
  };

  /* ---- Gallery ---- */
  const Gallery = () => (
    <>
      {rows.length === 0 && <Card><Empty>{t(lang, "db.empty")}</Empty></Card>}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/notes/${r.id}`} className="flex h-full flex-col rounded-xl border border-border bg-surface p-4 hover:border-accent">
              <span className="font-semibold">{r.title}</span>
              <span className="mt-1 line-clamp-3 flex-1 text-sm text-muted">{excerpt(r.content ?? "", 140)}</span>
              <span className="mt-3 flex flex-wrap gap-1.5">{meta(r).map((m, i) => <span key={i} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{m}</span>)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Card><NewRow /></Card>
    </>
  );

  const PropSelect = ({ name, value, types, extra = [] }: { name: string; value?: string | null; types?: PropDef["type"][]; extra?: { id: string; name: string }[] }) => (
    <select name={name} defaultValue={value ?? ""} className={`${field} w-full`}>
      <option value="">{t(lang, "db.none")}</option>
      {extra.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      {props.filter((p) => !types || types.includes(p.type)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
  const titleProp = { id: "title", name: t(lang, "db.titleProp") };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <nav className="text-xs text-muted"><Link href="/notes" className="hover:text-accent">{t(lang, "notes.title")}</Link> / {t(lang, "notes.databases")}</nav>
      <form action={renameDatabaseAction.bind(null, id)}>
        <input name="title" defaultValue={database.title} aria-label={t(lang, "db.name")} className="w-full border-0 bg-transparent text-2xl font-semibold tracking-tight outline-none" />
      </form>

      <div className="flex flex-wrap items-center gap-1.5">
        {database.views.map((v: ViewDef) => (
          <Link key={v.id} href={`/db/${id}?view=${v.id}`} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${v.id === view.id ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-text"}`}>{v.name}</Link>
        ))}
        <form action={addViewAction.bind(null, id)} className="flex gap-1">
          <select name="type" aria-label={t(lang, "db.type")} className={`${field} py-1 text-xs`}>{VIEW_TYPES.map((k) => <option key={k} value={k}>{t(lang, `db.view.${k}`)}</option>)}</select>
          <button className="rounded-lg border border-dashed border-border px-2 py-1 text-xs font-medium text-muted hover:text-text">{t(lang, "db.addView")}</button>
        </form>
      </div>

      <details className="rounded-xl border border-border bg-surface">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-muted">{t(lang, "db.viewSettings")}{view.filters?.length ? ` · ${t(lang, "db.filter")}: ${view.filters.length}` : ""}</summary>
        <form action={saveViewAction.bind(null, id, view.id)} className="grid gap-3 border-t border-border p-4 sm:grid-cols-3 [&>*]:min-w-0">
          <label className="text-xs text-muted">{t(lang, "db.name")}<input name="name" defaultValue={view.name} className={`${field} w-full`} /></label>
          <label className="text-xs text-muted">{t(lang, "db.type")}<select name="type" defaultValue={view.type} className={`${field} w-full`}>{VIEW_TYPES.map((k) => <option key={k} value={k}>{t(lang, `db.view.${k}`)}</option>)}</select></label>
          <label className="text-xs text-muted">{t(lang, "db.groupBy")}<PropSelect name="groupBy" value={view.groupBy} types={["select"]} /></label>
          <label className="text-xs text-muted">{t(lang, "db.dateProp")}<PropSelect name="dateProp" value={view.dateProp} types={["date"]} /></label>
          <label className="text-xs text-muted">{t(lang, "db.endProp")}<PropSelect name="endProp" value={view.endProp} types={["date"]} /></label>
          <div className="flex gap-2">
            <label className="min-w-0 flex-1 text-xs text-muted">{t(lang, "db.sortBy")}<PropSelect name="sortBy" value={view.sortBy} extra={[titleProp, { id: "updated", name: t(lang, "db.updatedProp") }]} /></label>
            <label className="text-xs text-muted">&nbsp;<select name="sortDir" defaultValue={view.sortDir ?? "asc"} className={`${field} w-full`}><option value="asc">{t(lang, "db.asc")}</option><option value="desc">{t(lang, "db.desc")}</option></select></label>
          </div>
          {[0, 1, 2].map((i) => {
            const f = view.filters?.[i];
            return (
              <div key={i} className="flex flex-wrap gap-1.5 sm:col-span-3">
                <span className="w-12 shrink-0 self-center text-xs text-muted">{t(lang, "db.filter")} {i + 1}</span>
                <div className="min-w-0 flex-1 basis-32"><PropSelect name={`f${i}prop`} value={f?.prop} extra={[titleProp]} /></div>
                <select name={`f${i}op`} defaultValue={f?.op ?? "is"} className={field}>{OPS.map((o) => <option key={o} value={o}>{t(lang, `db.op.${o}`)}</option>)}</select>
                <input name={`f${i}value`} defaultValue={f?.value ?? ""} placeholder={t(lang, "db.valuePh")} className={`${field} min-w-0 flex-1 basis-32`} />
              </div>
            );
          })}
          <div className="flex gap-2 sm:col-span-3">
            <button className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-surface">{t(lang, "tasks.save")}</button>
            {database.views.length > 1 && <button formAction={deleteViewAction.bind(null, id, view.id)} className={`${btn} text-danger`}>{t(lang, "db.deleteView")}</button>}
          </div>
        </form>
      </details>

      {view.type === "table" && <Table />}
      {view.type === "board" && <Board />}
      {view.type === "calendar" && <Calendar />}
      {view.type === "timeline" && <Timeline />}
      {view.type === "gallery" && <Gallery />}

      <details className="rounded-xl border border-border bg-surface">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-muted">{t(lang, "db.properties")} ({props.length})</summary>
        <ul className="divide-y divide-border border-t border-border">
          {props.map((p) => (
            <li key={p.id} className="px-4 py-2.5">
              <form action={updatePropAction.bind(null, id, p.id)} className="flex flex-wrap items-center gap-2">
                <input name="name" defaultValue={p.name} aria-label={t(lang, "db.name")} className={`${field} w-40`} />
                <span className="w-20 text-xs text-muted">{t(lang, `db.pt.${p.type}`)}</span>
                {p.type === "select" && <input name="options" defaultValue={(p.options ?? []).join(", ")} placeholder={t(lang, "db.options")} aria-label={t(lang, "db.options")} className={`${field} min-w-0 flex-1 basis-48`} />}
                <button className={btn}>{t(lang, "tasks.save")}</button>
                <button formAction={deletePropAction.bind(null, id, p.id)} className={`${btn} text-danger`}>{t(lang, "db.deleteProp")}</button>
              </form>
            </li>
          ))}
          <li className="px-4 py-3">
            <form action={addPropAction.bind(null, id)} className="flex flex-wrap items-center gap-2">
              <input name="name" required placeholder={t(lang, "db.addProp")} className={`${field} w-40`} />
              <select name="type" aria-label={t(lang, "db.type")} className={field}>{PROP_TYPES.map((k) => <option key={k} value={k}>{t(lang, `db.pt.${k}`)}</option>)}</select>
              <input name="options" placeholder={t(lang, "db.options")} className={`${field} min-w-0 flex-1 basis-48`} />
              <button className={btn}>{t(lang, "db.add")}</button>
            </form>
          </li>
        </ul>
        <form action={deleteDatabaseAction.bind(null, id)} className="border-t border-border px-4 py-3">
          <button className="text-xs text-muted hover:text-danger hover:underline">{t(lang, "db.deleteDb")}</button>
        </form>
      </details>
    </div>
  );
}
