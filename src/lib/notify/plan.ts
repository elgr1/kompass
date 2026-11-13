import type { TaskKind } from "../db/schema";
import type { AgendaEvent, Deadline } from "../queries";
import { dateKey, fmtDateTime, fmtDay, fmtRelative, fmtTime, weekday, zonedParts, type Lang } from "../time";

/** Pure notification planning: decides what should be sent now. No I/O, fully tested. */

export type Notice = { key: string; title: string; body: string; url?: string | null };
export type Remindable = { id: string; title: string; dueAt: Date; hasTime: boolean; kind: TaskKind; course?: string | null; url?: string | null };

const H = 3_600_000;
/** Things with a closing window get escalating reminders; ordinary deadlines get one the day before. */
function stages(r: Remindable): { id: string; before: number }[] {
  const urgent = r.kind === "signup" || r.kind === "booking" || r.kind === "exam";
  if (!urgent) return [{ id: "1d", before: 24 * H }];
  // Date-only items are stored at 23:59; "3 hours before" would be 21:00, so remind at 08:00 that morning instead.
  return [{ id: "3d", before: 72 * H }, { id: "1d", before: 24 * H }, r.hasTime ? { id: "3h", before: 3 * H } : { id: "day", before: 15 * H + 59 * 60_000 }];
}

const L = {
  sv: { signup: "Anmälan stänger", booking: "Bokning stänger", exam: "Tentamen", deadline: "Deadline", task: "Att göra", due: "Senast" },
  en: { signup: "Sign-up closes", booking: "Booking closes", exam: "Exam", deadline: "Deadline", task: "To do", due: "Due" },
} as const;

export function planReminders(now: Date, list: Remindable[], sent: Set<string>, lang: Lang): { send: Notice[]; markSent: string[] } {
  const send: Notice[] = [];
  const markSent: string[] = [];
  for (const r of list) {
    const left = r.dueAt.getTime() - now.getTime();
    if (left <= 0) continue;
    const reached = stages(r).filter((s) => left <= s.before);
    if (reached.length === 0) continue;
    // The due time is part of the key: if a deadline moves, its reminders start over.
    const key = (stage: string) => `rem:${r.id}:${r.dueAt.getTime()}:${stage}`;
    const latest = reached[reached.length - 1];
    // After a closed laptop, send only the most urgent reminder, not the whole backlog.
    for (const s of reached.slice(0, -1)) if (!sent.has(key(s.id))) markSent.push(key(s.id));
    if (sent.has(key(latest.id))) continue;
    send.push({
      key: key(latest.id),
      title: `${L[lang][r.kind]} ${fmtRelative(r.dueAt, lang, now)}: ${r.title}`,
      body: `${L[lang].due} ${r.hasTime ? fmtDateTime(r.dueAt, lang, now) : fmtDay(r.dueAt, lang)}${r.course ? ` · ${r.course}` : ""}`,
      url: r.url,
    });
  }
  return { send, markSent };
}

/** Morning digest between 06:30 and 11:00; weekly preview on Sundays between 16:00 and 22:00. Once each. */
export function digestDue(now: Date, sent: Set<string>): { key: string; type: "morning" | "weekly" } | null {
  const p = zonedParts(now);
  const minutes = p.hour * 60 + p.minute;
  const day = dateKey(now);
  if (weekday(day) === 7 && minutes >= 16 * 60 && minutes < 22 * 60 && !sent.has(`weekly:${day}`)) return { key: `weekly:${day}`, type: "weekly" };
  if (minutes >= 6 * 60 + 30 && minutes < 11 * 60 && !sent.has(`digest:${day}`)) return { key: `digest:${day}`, type: "morning" };
  return null;
}

export type DigestData = { events: AgendaEvent[]; deadlines: Deadline[]; radarAction: number; suggestions: number };

export function composeDigest(type: "morning" | "weekly", d: DigestData, lang: Lang, now: Date): { title: string; body: string } {
  const sv = lang === "sv";
  const lines: string[] = [];
  const open = d.deadlines.filter((x) => x.state === "open" || x.state === "missing");
  if (type === "morning") {
    lines.push(d.events.length
      ? d.events.filter((e) => !e.allDay).map((e) => `${fmtTime(e.startAt)} ${e.title}${e.location ? ` (${e.location})` : ""}`).join("\n") || (sv ? "Inget schemalagt." : "Nothing scheduled.")
      : sv ? "Inget schemalagt idag." : "Nothing scheduled today.");
  } else {
    lines.push(sv ? `${d.events.filter((e) => !e.allDay).length} schemalagda pass nästa vecka.` : `${d.events.filter((e) => !e.allDay).length} scheduled sessions next week.`);
  }
  if (open.length) {
    lines.push(sv ? "Deadlines:" : "Deadlines:");
    for (const x of open.slice(0, 6)) lines.push(`• ${fmtDay(x.dueAt, lang)} ${fmtTime(x.dueAt)} ${x.title}${x.course ? ` (${x.course.shortName})` : ""}`);
    if (open.length > 6) lines.push(sv ? `…och ${open.length - 6} till` : `…and ${open.length - 6} more`);
  } else {
    lines.push(sv ? "Inga öppna deadlines." : "No open deadlines.");
  }
  if (d.radarAction) lines.push(sv ? `Radar: ${d.radarAction} kräver åtgärd.` : `Radar: ${d.radarAction} need action.`);
  if (d.suggestions) lines.push(sv ? `${d.suggestions} hittade deadlines väntar på granskning.` : `${d.suggestions} found deadlines await review.`);
  const title = type === "morning" ? (sv ? `God morgon · ${fmtDay(now, lang)}` : `Good morning · ${fmtDay(now, lang)}`) : sv ? "Veckan som kommer" : "The week ahead";
  return { title, body: lines.join("\n") };
}
