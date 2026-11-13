import type { DegreeCourse } from "../db/schema";

/** Degree progress maths. Credits are handled in tenths so 7.5 hp adds up exactly. Pure. */

export type DegreeSummary = {
  target: number;
  done: number;
  ongoing: number;
  planned: number;
  /** what is still unaccounted for once everything done, ongoing and planned is added up */
  unplanned: number;
  byCategory: { category: string; done: number; ongoing: number; planned: number }[];
  byTerm: { term: string; done: number; ongoing: number; planned: number }[];
};

/** "HT2026" < "VT2027": a year's spring term comes before its autumn term. */
export function termOrder(term: string): number {
  const m = term.match(/^(VT|ST|HT)\s?(\d{2,4})$/i);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return year * 10 + { VT: 1, ST: 2, HT: 3 }[m[1].toUpperCase() as "VT" | "ST" | "HT"];
}

export function summarize(courses: Pick<DegreeCourse, "hp" | "status" | "category" | "term">[], targetTenths: number): DegreeSummary {
  const sum = { done: 0, ongoing: 0, planned: 0 };
  const cat = new Map<string, typeof sum>();
  const term = new Map<string, typeof sum>();
  for (const c of courses) {
    sum[c.status] += c.hp;
    for (const [map, key] of [[cat, c.category || ""], [term, c.term || ""]] as const) {
      const e = map.get(key) ?? { done: 0, ongoing: 0, planned: 0 };
      e[c.status] += c.hp;
      map.set(key, e);
    }
  }
  return {
    target: targetTenths,
    ...sum,
    unplanned: Math.max(0, targetTenths - sum.done - sum.ongoing - sum.planned),
    byCategory: [...cat].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.done + b.ongoing + b.planned - (a.done + a.ongoing + a.planned)),
    byTerm: [...term].filter(([t]) => t).map(([t, v]) => ({ term: t, ...v })).sort((a, b) => termOrder(a.term) - termOrder(b.term)),
  };
}

/** Course codes a course requires that are not passed yet. */
export function missingPrereqs(course: Pick<DegreeCourse, "prereq">, passed: Set<string>): string[] {
  return course.prereq.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter((c) => c && !passed.has(c));
}

export const fmtHp = (tenths: number, lang: "sv" | "en") => new Intl.NumberFormat(lang === "sv" ? "sv-SE" : "en-GB", { maximumFractionDigits: 1 }).format(tenths / 10);
