import type { FieldDiff } from "../db/schema";
import { hasKey, t } from "../i18n";
import { truncate } from "../text";
import { fmtDateTime, fmtDay, fmtTime, type Lang } from "../time";

/** Turns a stored change into the sentence and diff lines shown in the Radar. Pure, no I/O. */

export type ChangeLike = {
  type: "added" | "updated" | "removed";
  kind: string;
  title: string;
  diffs: FieldDiff[];
  /** latest known state of the item, when available */
  startAt?: Date | null;
  bodyText?: string | null;
  fields?: Record<string, unknown> | null;
};

export type Described = {
  headline: string;
  lines: { label: string; before?: string; after?: string; text?: string }[];
  excerpt: string | null;
};

const isDateField = (f: string) => f.endsWith("_at");
const asDate = (v: unknown): Date | null => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} kB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export function formatValue(field: string, v: unknown, lang: Lang, now: Date): string {
  if (v === null || v === undefined || v === "") return t(lang, "change.none");
  if (isDateField(field)) {
    const d = asDate(v);
    if (d) return fmtDateTime(d, lang, now);
  }
  if (typeof v === "boolean") return t(lang, v ? "change.yes" : "change.no");
  if (field === "size" && typeof v === "number") return bytes(v);
  if (Array.isArray(v)) return v.join(", ");
  return truncate(String(v), 120);
}

const label = (field: string, lang: Lang) => {
  const k = `field.${field}`;
  return hasKey(k) ? t(lang, k) : field.replace(/_/g, " ");
};

export function describeChange(c: ChangeLike, lang: Lang, now: Date = new Date()): Described {
  const diff = (f: string) => c.diffs.find((d) => d.field === f);
  const kindKey = `kind.${c.kind}`;
  const kind = hasKey(kindKey) ? t(lang, kindKey) : c.kind;
  const title = c.title;
  const when = c.startAt ? `${fmtDay(c.startAt, lang)} ${fmtTime(c.startAt)}` : "";
  const val = (f: string, v: unknown) => formatValue(f, v, lang, now);

  let headline: string;
  const due = diff("due_at");
  const start = diff("start_at");
  const room = diff("location");
  const moduleItems = diff("items");
  const isEvent = c.kind === "schedule_event" || c.kind === "calendar_event";

  if (c.type === "added") {
    if (c.kind === "file") headline = t(lang, "change.fileAdded", { title });
    else if (c.kind === "submission_comment") headline = t(lang, "change.comment", { title });
    else if (c.kind === "announcement") headline = t(lang, "change.announcement", { title });
    else if (c.kind === "appointment_group") headline = t(lang, "change.booking", { title });
    else if (isEvent && when) headline = t(lang, "change.eventAdded", { title, when });
    else headline = t(lang, "change.added", { kind: kind.toLowerCase(), title });
  } else if (c.type === "removed") {
    headline = isEvent && when ? t(lang, "change.eventRemoved", { title, when }) : t(lang, "change.removed", { kind, title });
  } else if (due) {
    if (due.before && due.after) headline = t(lang, "change.deadlineMoved", { title, before: val("due_at", due.before), after: val("due_at", due.after) });
    else if (due.after) headline = t(lang, "change.deadlineSet", { title, after: val("due_at", due.after) });
    else headline = t(lang, "change.deadlineRemoved", { title, before: val("due_at", due.before) });
  } else if (isEvent && start) {
    headline = t(lang, "change.eventMoved", { title, before: val("start_at", start.before), after: val("start_at", start.after) });
  } else if (isEvent && room) {
    headline = t(lang, "change.eventRoom", { title, when, before: val("location", room.before), after: val("location", room.after) });
  } else if ((diff("grade") || diff("score")) && (diff("grade")?.after ?? diff("score")?.after) != null) {
    headline = t(lang, "change.graded", { title, grade: String(diff("grade")?.after ?? diff("score")?.after) });
  } else if (diff("submission_state")?.after === "submitted") {
    headline = t(lang, "change.submitted", { title });
  } else if (c.kind === "file") {
    headline = t(lang, "change.fileReplaced", { title });
  } else if (c.kind === "announcement" && (diff("body") || diff("title"))) {
    headline = t(lang, "change.announcementEdited", { title });
  } else if (c.kind === "module" && moduleItems && Array.isArray(moduleItems.after)) {
    const before = new Set(Array.isArray(moduleItems.before) ? (moduleItems.before as string[]) : []);
    const added = (moduleItems.after as string[]).filter((x) => !before.has(x));
    headline = added.length
      ? t(lang, "change.moduleItems", { title, items: truncate(added.join(", "), 140) })
      : t(lang, "change.updated", { kind, title });
  } else {
    headline = t(lang, "change.updated", { kind, title });
  }

  const lines: Described["lines"] = c.diffs.map((d) => {
    if (d.field === "body") return { label: label("body", lang), text: t(lang, "change.contentEdited") };
    if (d.field === "items" && Array.isArray(d.after)) {
      const b = new Set(Array.isArray(d.before) ? (d.before as string[]) : []);
      const a = new Set(d.after as string[]);
      const plus = [...a].filter((x) => !b.has(x)).map((x) => `+ ${x}`);
      const minus = [...b].filter((x) => !a.has(x)).map((x) => `− ${x}`);
      return { label: label("items", lang), text: truncate([...plus, ...minus].join("  ·  "), 300) };
    }
    return { label: label(d.field, lang), before: val(d.field, d.before), after: val(d.field, d.after) };
  });

  // For new things, show what they say; for edits, the diff lines carry the news.
  let excerpt: string | null = null;
  if (c.type === "added" && c.bodyText) excerpt = truncate(c.bodyText.replace(/\s+/g, " "), 320);
  const author = c.fields && typeof c.fields.author === "string" ? c.fields.author : null;
  if (excerpt && author) excerpt = `${author}: ${excerpt}`;

  return { headline, lines, excerpt };
}
