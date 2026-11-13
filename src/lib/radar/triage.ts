import type { FieldDiff } from "../db/schema";

/**
 * Words that usually mean "you have to do something by a date".
 * This is deliberately broad: a false "Action needed" costs one click, a miss costs a lab slot.
 */
export const ACTION_WORDS =
  /\b(anmäl\w*|registrer\w*|sign[\s-]?up|register\w*|enrol\w*|labbgrupp\w*|gruppindelning\w*|gruppval\w*|boka\w*|bokning\w*|senast|deadline\w*|sista dag\w*|obligatorisk\w*|mandatory|compulsory|tentamensanmälan|omtenta\w*|re-?exam\w*|due\b|no later than|at the latest)/i;

const DAY = 86_400_000;

export type TriageInput = {
  type: "added" | "updated" | "removed";
  kind: string;
  title: string;
  comparable: Record<string, unknown>;
  diffs: FieldDiff[];
  now: Date;
};

const time = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

export function triage(c: TriageInput): "action" | "fyi" {
  const now = c.now.getTime();
  const changed = (f: string) => c.diffs.some((d) => d.field === f);
  const text = `${c.title}\n${typeof c.comparable.body === "string" ? c.comparable.body : ""}`;
  const start = time(c.comparable.start_at);
  const due = time(c.comparable.due_at);
  const soon = (t: number | null, days: number) => t !== null && t > now && t < now + days * DAY;
  const done = ["submitted", "graded", "pending_review"].includes(String(c.comparable.submission_state)) || c.comparable.excused === true;

  switch (c.kind) {
    case "submission_comment":
      return c.type === "added" ? "action" : "fyi";

    case "assignment":
    case "quiz":
      if (c.type === "removed") return "fyi";
      if (done) return "fyi";
      if (c.type === "added") return due !== null && due > now ? "action" : "fyi";
      // A moved deadline or changed lock date always matters while the work is not handed in.
      return changed("due_at") || changed("lock_at") ? "action" : "fyi";

    case "appointment_group":
      return c.type === "removed" ? "fyi" : "action";

    case "announcement":
    case "discussion":
    case "page":
    case "syllabus":
      if (c.type === "removed") return "fyi";
      if (c.type === "updated" && !changed("body") && !changed("title")) return "fyi";
      return ACTION_WORDS.test(text) ? "action" : "fyi";

    case "calendar_event":
    case "schedule_event": {
      // New, moved or cancelled sessions matter only when they are close.
      const before = time(c.diffs.find((d) => d.field === "start_at")?.before);
      if (c.type === "removed") return soon(start, 14) ? "action" : "fyi";
      if (c.type === "added") return ACTION_WORDS.test(text) && soon(start, 30) ? "action" : "fyi";
      const moved = changed("start_at") || changed("end_at") || changed("location");
      return moved && (soon(start, 14) || soon(before, 14)) ? "action" : "fyi";
    }

    default:
      return "fyi"; // files, modules, groups
  }
}
