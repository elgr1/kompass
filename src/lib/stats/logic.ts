import { addDays } from "../time";

/** Study analytics and the course-health score. Pure. */

export type TimeRow = { key: string; monday: string; minutes: number };

/** minutes per week (by Monday) per key (course id, `project:<id>` or "") */
export function minutesByWeek(rows: TimeRow[], mondays: string[]): { monday: string; byKey: Map<string, number>; total: number }[] {
  return mondays.map((monday) => {
    const byKey = new Map<string, number>();
    for (const r of rows) if (r.monday === monday) byKey.set(r.key, (byKey.get(r.key) ?? 0) + r.minutes);
    return { monday, byKey, total: [...byKey.values()].reduce((a, b) => a + b, 0) };
  });
}

export type AccuracySample = { title: string; estimateMin: number; actualMin: number };
export function estimateAccuracy(samples: AccuracySample[]): { n: number; medianRatio: number | null; within25: number | null; worst: (AccuracySample & { ratio: number })[] } {
  const rated = samples.filter((s) => s.estimateMin > 0 && s.actualMin >= 10).map((s) => ({ ...s, ratio: s.actualMin / s.estimateMin }));
  if (rated.length === 0) return { n: 0, medianRatio: null, within25: null, worst: [] };
  const sorted = [...rated].sort((a, b) => a.ratio - b.ratio);
  const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2].ratio : (sorted[sorted.length / 2 - 1].ratio + sorted[sorted.length / 2].ratio) / 2;
  return {
    n: rated.length,
    medianRatio: Math.round(mid * 100) / 100,
    // share of items that landed within 25% of the estimate
    within25: Math.round((rated.filter((s) => s.ratio >= 0.75 && s.ratio <= 1.25).length / rated.length) * 100),
    worst: [...rated].sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio))).slice(0, 5),
  };
}

/** Consecutive weeks with a weekly review, counting back from this week (or last week, if this week's is not done yet). */
export function reviewStreak(reviewedMondays: Set<string>, currentMonday: string): number {
  let monday = reviewedMondays.has(currentMonday) ? currentMonday : addDays(currentMonday, -7);
  let n = 0;
  while (reviewedMondays.has(monday)) {
    n++;
    monday = addDays(monday, -7);
  }
  return n;
}

export type HealthInput = {
  /** unsubmitted deadlines that have passed (last three weeks) */
  missing: number;
  /** open deadlines within 7 days with no time logged yet */
  unstartedSoon: number;
  /** unread Radar entries needing action */
  unreadAction: number;
  /** teacher comments not yet acknowledged */
  newFeedback: number;
};
export type HealthReason = "missing" | "unstarted" | "radar" | "feedback";
export type Health = { score: number; level: "ok" | "watch" | "behind"; reasons: { reason: HealthReason; n: number }[] };

/**
 * A rough "am I on track?" signal per course, from things the app can actually see.
 * 100 = nothing outstanding. Missed hand-ins weigh most; unread items least.
 */
export function courseHealth(i: HealthInput): Health {
  const penalties: [HealthReason, number, number][] = [
    ["missing", i.missing, Math.min(60, i.missing * 30)],
    ["unstarted", i.unstartedSoon, Math.min(30, i.unstartedSoon * 15)],
    ["radar", i.unreadAction, Math.min(20, i.unreadAction * 10)],
    ["feedback", i.newFeedback, Math.min(10, i.newFeedback * 5)],
  ];
  const score = Math.max(0, 100 - penalties.reduce((n, p) => n + p[2], 0));
  return { score, level: score >= 80 ? "ok" : score >= 55 ? "watch" : "behind", reasons: penalties.filter((p) => p[1] > 0).map(([reason, n]) => ({ reason, n })) };
}
