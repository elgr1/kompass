import { addDays, dateKey, parseKey, weekday, zonedToUtc } from "../time";

/** Free-slot finding and auto time-blocking. Pure: no database, no clock. */

export type PlanSettings = {
  /** minutes from local midnight */
  dayStart: number;
  dayEnd: number;
  lunchStart: number;
  lunchEnd: number;
  /** ISO weekdays I plan study on: 1 = Monday ... 7 = Sunday */
  days: number[];
  /** cap on planned study minutes per day, classes not included */
  maxPerDay: number;
  /** preferred length of one block */
  blockMin: number;
  /** pause between blocks, and around classes */
  gapMin: number;
};

export const DEFAULT_SETTINGS: PlanSettings = {
  dayStart: 8 * 60, dayEnd: 18 * 60, lunchStart: 12 * 60, lunchEnd: 13 * 60, days: [1, 2, 3, 4, 5], maxPerDay: 300, blockMin: 90, gapMin: 15,
};

export type Interval = { start: Date; end: Date };
const MIN = 60_000;

export function atMinutes(day: string, minutes: number): Date {
  const { year, month, day: d } = parseKey(day);
  return zonedToUtc(year, month, d, Math.floor(minutes / 60), minutes % 60);
}

/** The study window of a day minus lunch and everything busy (padded by the gap). */
export function freeSlots(day: string, s: PlanSettings, busy: Interval[], notBefore?: Date): Interval[] {
  if (!s.days.includes(weekday(day))) return [];
  let free: Interval[] = [{ start: atMinutes(day, s.dayStart), end: atMinutes(day, s.dayEnd) }];
  const cut = (b: Interval) => {
    free = free.flatMap((f) => {
      if (b.end <= f.start || b.start >= f.end) return [f];
      const parts: Interval[] = [];
      if (b.start > f.start) parts.push({ start: f.start, end: b.start });
      if (b.end < f.end) parts.push({ start: b.end, end: f.end });
      return parts;
    });
  };
  if (s.lunchEnd > s.lunchStart) cut({ start: atMinutes(day, s.lunchStart), end: atMinutes(day, s.lunchEnd) });
  for (const b of busy) cut({ start: new Date(b.start.getTime() - s.gapMin * MIN), end: new Date(b.end.getTime() + s.gapMin * MIN) });
  if (notBefore) cut({ start: new Date(0), end: notBefore });
  return free.filter((f) => f.end.getTime() - f.start.getTime() >= 30 * MIN);
}

export const minutesOf = (xs: Interval[]) => xs.reduce((n, x) => n + (x.end.getTime() - x.start.getTime()) / MIN, 0);

/** Study time realistically available on a day: free slots, capped by the daily maximum. */
export function capacityMin(day: string, s: PlanSettings, busy: Interval[], alreadyPlanned = 0): number {
  return Math.max(0, Math.min(minutesOf(freeSlots(day, s, busy)), s.maxPerDay - alreadyPlanned));
}

export type SchedItem = { key: string; title: string; courseId: string | null; remainingMin: number; dueAt: Date | null };
export type Proposed = { workKey: string; title: string; courseId: string | null; start: Date; end: Date };

/**
 * Earliest-deadline-first: walk the free slots in time order and always give the next
 * block to the open item that is due soonest. Work is never placed after its own deadline;
 * whatever does not fit is reported back instead of silently dropped.
 */
export function proposeBlocks(input: {
  now: Date;
  days: string[];
  settings: PlanSettings;
  busy: Interval[];
  items: SchedItem[];
  /** study minutes already accepted, per day */
  planned?: Map<string, number>;
}): { blocks: Proposed[]; unplaced: { key: string; title: string; minutes: number; dueAt: Date | null }[] } {
  const s = input.settings;
  const left = new Map(input.items.map((i) => [i.key, i.remainingMin]));
  const blocks: Proposed[] = [];
  // start on the next quarter hour, leaving a moment to get going
  const soon = new Date(Math.ceil((input.now.getTime() + 10 * MIN) / (15 * MIN)) * 15 * MIN);
  const byUrgency = [...input.items].sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) || b.remainingMin - a.remainingMin);

  for (const day of input.days) {
    let cap = s.maxPerDay - (input.planned?.get(day) ?? 0);
    for (const slot of freeSlots(day, s, input.busy, soon)) {
      let cursor = slot.start.getTime();
      while (cap >= 15) {
        const room = (slot.end.getTime() - cursor) / MIN;
        if (room < 15) break;
        const item = byUrgency.find((i) => (left.get(i.key) ?? 0) >= 15 && (!i.dueAt || i.dueAt.getTime() > cursor));
        if (!item) break;
        const want = left.get(item.key)!;
        const len = Math.floor(Math.min(s.blockMin, room, want, cap, item.dueAt ? (item.dueAt.getTime() - cursor) / MIN : Infinity));
        // do not create slivers, unless the sliver finishes the item
        if (len < 30 && len < want) break;
        if (len < 15) break;
        blocks.push({ workKey: item.key, title: item.title, courseId: item.courseId, start: new Date(cursor), end: new Date(cursor + len * MIN) });
        left.set(item.key, want - len);
        cap -= len;
        cursor += (len + s.gapMin) * MIN;
      }
    }
  }
  const unplaced = input.items
    .filter((i) => (left.get(i.key) ?? 0) >= 15)
    .map((i) => ({ key: i.key, title: i.title, minutes: Math.round(left.get(i.key)!), dueAt: i.dueAt }));
  return { blocks, unplaced };
}

/** Places a fixed list of sessions (an exam plan) on their target days, spilling forward when a day is full. */
export function placeSessions(input: {
  sessions: { day: string; title: string; minutes: number }[];
  settings: PlanSettings;
  busy: Interval[];
  now: Date;
  lastDay: string;
}): { placed: { title: string; start: Date; end: Date }[]; unplaced: { title: string; minutes: number }[] } {
  const busy = [...input.busy];
  const placed: { title: string; start: Date; end: Date }[] = [];
  const unplaced: { title: string; minutes: number }[] = [];
  // Exam preparation may use every day of the week, whatever the normal study days are.
  const s = { ...input.settings, days: [1, 2, 3, 4, 5, 6, 7] };
  for (const session of input.sessions) {
    let need = session.minutes;
    for (let day = session.day; need >= 15 && day <= input.lastDay; day = addDays(day, 1)) {
      for (const slot of freeSlots(day, s, busy, input.now)) {
        if (need < 15) break;
        const len = Math.min(need, (slot.end.getTime() - slot.start.getTime()) / MIN);
        if (len < 30 && len < need) continue;
        const b = { start: slot.start, end: new Date(slot.start.getTime() + len * MIN) };
        placed.push({ title: session.title, ...b });
        busy.push(b);
        need -= len;
      }
    }
    if (need >= 15) unplaced.push({ title: session.title, minutes: Math.round(need) });
  }
  return { placed, unplaced };
}

export const todayAndNext = (now: Date, n: number) => Array.from({ length: n }, (_, i) => addDays(dateKey(now), i));
