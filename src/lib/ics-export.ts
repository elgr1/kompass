import { addDays, dateKey } from "./time";

/** Builds the private calendar feed. Pure. */
export type FeedEntry = {
  uid: string;
  title: string;
  start: Date;
  end?: Date | null;
  /** all-day on the Stockholm date of `start` */
  allDay?: boolean;
  description?: string | null;
  location?: string | null;
  url?: string | null;
};

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const day = (key: string) => key.replace(/-/g, "");

/** RFC 5545: lines are at most 75 octets; continuation lines start with a space. */
export function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildCalendar(entries: FeedEntry[], now: Date = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kompass//SV", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Kompass", "X-WR-TIMEZONE:Europe/Stockholm"];
  for (const e of entries) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}@kompass`, `DTSTAMP:${stamp(now)}`);
    if (e.allDay) {
      const key = dateKey(e.start);
      lines.push(`DTSTART;VALUE=DATE:${day(key)}`, `DTEND;VALUE=DATE:${day(addDays(key, 1))}`);
    } else {
      lines.push(`DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end && e.end > e.start ? e.end : e.start)}`);
    }
    lines.push(`SUMMARY:${esc(e.title)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
