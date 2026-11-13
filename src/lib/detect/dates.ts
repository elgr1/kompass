import { addDays, dateKey, isoWeek, mondayOf, weekday } from "../time";

/**
 * Rule-based date finder for Swedish and English text. Pure and dependency-free, so it
 * also runs in the browser for the quick-capture preview.
 *
 * Understands: 2026-11-14 · 14/11 · 14/11-26 · 14 november · den 14:e nov · Nov 14th ·
 * fre 14/11 · på fredag / by Friday · v. 47 / vecka 47 / week 47 · imorgon / tomorrow / idag,
 * each with an optional time: kl. 23.59 · kl 17 · 17:00 · at 5 pm.
 */

export type DateMention = {
  /** position of the whole mention (including an attached time) in the text */
  index: number;
  length: number;
  text: string;
  /** YYYY-MM-DD, Stockholm */
  date: string;
  /** HH:MM or null when the text gives no time */
  time: string | null;
  /** "week" = only a week number was given; `date` is that week's Monday */
  precision: "day" | "week";
  /** true for "på fredag", "tomorrow"...: only meaningful if we know when the text was written */
  relative: boolean;
};

export type DateOptions = {
  /** Accept short weekday names on their own ("fre", "mon") and "fre 17" as Friday 17:00. For typed input only. */
  shorthand?: boolean;
};

const MONTH =
  "(jan(?:uari|uary)?|feb(?:ruari|ruary)?|mars|mar(?:ch)?|apr(?:il)?|maj|may|jun[ie]?|jul[iy]?|aug(?:usti|ust)?|sep(?:t(?:ember)?)?|okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?(?![\\p{L}])";
const WD_FULL = "måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const WD_SHORT = "mån|tis|ons|tors|tor|fre|lör|sön|mon|tues|tue|wed|thurs|thur|thu|fri|sat|sun";
const WD_ANY = `(?:${WD_FULL})(?:en|s)?|(?:${WD_SHORT})\\.?`;
const B = "(?<![\\p{L}\\d])"; // start boundary that understands å/ä/ö

const MONTH_NUM: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dec: 12 };
const monthNum = (s: string) => MONTH_NUM[s.toLowerCase().slice(0, 3)] ?? 0;
const WD_NUM: Record<string, number> = { må: 1, mo: 1, ti: 2, tu: 2, on: 3, we: 3, to: 4, th: 4, fr: 5, lö: 6, sa: 6, sö: 7, su: 7 };
const wdNum = (s: string) => WD_NUM[s.toLowerCase().slice(0, 2)] ?? 0;

const pad = (n: number) => String(n).padStart(2, "0");
const toKey = (y: number, m: number, d: number): string | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};
const dayNumber = (key: string) => Date.parse(`${key}T00:00:00Z`) / 86_400_000;

/**
 * A date without a year means the occurrence closest to when the text was written:
 * anywhere from 3 months back to 9 months ahead.
 */
function inferYear(month: number, day: number, refKey: string): string | null {
  const refYear = Number(refKey.slice(0, 4));
  const candidates = [refYear - 1, refYear, refYear + 1].map((y) => toKey(y, month, day)).filter((k): k is string => k !== null);
  const diff = (k: string) => dayNumber(k) - dayNumber(refKey);
  return candidates.find((k) => diff(k) >= -90 && diff(k) <= 275) ?? candidates.sort((a, b) => Math.abs(diff(a)) - Math.abs(diff(b)))[0] ?? null;
}

/** Monday of ISO week `week` in the year that puts it closest to the reference date. */
function weekToKey(week: number, refKey: string): string | null {
  if (week < 1 || week > 53) return null;
  const refYear = Number(refKey.slice(0, 4));
  const candidates = [refYear - 1, refYear, refYear + 1]
    .map((y) => {
      const monday = addDays(mondayOf(`${y}-01-04`), (week - 1) * 7); // 4 Jan is always in ISO week 1
      return isoWeek(monday).week === week ? monday : null;
    })
    .filter((k): k is string => k !== null);
  const diff = (k: string) => dayNumber(k) - dayNumber(refKey);
  return candidates.find((k) => diff(k) >= -90 && diff(k) <= 275) ?? null;
}

/** The given weekday on or after the reference day. */
const nextWeekday = (wd: number, refKey: string) => addDays(refKey, (wd - weekday(refKey) + 7) % 7);

function clock(h: string, m: string | undefined, ampm: string | undefined): string | null {
  let hour = Number(h);
  const min = m ? Number(m) : 0;
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (ampm.toLowerCase() === "pm" ? 12 : 0);
  }
  return hour <= 23 && min <= 59 ? `${pad(hour)}:${pad(min)}` : null;
}

const TIME_AFTER = /^(?:\s*,)?\s*(?:(?:kl(?:ockan)?\.?|at|@)\s*)?(\d{1,2})[:.](\d{2})(?!\d)(?:\s?(am|pm)\b)?/i;
const HOUR_AFTER = /^(?:\s*,)?\s*(?:kl(?:ockan)?\.?|at|@)\s*(\d{1,2})(?![\d:.])(?:\s?(am|pm)\b)?/i;
const AMPM_AFTER = /^(?:\s*,)?\s*(\d{1,2})\s?(am|pm)\b/i;
const TIME_BEFORE = /(?:(?:kl(?:ockan)?\.?|at)\s*)?(\d{1,2})[:.](\d{2})\s*,?\s*(?:on\s+|den\s+|på\s+)?$/i;

export function extractDates(text: string, ref: Date, opts: DateOptions = {}): DateMention[] {
  const refKey = dateKey(ref);
  const found: { index: number; end: number; date: string; precision: "day" | "week"; time?: string | null; relative?: boolean }[] = [];
  const free = (i: number, end: number) => found.every((f) => end <= f.index || i >= f.end);
  const scan = (source: string, handler: (m: RegExpExecArray) => { date: string | null; precision?: "week"; time?: string | null; relative?: boolean } | null) => {
    for (const m of text.matchAll(new RegExp(source, "giu"))) {
      const r = handler(m as RegExpExecArray);
      if (r?.date && free(m.index, m.index + m[0].length)) {
        found.push({ index: m.index, end: m.index + m[0].length, date: r.date, precision: r.precision ?? "day", time: r.time, relative: r.relative });
      }
    }
  };

  // 2026-11-14
  scan("(?<!\\d)(\\d{4})-(\\d{2})-(\\d{2})(?!\\d)", (m) => ({ date: toKey(+m[1], +m[2], +m[3]) }));
  // [fre] [den] 14[:e] november [2026]
  scan(`${B}(?:(?:${WD_ANY}),?\\s+)?(?:den\\s+|the\\s+)?(\\d{1,2})(?::[ea]|st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH}(?:,?\\s+(\\d{4})(?!\\d))?`, (m) => ({
    date: m[3] ? toKey(+m[3], monthNum(m[2]), +m[1]) : inferYear(monthNum(m[2]), +m[1], refKey),
  }));
  // [Fri] November 14[th][, 2026]
  scan(`${B}(?:(?:${WD_ANY}),?\\s+)?${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d:]|\\.\\d)(?:,?\\s+(\\d{4})(?!\\d))?`, (m) => ({
    date: m[3] ? toKey(+m[3], monthNum(m[1]), +m[2]) : inferYear(monthNum(m[1]), +m[2], refKey),
  }));
  // [fre] 14/11[-26 | 2026]
  scan(`(?<![\\p{L}\\d/])(?:(?:${WD_ANY}),?\\s+)?(\\d{1,2})/(\\d{1,2})(?:[-/](\\d{4}|\\d{2})(?!\\d)|\\s+(20\\d{2})(?!\\d))?(?![\\d/\\p{L}])`, (m) => {
    const y = m[3] ?? m[4];
    return { date: y ? toKey(y.length === 2 ? 2000 + +y : +y, +m[2], +m[1]) : inferYear(+m[2], +m[1], refKey) };
  });
  // v. 47 / vecka 47 / week 47
  scan(`${B}(?:vecka|week|v\\.?|w\\.?)\\s?(\\d{1,2})(?![\\d:.,]\\d|\\d)`, (m) => ({ date: weekToKey(+m[1], refKey), precision: "week" }));
  // imorgon / tomorrow / idag / today / ikväll
  scan(`${B}(i\\s?morgon|imorn|tomorrow|i\\s?dag|today|i\\s?kväll|tonight)(?![\\p{L}])`, (m) => ({
    date: /morgon|imorn|tomorrow/i.test(m[1]) ? addDays(refKey, 1) : refKey,
    relative: true,
  }));
  // typed shorthand: "fre 17" = Friday the 17th if that fits, otherwise Friday 17:00
  if (opts.shorthand) {
    scan(`${B}(${WD_FULL}|${WD_SHORT})\\.?\\s+(\\d{1,2})(?![\\d:./]|\\s*(?:am|pm)\\b)`, (m) => {
      const day = nextWeekday(wdNum(m[1]), refKey);
      const n = +m[2];
      if (Number(day.slice(8)) === n) return { date: day, relative: true };
      return n <= 23 ? { date: day, time: `${pad(n)}:00`, relative: true } : null;
    });
  }
  // på fredag / by Friday (full names; short names only as typed shorthand)
  scan(`${B}(${opts.shorthand ? `${WD_FULL}|${WD_SHORT}` : WD_FULL})(?:en|s)?(?![\\p{L}])`, (m) => ({ date: nextWeekday(wdNum(m[1]), refKey), relative: true }));

  return found
    .sort((a, b) => a.index - b.index)
    .map((f) => {
      let { index, end } = f;
      let time = f.time ?? null;
      if (!time && f.precision === "day") {
        const after = text.slice(end, end + 28);
        const before = text.slice(Math.max(0, index - 24), index);
        const a = after.match(TIME_AFTER) ?? after.match(HOUR_AFTER) ?? after.match(AMPM_AFTER);
        if (a) {
          // TIME_AFTER has three groups (h, m, am/pm); the hour-only patterns have two (h, am/pm).
          time = a.length === 4 ? clock(a[1], a[2], a[3]) : clock(a[1], undefined, a[2]);
          if (time) end += a[0].length;
        } else if (opts.shorthand && /^\s+\d{1,2}\s*(?:$|#)/.test(text.slice(end))) {
          // typed shorthand: a bare number closing the line is the hour ("imorgon 9", "måndag 14 #plugg")
          const h = text.slice(end).match(/^\s+(\d{1,2})/)!;
          time = clock(h[1], undefined, undefined);
          if (time) end += h[0].length;
        } else {
          const b = before.match(TIME_BEFORE);
          if (b) {
            time = clock(b[1], b[2], undefined);
            if (time) index -= b[0].length;
          }
        }
      }
      return { index, length: end - index, text: text.slice(index, end), date: f.date, time, precision: f.precision, relative: Boolean(f.relative) };
    });
}
