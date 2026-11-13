import { addDays } from "../time";

/** Backwards planning from an exam date. Pure. */

export type ExamSession = { day: string; title: string; kind: "review" | "old_exam" | "repeat" | "buffer"; minutes: number };
export type ExamLabels = { review: string; oldExam: string; repeat: string; buffer: string };

export const SESSION_MIN = { review: 120, old_exam: 240, repeat: 45, buffer: 60 } as const;

/**
 * Lays out revision between today and the exam:
 *   1. one review session per topic,
 *   2. old exams, each followed by short repeats of earlier topics (spaced repetition:
 *      every topic comes back at least once, some days after its first pass),
 *   3. the last `bufferDays` days are kept light, for whatever slipped.
 * The work is spread evenly over the available days rather than piled up at the end.
 */
export function buildExamSessions(input: {
  today: string;
  examDay: string;
  topics: string[];
  oldExams: number;
  bufferDays: number;
  labels: ExamLabels;
}): { sessions: ExamSession[]; warnings: ("too_late" | "tight")[] } {
  const warnings: ("too_late" | "tight")[] = [];
  const days: string[] = [];
  for (let d = input.today; d < input.examDay; d = addDays(d, 1)) days.push(d);
  if (days.length === 0) return { sessions: [], warnings: ["too_late"] };

  const buffer = Math.min(Math.max(0, input.bufferDays), Math.max(0, days.length - 1));
  const workDays = days.slice(0, days.length - buffer);
  const bufferDays = days.slice(days.length - buffer);
  const topics = input.topics.map((t) => t.trim()).filter(Boolean);

  const queue: Omit<ExamSession, "day">[] = topics.map((t) => ({ title: `${input.labels.review}: ${t}`, kind: "review", minutes: SESSION_MIN.review }));
  const exams = Math.max(0, Math.min(20, Math.floor(input.oldExams)));
  // Topics are handed out for repetition in rounds, so each one returns after an old exam.
  const perRound = exams > 0 ? Math.ceil(topics.length / exams) : 0;
  for (let e = 0; e < exams; e++) {
    queue.push({ title: `${input.labels.oldExam} ${e + 1}`, kind: "old_exam", minutes: SESSION_MIN.old_exam });
    for (const t of topics.slice(e * perRound, (e + 1) * perRound)) queue.push({ title: `${input.labels.repeat}: ${t}`, kind: "repeat", minutes: SESSION_MIN.repeat });
  }

  const sessions: ExamSession[] = queue.map((q, i) => ({ ...q, day: workDays[Math.min(workDays.length - 1, Math.floor((i * workDays.length) / queue.length))] }));
  for (const d of bufferDays) sessions.push({ day: d, title: input.labels.buffer, kind: "buffer", minutes: SESSION_MIN.buffer });

  const perDay = new Map<string, number>();
  for (const x of sessions) perDay.set(x.day, (perDay.get(x.day) ?? 0) + x.minutes);
  if ([...perDay.values()].some((m) => m > 360)) warnings.push("tight");
  return { sessions, warnings };
}
