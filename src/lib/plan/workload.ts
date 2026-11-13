import { addDays, dateKey, mondayOf } from "../time";

/** Workload heatmap maths. Pure. */

export type LoadItem = { key: string; courseId: string | null; remainingMin: number; dueAt: Date; leadDays: number };

/**
 * Spreads each item's remaining effort evenly over the days it is likely to be worked on:
 * from `leadDays` before the deadline (or today, if that has passed) up to the deadline day.
 */
export function spreadByDay(items: LoadItem[], today: string): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const it of items) {
    if (it.remainingMin <= 0) continue;
    const due = dateKey(it.dueAt);
    const last = due < today ? today : due;
    let first = addDays(last, -(Math.max(1, it.leadDays) - 1));
    if (first < today) first = today;
    const days: string[] = [];
    for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
    for (const d of days) {
      const m = out.get(d) ?? new Map<string, number>();
      const c = it.courseId ?? "";
      m.set(c, (m.get(c) ?? 0) + it.remainingMin / days.length);
      out.set(d, m);
    }
  }
  return out;
}

export type WeekLoad = {
  monday: string;
  /** estimated study minutes, per course id ("" = no course) */
  byCourse: Map<string, number>;
  studyMin: number;
  classMin: number;
  capacityMin: number;
  /** study load divided by free study time; above 0.85 the week is a crunch */
  ratio: number;
  crunch: boolean;
};

export const CRUNCH_RATIO = 0.85;

export function weekLoads(input: {
  mondays: string[];
  perDay: Map<string, Map<string, number>>;
  /** scheduled class minutes per day */
  classMin: Map<string, number>;
  /** free study minutes per day (see capacityMin) */
  capacity: Map<string, number>;
}): WeekLoad[] {
  return input.mondays.map((monday) => {
    const byCourse = new Map<string, number>();
    let classMin = 0;
    let capacity = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(monday, i);
      for (const [c, m] of input.perDay.get(d) ?? []) byCourse.set(c, (byCourse.get(c) ?? 0) + m);
      classMin += input.classMin.get(d) ?? 0;
      capacity += input.capacity.get(d) ?? 0;
    }
    const studyMin = [...byCourse.values()].reduce((a, b) => a + b, 0);
    const ratio = capacity > 0 ? studyMin / capacity : studyMin > 0 ? Infinity : 0;
    return { monday, byCourse, studyMin, classMin, capacityMin: capacity, ratio, crunch: studyMin >= 120 && ratio > CRUNCH_RATIO };
  });
}

export const upcomingMondays = (today: string, n: number) => Array.from({ length: n }, (_, i) => addDays(mondayOf(today), i * 7));
