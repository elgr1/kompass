/**
 * Reads course results pasted from Ladok (or any spreadsheet/CSV): one course per line.
 * Ladok has no student API, so this is deliberately tolerant about layout. Pure.
 *
 * A line counts as a course only if it has BOTH a course code and a credit value;
 * Ladok's module rows ("Laborationer 1,0 hp G") have no code and are skipped, so
 * credits are not counted twice.
 */

export type LadokRow = { code: string; name: string; hpTenths: number; grade: string | null; date: string | null };

// 5-7 characters, capitals and digits, at least one of each: 1FA102, 1TD354, SF1624.
const CODE = /(?<![A-Za-z0-9])(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,7}(?![A-Za-z0-9])/g;
const TERM = /^(?:HT|VT|ST)\d{2,4}$/;
const HP = /(\d{1,3}(?:[.,]\d)?)\s*(?:hp|högskolepoäng|credits|ects)\b/i;
const DATE = /\b(\d{4}-\d{2}-\d{2})\b/;
const GRADE_LABELLED = /\b(?:betyg|grade)\s*:?\s*(VG|G|U|[345]|[A-F]x?)\b/i;
const GRADE_CELL = /^(VG|G|U|[345]|[A-F]|Fx)$/i;

const toTenths = (s: string) => Math.round(Number(s.replace(",", ".")) * 10);

export function parseLadok(text: string): { rows: LadokRow[]; skipped: number } {
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
  return { rows: [...rows.values()], skipped };
}

/** A failing or missing grade means the credits are not earned yet. */
export const isPass = (grade: string | null) => grade !== null && !/^(U|F|Fx)$/i.test(grade);
