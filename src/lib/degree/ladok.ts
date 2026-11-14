/**
 * Reads course results from Ladok. Ladok has no student API, so this takes text: pasted,
 * or extracted from the "Resultatintyg" PDF. Pure.
 *
 * Two layouts are understood:
 *
 * 1. Ladok's Resultatintyg, which has NO course codes:
 *        Avslutade kurser
 *        Envariabelanalys 10,0 hp 3 2025-01-13 1
 *        Delar i ej avslutade kurser
 *        Kvantfysik F (10,0 hp)
 *        Laborationer 1,0 hp G 2026-10-30 2
 *    Rows under "Avslutade kurser" are finished courses. Under "Delar i ej avslutade kurser"
 *    the "(10,0 hp)" header lines are ongoing courses, and the part rows beneath them are
 *    NOT courses: counting them would count credits twice.
 *
 * 2. Tables or free text that carry a course code on each line (web page, spreadsheet, CSV).
 *    There a line counts only if it has both a code and credits, which is what keeps
 *    code-less module rows out.
 */

export type LadokRow = {
  /** null for the Resultatintyg layout, which does not print codes */
  code: string | null;
  name: string;
  hpTenths: number;
  grade: string | null;
  date: string | null;
  /** set when the layout itself says so (Resultatintyg sections); otherwise derived from the grade */
  status?: "done" | "ongoing";
};
export type LadokResult = {
  rows: LadokRow[];
  skipped: number;
  /** "Summering: Totalt" from a Resultatintyg, for checking the import against Ladok's own sum */
  totalTenths: number | null;
  /** credits of passed parts in unfinished courses: included in Ladok's total, but not whole courses */
  partsTenths: number;
};

// 5-7 characters, capitals and digits, at least one of each: 1FA102, 1TD354, SF1624.
const CODE = /(?<![A-Za-z0-9])(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,7}(?![A-Za-z0-9])/g;
const TERM = /^(?:HT|VT|ST)\d{2,4}$/;
const HP = /(\d{1,3}(?:[.,]\d)?)\s*(?:hp|högskolepoäng|credits|ects)\b/i;
const DATE = /\b(\d{4}-\d{2}-\d{2})\b/;
const GRADE_LABELLED = /\b(?:betyg|grade)\s*:?\s*(VG|G|U|[345]|[A-F]x?)\b/i;
const GRADE_CELL = /^(VG|G|U|[345]|[A-F]|Fx)$/i;

const toTenths = (s: string) => Math.round(Number(s.replace(",", ".")) * 10);

const INTYG_ROW = /^(.+?)\s+(\d{1,3}[.,]\d)\s*hp\s+(VG|G|U|[345])\s+(\d{4}-\d{2}-\d{2})(?:\s+\d+)?$/;
const INTYG_HEADER = /^(.+?)\s+\((\d{1,3}[.,]\d)\s*hp\)$/;
const hasCode = (line: string) => [...line.matchAll(CODE)].some((m) => !TERM.test(m[0]));

/** Ladok's Resultatintyg (see the layout at the top of this file). */
function parseResultatintyg(text: string): LadokResult {
  const rows = new Map<string, LadokRow>();
  let section: "done" | "parts" | "other" | null = null;
  let skipped = 0;
  let partsTenths = 0;
  let totalTenths: number | null = null;
  let summary = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/\s+/g, " ");
    if (!line) continue;
    if (/^Avslutade kurser/i.test(line) || /^Completed courses/i.test(line)) { section = "done"; continue; }
    if (/^Delar i ej avslutade kurser/i.test(line) || /^Parts of uncompleted courses/i.test(line)) { section = "parts"; continue; }
    if (/^(Summering|Summary)\b/i.test(line)) { section = "other"; summary = true; continue; }
    if (/^(Noter och information|Notes and information)/i.test(line)) { section = "other"; summary = false; continue; }
    if (summary && totalTenths === null) {
      const t = line.match(/^(\d{1,3}[.,]\d)\s*hp\b/);
      if (t) totalTenths = toTenths(t[1]);
    }
    if (section === "other") continue;
    const row = line.match(INTYG_ROW);
    const header = line.match(INTYG_HEADER);
    if (section === "parts") {
      if (header) rows.set(header[1].toLowerCase(), { code: null, name: header[1], hpTenths: toTenths(header[2]), grade: null, date: null, status: "ongoing" });
      else if (row) {
        // a part of an unfinished course: its credits are real, but it is not a course
        skipped++;
        if (isPass(row[3])) partsTenths += toTenths(row[2]);
      }
      continue;
    }
    // Rows before any heading (someone pasted only the table) are treated as finished courses.
    if (row) rows.set(row[1].toLowerCase(), { code: null, name: row[1], hpTenths: toTenths(row[2]), grade: row[3].toUpperCase(), date: row[4], status: isPass(row[3]) ? "done" : "ongoing" });
  }
  return { rows: [...rows.values()], skipped, totalTenths, partsTenths };
}

export function parseLadok(text: string): LadokResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const intyg = /Avslutade kurser|Delar i ej avslutade kurser|Resultatintyg|Completed courses/i.test(text) || (!lines.some(hasCode) && lines.some((l) => INTYG_ROW.test(l.replace(/\s+/g, " "))));
  if (intyg) return parseResultatintyg(text);

  const rows = new Map<string, LadokRow>();
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = (/\t/.test(line) ? line.split("\t") : /;/.test(line) ? line.split(";") : line.split(/\s{2,}|,(?=\S*[A-Za-z])|\s\|\s/)).map((c) => c.trim()).filter(Boolean);
    const code = [...line.matchAll(CODE)].map((m) => m[0]).find((c) => !TERM.test(c));
    let hp = line.match(HP)?.[1];
    // In a table the credits column often has no unit: accept a lone number like "5,0" or "7.5".
    if (!hp) hp = cells.find((c) => /^\d{1,2}[.,][05]$/.test(c));
    if (!code || !hp) {
      if (HP.test(line) || code) skipped++;
      continue;
    }
    const date = line.match(DATE)?.[1] ?? null;
    let grade = line.match(GRADE_LABELLED)?.[1] ?? cells.find((c) => GRADE_CELL.test(c)) ?? null;
    if (!grade) {
      // Free text: a lone grade token left over once the code, credits and date are removed.
      const rest = line.replace(code, " ").replace(HP, " ").replace(DATE, " ");
      grade = rest.match(/(?:^|\s)(VG|G|U|[345])(?=\s|$)/)?.[1] ?? null;
    }
    const name = line
      .replace(code, " ")
      .replace(HP, " ")
      .replace(DATE, " ")
      .replace(GRADE_LABELLED, " ")
      .replace(/\(\s*\)/g, " ")
      .split(/\t|;|\s{2,}|\s\|\s/)
      .map((c) => c.trim().replace(/^[\s,()\-–:]+|[\s,()\-–:]+$/g, ""))
      .filter((c) => c && !GRADE_CELL.test(c) && !/^\d+([.,]\d)?$/.test(c) && !TERM.test(c))
      .sort((a, b) => b.length - a.length)[0] ?? code;
    rows.set(code, { code, name, hpTenths: toTenths(hp), grade: grade ? grade.toUpperCase().replace("FX", "Fx") : null, date });
  }
  return { rows: [...rows.values()], skipped, totalTenths: null, partsTenths: 0 };
}

/** A failing or missing grade means the credits are not earned yet. */
export const isPass = (grade: string | null) => grade !== null && !/^(U|F|Fx)$/i.test(grade);
