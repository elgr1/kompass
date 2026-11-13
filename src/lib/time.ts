/**
 * Time rules for the whole app:
 * - Instants are stored as UTC (Date / epoch ms).
 * - Everything the user sees or plans against is Europe/Stockholm wall time.
 * - A calendar day is identified by a "date key" (YYYY-MM-DD in Stockholm), never by
 *   adding 24h to an instant, because days are 23h or 25h long at DST changes.
 */
export const TZ = "Europe/Stockholm";
export type Lang = "sv" | "en";

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export function zonedParts(d: Date): ZonedParts {
  const out: Record<string, number> = {};
  for (const p of partsFmt.formatToParts(d)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out as unknown as ZonedParts;
}

/** Stockholm's UTC offset in ms at the given instant (+1h in winter, +2h in summer). */
export function tzOffsetMs(d: Date): number {
  const p = zonedParts(d);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** Stockholm wall time -> UTC instant. */
export function zonedToUtc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let t = guess - tzOffsetMs(new Date(guess));
  t = guess - tzOffsetMs(new Date(t));
  return new Date(t);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function dateKey(d: Date): string {
  const p = zonedParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function parseKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

export const isDateKey = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Start of the Stockholm day (00:00 local) as a UTC instant. */
export function startOfDay(key: string): Date {
  const { year, month, day } = parseKey(key);
  return zonedToUtc(year, month, day);
}

export function addDays(key: string, n: number): string {
  const { year, month, day } = parseKey(key);
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 1 = Monday ... 7 = Sunday */
export function weekday(key: string): number {
  const { year, month, day } = parseKey(key);
  const wd = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export const mondayOf = (key: string): string => addDays(key, 1 - weekday(key));

export function isoWeek(key: string): { year: number; week: number } {
  const { year, month, day } = parseKey(key);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // Thursday of this ISO week
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return { year: d.getUTCFullYear(), week: Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7) };
}

/** Minutes since local midnight for an instant. */
export function minutesOfDay(d: Date): number {
  const p = zonedParts(d);
  return p.hour * 60 + p.minute;
}

const locale = (lang: Lang) => (lang === "sv" ? "sv-SE" : "en-GB");
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(lang: Lang, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = lang + JSON.stringify(opts);
  let f = fmtCache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat(locale(lang), { timeZone: TZ, ...opts });
    fmtCache.set(k, f);
  }
  return f;
}

export function fmtTime(d: Date): string {
  const p = zonedParts(d);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "tors 12 nov" / "Thu 12 Nov" */
export const fmtDay = (d: Date, lang: Lang): string =>
  fmt(lang, { weekday: "short", day: "numeric", month: "short" }).format(d).replace(/\./g, "");

/** "torsdag 12 november" */
export const fmtDayLong = (d: Date, lang: Lang): string =>
  fmt(lang, { weekday: "long", day: "numeric", month: "long" }).format(d);

/** "12 nov" */
export const fmtDate = (d: Date, lang: Lang): string =>
  fmt(lang, { day: "numeric", month: "short" }).format(d).replace(/\./g, "");

export const fmtWeekdayShort = (d: Date, lang: Lang): string =>
  fmt(lang, { weekday: "short" }).format(d).replace(/\./g, "");

/** "12 nov 23:59" (adds the year when it differs from `now`). */
export function fmtDateTime(d: Date, lang: Lang, now: Date = new Date()): string {
  const sameYear = zonedParts(d).year === zonedParts(now).year;
  const date = sameYear ? fmtDate(d, lang) : fmt(lang, { day: "numeric", month: "short", year: "numeric" }).format(d).replace(/\./g, "");
  return `${date} ${fmtTime(d)}`;
}

/** "in 3 days", "2 h ago" ... coarse on purpose. */
export function fmtRelative(d: Date, lang: Lang, now: Date = new Date()): string {
  const diff = d.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: "auto" });
  if (abs < 60_000) return rtf.format(0, "minute");
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  const days = Math.round((startOfDay(dateKey(d)).getTime() - startOfDay(dateKey(now)).getTime()) / 86_400_000);
  return rtf.format(days || Math.sign(diff), "day");
}
