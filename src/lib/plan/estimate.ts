/** Effort estimates: defaults per kind of work, corrected by how long things actually take me. Pure. */

export const WORK_TYPES = ["lab_report", "prelab", "problem_set", "assignment", "reading", "quiz", "project", "exam_prep", "admin", "other"] as const;
export type WorkType = (typeof WORK_TYPES)[number];

/** Starting guesses in minutes. They are meant to be wrong at first and corrected by the multipliers. */
export const DEFAULT_MIN: Record<WorkType, number> = {
  lab_report: 360, prelab: 90, problem_set: 300, assignment: 180, reading: 120, quiz: 60, project: 600, exam_prep: 120, admin: 15, other: 60,
};

/** How many days before the deadline work on this typically starts; used to spread load in the heatmap. */
export const LEAD_DAYS: Record<WorkType, number> = {
  lab_report: 7, prelab: 3, problem_set: 7, assignment: 5, reading: 3, quiz: 4, project: 21, exam_prep: 14, admin: 2, other: 3,
};

/** Work that needs a clear head, as opposed to things that can be done tired. */
export const DEMANDING = new Set<WorkType>(["lab_report", "problem_set", "project", "exam_prep", "assignment"]);

export const isWorkType = (s: unknown): s is WorkType => typeof s === "string" && (WORK_TYPES as readonly string[]).includes(s);

export function guessType(title: string, kind: string): WorkType {
  const t = title.toLowerCase();
  if (kind === "signup" || kind === "booking") return "admin";
  if (/pre-?lab|förbered|inför lab/.test(t)) return "prelab";
  if (/lab\w*[\s:–-]*\d*[\s:–-]*(?:rapport|report)|(?:rapport|report)\w*\s.*lab|labbrapport|lab report/.test(t)) return "lab_report";
  if (kind === "quiz" || /quiz|dugga/.test(t)) return "quiz";
  if (/proje[ck]t/.test(t)) return "project";
  if (/inlämning|(?:^|\s)inl\.?\s?\d|hand-?in|problem set|homework|räkneuppgift|hemuppgift/.test(t)) return "problem_set";
  if (kind === "exam" || /tenta|exam|plugga|repet/.test(t)) return "exam_prep";
  if (/(?:^|\s)läs|read|kapitel|chapter/.test(t)) return "reading";
  if (kind === "assignment") return "assignment";
  return "other";
}

export type Sample = { courseId: string | null; type: WorkType; estimateMin: number; actualMin: number };
export type Multipliers = { byCourseType: Map<string, { factor: number; n: number }>; byType: Map<WorkType, { factor: number; n: number }> };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const clamp = (x: number) => Math.round(Math.min(3, Math.max(0.5, x)) * 100) / 100;

/**
 * Personal multipliers = median(actual / estimated) over finished work.
 * Per course + type needs 2 samples, per type alone 3; one unusual lab should not rewrite the plan.
 */
export function learnMultipliers(samples: Sample[]): Multipliers {
  const group = <K,>(key: (s: Sample) => K | null) => {
    const m = new Map<K, number[]>();
    for (const s of samples) {
      const k = key(s);
      if (k === null || s.estimateMin <= 0 || s.actualMin < 10) continue;
      m.set(k, [...(m.get(k) ?? []), s.actualMin / s.estimateMin]);
    }
    return m;
  };
  const out: Multipliers = { byCourseType: new Map(), byType: new Map() };
  for (const [k, r] of group((s) => (s.courseId ? `${s.courseId}|${s.type}` : null))) if (r.length >= 2) out.byCourseType.set(k, { factor: clamp(median(r)), n: r.length });
  for (const [k, r] of group((s) => s.type)) if (r.length >= 3) out.byType.set(k, { factor: clamp(median(r)), n: r.length });
  return out;
}

export function multiplierFor(m: Multipliers, courseId: string | null, type: WorkType): number {
  return (courseId ? m.byCourseType.get(`${courseId}|${type}`)?.factor : undefined) ?? m.byType.get(type)?.factor ?? 1;
}
