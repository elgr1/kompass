import { zonedToUtc } from "./time";

export type IcsEvent = {
  uid: string;
  summary: string;
  description: string | null;
  location: string | null;
  url: string | null;
  start: Date;
  end: Date | null;
  allDay: boolean;
};

const unescape = (s: string) =>
  s.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

/** Splits `NAME;PARAM=x:VALUE` at the first colon that is not inside a quoted parameter. */
function splitLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  let inQuote = false;
  let idx = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ":" && !inQuote) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return null;
  const [name, ...rawParams] = line.slice(0, idx).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(idx + 1) };
}

/**
 * ICS date-time -> UTC instant.
 * - `...Z` is UTC.
 * - A bare date (VALUE=DATE) is an all-day event starting at Stockholm midnight.
 * - Anything else (TZID or floating) is read as Stockholm wall time: both sources we
 *   consume (TimeEdit, Canvas) are Uppsala schedules.
 */
export function parseIcsDate(value: string): { date: Date; allDay: boolean } | null {
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0", m[6] ?? "0"].map(Number);
  if (m[4] === undefined) return { date: zonedToUtc(y, mo, d), allDay: true };
  if (m[7]) return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), allDay: false };
  return { date: zonedToUtc(y, mo, d, h, mi, s), allDay: false };
}

/** Minimal VEVENT parser. Recurrence rules (RRULE) are not expanded; neither source uses them. */
export function parseIcs(text: string): IcsEvent[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events: IcsEvent[] = [];
  let cur: Record<string, string> | null = null;
  let depth = 0; // ignore nested components such as VALARM

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      depth = 0;
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("BEGIN:")) {
      depth++;
      continue;
    }
    if (line.startsWith("END:") && line !== "END:VEVENT") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (line === "END:VEVENT") {
      const start = cur.DTSTART ? parseIcsDate(cur.DTSTART) : null;
      if (start && cur.UID) {
        const end = cur.DTEND ? parseIcsDate(cur.DTEND) : null;
        events.push({
          uid: cur.UID,
          summary: unescape(cur.SUMMARY ?? "").trim(),
          description: cur.DESCRIPTION ? unescape(cur.DESCRIPTION).trim() || null : null,
          location: cur.LOCATION ? unescape(cur.LOCATION).trim() || null : null,
          url: cur.URL?.trim() || null,
          start: start.date,
          end: end?.date ?? null,
          allDay: start.allDay,
        });
      }
      cur = null;
      continue;
    }
    if (depth > 0) continue;
    const parsed = splitLine(line);
    if (parsed && !(parsed.name in cur)) cur[parsed.name] = parsed.value;
  }
  return events;
}
