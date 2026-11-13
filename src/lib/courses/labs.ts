/** Lab-series checklist, derived from a course's assignments. Pure. */

export type LabAssignment = { title: string; state: "open" | "submitted" | "graded" | "missing"; grade: string | null; dueAt: Date | null; url: string | null };
export type LabStep = "todo" | "submitted" | "done" | "missing";
export type LabRow = { n: number; prep: LabAssignment | null; report: LabAssignment | null; other: LabAssignment[]; prepStep: LabStep | null; reportStep: LabStep | null; approved: boolean };

const NUMBER = /\blab(?:b|oration(?:en)?|orator(?:y|ieövning))?\.?\s*(?:nr\.?\s*|#\s*)?(\d{1,2})\b/i;
const PREP = /pre-?lab|förbered|inför\s+lab|preparat/i;
const REPORT = /rapport|report|redovisning/i;

const step = (a: LabAssignment | null): LabStep | null =>
  a === null ? null : a.state === "graded" ? "done" : a.state === "submitted" ? "submitted" : a.state === "missing" ? "missing" : "todo";

/** Groups "Pre-lab 2", "Lab 2: rapport" etc. by lab number: preparation -> report -> approved. */
export function labSeries(assignments: LabAssignment[]): LabRow[] {
  const rows = new Map<number, LabRow>();
  for (const a of assignments) {
    const m = a.title.match(NUMBER);
    if (!m) continue;
    const n = Number(m[1]);
    const row = rows.get(n) ?? { n, prep: null, report: null, other: [], prepStep: null, reportStep: null, approved: false };
    if (PREP.test(a.title) && !row.prep) row.prep = a;
    else if (REPORT.test(a.title) && !row.report) row.report = a;
    // an unlabelled "Lab 3" assignment is the hand-in for that lab
    else if (!PREP.test(a.title) && !row.report) row.report = a;
    else row.other.push(a);
    rows.set(n, row);
  }
  return [...rows.values()]
    .sort((a, b) => a.n - b.n)
    .map((r) => ({ ...r, prepStep: step(r.prep), reportStep: step(r.report), approved: r.report?.state === "graded" && !/^(U|F|Fx)$/i.test(r.report.grade ?? "") }));
}
