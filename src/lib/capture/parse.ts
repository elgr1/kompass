import type { TaskKind } from "../db/schema";
import { extractDates } from "../detect/dates";

/**
 * Quick capture: one line of text -> a task. Pure (also runs in the browser for the live preview).
 *   "labbrapport fysik3 fre 17"                         -> due Friday 17:00, course by nickname
 *   "apply Ericsson summer internship by 1 dec #career" -> due 1 Dec, tag career
 */

export type CaptureCourse = { id: string; shortName: string; code: string | null; nicknames: string };

export type Captured = {
  title: string;
  /** YYYY-MM-DD */
  date: string | null;
  time: string | null;
  courseId: string | null;
  tags: string[];
  kind: TaskKind;
};

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const LEAD_IN = /(?:^|\s)(?:by|senast|before|innan|före|on|på|due|till|den|at|kl\.?|until)\s*$/i;

/** token -> course, for nicknames, course codes and distinctive first words of the name */
function courseIndex(courses: CaptureCourse[]): Map<string, { id: string; strip: boolean }> {
  const idx = new Map<string, { id: string; strip: boolean }>();
  const firstWords = new Map<string, string[]>();
  for (const c of courses) {
    for (const n of c.nicknames.split(",").map(norm).filter(Boolean)) idx.set(n, { id: c.id, strip: true });
    if (c.code) idx.set(norm(c.code), { id: c.id, strip: true });
    const w = norm(c.shortName.split(/\s+/)[0] ?? "");
    if (w.length >= 5) firstWords.set(w, [...(firstWords.get(w) ?? []), c.id]);
  }
  // The first word of a course name counts only when no other course starts with it; it stays in the title.
  for (const [w, ids] of firstWords) if (ids.length === 1 && !idx.has(w)) idx.set(w, { id: ids[0], strip: false });
  return idx;
}

export function parseCapture(input: string, opts: { now: Date; courses: CaptureCourse[] }): Captured {
  let text = input.trim().replace(/\s+/g, " ");
  const tags: string[] = [];
  text = text.replace(/(^|\s)#([\p{L}\d][\p{L}\d_-]*)/gu, (_, sp: string, tag: string) => {
    if (!tags.includes(tag.toLowerCase())) tags.push(tag.toLowerCase());
    return sp;
  });

  let date: string | null = null;
  let time: string | null = null;
  const m = extractDates(text, opts.now, { shorthand: true })[0];
  if (m) {
    date = m.date;
    time = m.time;
    const before = text.slice(0, m.index).replace(LEAD_IN, "");
    text = `${before} ${text.slice(m.index + m.length)}`;
  }

  let courseId: string | null = null;
  const idx = courseIndex(opts.courses);
  const words = text.split(" ").filter(Boolean);
  const kept: string[] = [];
  for (const w of words) {
    const explicit = w.startsWith("@");
    const hit = idx.get(norm(w));
    if (hit && !courseId) {
      courseId = hit.id;
      if (hit.strip || explicit) continue;
    }
    kept.push(explicit ? w.slice(1) : w);
  }

  const title = kept.join(" ").replace(/\s+([,.;:])/g, "$1").replace(/[\s,;:–-]+$/, "").trim();
  const kind: TaskKind = /anmäl|sign[\s-]?up|registrer|\bregister/i.test(title) ? "signup" : /(?:^|\s)boka|\bbook\b/i.test(title) ? "booking" : "task";
  return { title: title ? title.charAt(0).toUpperCase() + title.slice(1) : "", date, time, courseId, tags, kind };
}
