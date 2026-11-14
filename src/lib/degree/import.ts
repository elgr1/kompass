import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { courses, degreeCourses } from "../db/schema";
import { setSetting } from "../settings";
import { isPass, type LadokResult } from "./ladok";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export type ImportSummary = {
  added: number;
  updated: number;
  skipped: number;
  /** finished credits among the imported rows, plus passed parts: comparable with Ladok's own total */
  importedTenths: number;
  ladokTotalTenths: number | null;
  /** true when Ladok printed a total and the import adds up to exactly that */
  matchesLadok: boolean | null;
};

/**
 * Stores parsed Ladok results. A course already in the list is updated, never duplicated:
 * matched on course code when there is one, otherwise on its name. The Resultatintyg has
 * no codes, so codes are filled in from Studium courses with the same name where possible.
 */
export function importLadok(db: Db, parsed: LadokResult, now: Date = new Date()): ImportSummary {
  const studium = new Map(db.select({ name: courses.shortName, code: courses.code }).from(courses).all().filter((c) => c.code).map((c) => [norm(c.name), c.code!]));
  let added = 0;
  let updated = 0;
  db.transaction((tx) => {
    const existing = tx.select().from(degreeCourses).all();
    for (const r of parsed.rows) {
      const code = r.code ?? studium.get(norm(r.name)) ?? null;
      const status = r.status ?? (isPass(r.grade) ? "done" : "ongoing");
      const prev = existing.find((e) => (code && e.code === code) || norm(e.name) === norm(r.name));
      if (prev) {
        // keep what I added by hand (term, category, prerequisites); refresh what Ladok knows
        tx.update(degreeCourses).set({ name: r.name, hp: r.hpTenths, grade: r.grade, date: r.date, status, code: prev.code ?? code }).where(eq(degreeCourses.id, prev.id)).run();
        updated++;
      } else {
        const row = tx.insert(degreeCourses).values({ code, name: r.name, hp: r.hpTenths, grade: r.grade, date: r.date, status, source: "ladok" }).returning().get();
        existing.push(row);
        added++;
      }
    }
  });
  const importedTenths = parsed.rows.filter((r) => (r.status ?? (isPass(r.grade) ? "done" : "ongoing")) === "done").reduce((n, r) => n + r.hpTenths, 0) + parsed.partsTenths;
  const summary: ImportSummary = {
    added, updated, skipped: parsed.skipped, importedTenths, ladokTotalTenths: parsed.totalTenths,
    matchesLadok: parsed.totalTenths === null ? null : parsed.totalTenths === importedTenths,
  };
  setSetting(db, "ladok_last", JSON.stringify({ ...summary, at: now.getTime() }));
  return summary;
}
