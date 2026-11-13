import { describe, expect, it } from "vitest";
import { contactsDue, defaultExjobbSteps, exjobbDates } from "../src/lib/career/logic";
import { labSeries, type LabAssignment } from "../src/lib/courses/labs";
import { isPass, parseLadok } from "../src/lib/degree/ladok";
import { fmtHp, missingPrereqs, summarize, termOrder } from "../src/lib/degree/summary";

describe("Ladok paste", () => {
  it("reads tab-separated rows copied from a table", () => {
    const { rows, skipped } = parseLadok("Kurskod\tBenämning\tOmfattning\tBetyg\tDatum\n1FA102\tMekanik II\t5,0\t4\t2025-01-17\n1MA209\tFinancial Derivatives\t7.5\t5\t2025-06-03");
    expect(rows).toEqual([
      { code: "1FA102", name: "Mekanik II", hpTenths: 50, grade: "4", date: "2025-01-17" },
      { code: "1MA209", name: "Financial Derivatives", hpTenths: 75, grade: "5", date: "2025-06-03" },
    ]);
    expect(skipped).toBe(0);
  });

  it("reads free text the way Ladok's web page pastes, and semicolon CSV", () => {
    const { rows } = parseLadok("Kvantfysik F (10,0 hp) 1FA535 Betyg: 5 2026-01-12\nReglerteknik I 5,0 hp 1RT490 G 2025-10-30\n1TE626;Elektromagnetism II;5,0 hp;3;2025-03-20");
    expect(rows.map((r) => [r.code, r.name, r.hpTenths, r.grade, r.date])).toEqual([
      ["1FA535", "Kvantfysik F", 100, "5", "2026-01-12"],
      ["1RT490", "Reglerteknik I", 50, "G", "2025-10-30"],
      ["1TE626", "Elektromagnetism II", 50, "3", "2025-03-20"],
    ]);
  });

  it("skips module rows so credits are not counted twice, and keeps ungraded courses as ongoing", () => {
    const { rows, skipped } = parseLadok("Fasta tillståndets fysik F 10,0 hp 1TM013\n  Laborationer 2,0 hp G 2026-12-01\n  Skriftlig tentamen 8,0 hp\n\nHT2026 Signaler och system 1TE661 5,0 hp U 2026-10-22");
    expect(rows.map((r) => [r.code, r.hpTenths, r.grade])).toEqual([["1TM013", 100, null], ["1TE661", 50, "U"]]);
    expect(skipped).toBe(2);
    expect([isPass("5"), isPass("G"), isPass("U"), isPass(null)]).toEqual([true, true, false, false]);
  });

  it("keeps the last occurrence of a repeated course and ignores noise", () => {
    const { rows } = parseLadok("Resultat för Elis\n1FA102\tMekanik II\t5,0\tU\t2024-10-20\n1FA102\tMekanik II\t5,0\t4\t2025-01-17\nSumma: 5,0 hp");
    expect(rows).toEqual([{ code: "1FA102", name: "Mekanik II", hpTenths: 50, grade: "4", date: "2025-01-17" }]);
  });
});

describe("degree summary", () => {
  const c = (hp: number, status: "done" | "ongoing" | "planned", category = "", term = "") => ({ hp, status, category, term });
  it("adds credits exactly and reports what is still unplanned", () => {
    const s = summarize([c(75, "done", "Obligatorisk", "HT2025"), c(75, "done", "Obligatorisk", "VT2026"), c(100, "ongoing", "Profil", "HT2026"), c(50, "planned", "Profil", "VT2027"), c(300, "planned", "Exjobb", "VT2028")], 3000);
    expect([s.done, s.ongoing, s.planned, s.unplanned]).toEqual([150, 100, 350, 2400]);
    expect(s.byCategory.map((x) => x.category)).toEqual(["Exjobb", "Obligatorisk", "Profil"]);
    expect(s.byTerm.map((x) => x.term)).toEqual(["HT2025", "VT2026", "HT2026", "VT2027", "VT2028"]);
    expect(fmtHp(75, "sv")).toBe("7,5");
    expect(fmtHp(3000, "en")).toBe("300");
    expect(summarize([c(3100, "done")], 3000).unplanned).toBe(0);
  });

  it("orders terms within a year and flags missing prerequisites", () => {
    expect([termOrder("VT2027"), termOrder("ST2027"), termOrder("HT2027")].every((x, i, a) => i === 0 || a[i - 1] < x)).toBe(true);
    expect(termOrder("HT26")).toBe(termOrder("HT2026"));
    expect(missingPrereqs({ prereq: "1FA535, 1ma209 ; 1RT490" }, new Set(["1FA535"]))).toEqual(["1MA209", "1RT490"]);
    expect(missingPrereqs({ prereq: "" }, new Set())).toEqual([]);
  });
});

describe("lab series", () => {
  const a = (title: string, state: LabAssignment["state"], grade: string | null = null): LabAssignment => ({ title, state, grade, dueAt: null, url: null });
  it("groups preparation and report per lab and tracks approval", () => {
    const rows = labSeries([
      a("Lab 2: rapport (Induktion)", "graded", "G"), a("Pre-lab 1: Diffraction", "open"), a("Lab 1 report", "open"),
      a("Förberedelseuppgift laboration 2", "submitted"), a("Laboration 3", "missing"), a("Inlämningsuppgift 1", "open"), a("Lab 4: rapport", "graded", "U"),
    ]);
    expect(rows.map((r) => [r.n, r.prepStep, r.reportStep, r.approved])).toEqual([
      [1, "todo", "todo", false], [2, "submitted", "done", true], [3, null, "missing", false], [4, null, "done", false],
    ]);
    expect(rows[0].prep?.title).toBe("Pre-lab 1: Diffraction");
  });
  it("ignores courses without numbered labs", () => {
    expect(labSeries([a("Project", "open"), a("Collaboration essay", "open")])).toEqual([]);
  });
});

describe("contacts and exjobb timeline", () => {
  it("lists contacts that are due, never-contacted first, most overdue next", () => {
    const due = contactsDue([
      { id: 1, name: "Recent", lastContacted: "2026-10-20", nudgeDays: 90 },
      { id: 2, name: "Overdue", lastContacted: "2026-05-01", nudgeDays: 90 },
      { id: 3, name: "Never", lastContacted: null, nudgeDays: 90 },
      { id: 4, name: "Just due", lastContacted: "2026-10-14", nudgeDays: 30 },
    ], "2026-11-13");
    expect(due.map((c) => [c.name, c.dueSince])).toEqual([["Never", null], ["Overdue", "2026-07-30"], ["Just due", "2026-11-13"]]);
  });

  it("dates the thesis steps backwards from the start, and marks late ones", () => {
    const steps = defaultExjobbSteps("sv");
    expect(steps.at(-1)).toMatchObject({ id: "start", offset: 0 });
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    const dated = exjobbDates({ start: "2027-01-18", steps: [...steps].reverse() }, "2026-11-13");
    expect(dated.map((d) => d.offset)).toEqual([...dated.map((d) => d.offset)].sort((x, y) => x - y));
    expect(dated.find((d) => d.id === "search")).toMatchObject({ date: "2026-07-22", late: true });
    expect(dated.find((d) => d.id === "submit")).toMatchObject({ date: "2026-11-29", late: false });
    expect(dated.at(-1)).toMatchObject({ date: "2027-01-18", late: false });
    expect(exjobbDates({ start: null, steps }, "2026-11-13").every((d) => d.date === null && !d.late)).toBe(true);
    expect(exjobbDates({ start: "2027-01-18", steps: steps.map((s) => ({ ...s, done: true })) }, "2026-11-13").some((d) => d.late)).toBe(false);
  });
});

import { eq } from "drizzle-orm";
import { createDb } from "../src/lib/db/index";
import { applications, careerEvents, projects, tasks as tasksTable, timeEntries } from "../src/lib/db/schema";
import { careerAgenda, deleteApplication, getExjobb, saveExjobb, syncApplication, syncLinkedTask } from "../src/lib/career/store";
import { getDeadlines } from "../src/lib/queries";
import { getWeekLoads } from "../src/lib/plan/store";
import { projectLoadByDay, projectTime } from "../src/lib/projects/store";
import { createTask, getOpenTasks } from "../src/lib/tasks";

describe("linked tasks", () => {
  const now = new Date("2026-11-13T09:00:00Z");
  const labels = { apply: "Ansök", follow: "Följ upp" };
  const newApp = (db: ReturnType<typeof createDb>, extra: Partial<typeof applications.$inferInsert> = {}) =>
    db.insert(applications).values({ company: "Ericsson", role: "Sommarjobb", type: "summer", status: "interested", deadline: "2026-12-01", createdAt: now, updatedAt: now, ...extra }).returning().get();

  it("creates, updates, completes and removes the task that mirrors a date", () => {
    const db = createDb(":memory:");
    const id = syncLinkedTask(db, { taskId: null, title: "A", due: "2026-12-01", kind: "deadline", url: "/career/1", done: false }, now)!;
    expect(db.select().from(tasksTable).all()).toMatchObject([{ id, title: "A", status: "todo", hasTime: false, sourceUrl: "/career/1" }]);
    expect(syncLinkedTask(db, { taskId: id, title: "B", due: "2026-12-05", kind: "deadline", url: "/career/1", done: false }, now)).toBe(id);
    expect(db.select().from(tasksTable).get()?.dueAt?.toISOString()).toBe("2026-12-05T22:59:00.000Z");
    syncLinkedTask(db, { taskId: id, title: "B", due: "2026-12-05", kind: "deadline", url: "/career/1", done: true }, now);
    expect(db.select().from(tasksTable).get()?.status).toBe("done");
    syncLinkedTask(db, { taskId: id, title: "B", due: "2026-12-05", kind: "deadline", url: "/career/1", done: false }, now);
    expect(db.select().from(tasksTable).get()).toMatchObject({ status: "todo", completedAt: null });
    expect(syncLinkedTask(db, { taskId: id, title: "B", due: null, kind: "deadline", url: "/career/1", done: false }, now)).toBeNull();
    expect(db.select().from(tasksTable).all()).toEqual([]);
    expect(syncLinkedTask(db, { taskId: null, title: "C", due: "2026-12-01", kind: "deadline", url: "/x", done: true }, now)).toBeNull(); // nothing to remind about
  });

  it("puts an application's deadline and follow-up among my deadlines, and closes them as the status moves on", () => {
    const db = createDb(":memory:");
    const a = newApp(db, { followUpAt: "2026-12-10" });
    syncApplication(db, a.id, labels, now);
    const open = () => getDeadlines(db, now, new Date("2027-01-01T00:00:00Z"), now).filter((d) => d.state === "open").map((d) => d.title);
    expect(open()).toEqual(["Ansök: Ericsson, Sommarjobb", "Följ upp: Ericsson, Sommarjobb"]);

    db.update(applications).set({ status: "applied" }).where(eq(applications.id, a.id)).run();
    expect(syncApplication(db, a.id, labels, now)?.appliedAt).toBe("2026-11-13");
    expect(open()).toEqual(["Följ upp: Ericsson, Sommarjobb"]); // sending the application completes "apply"
    db.update(applications).set({ status: "rejected" }).where(eq(applications.id, a.id)).run();
    syncApplication(db, a.id, labels, now);
    expect(open()).toEqual([]);
    db.update(applications).set({ status: "preparing" }).where(eq(applications.id, a.id)).run();
    expect(syncApplication(db, a.id, labels, now)?.appliedAt).toBeNull();
    expect(open()).toHaveLength(2); // moved back: both reopen

    deleteApplication(db, a.id);
    expect(db.select().from(tasksTable).all()).toEqual([]);
  });

  it("gives every dated thesis step a task and keeps them in step with the plan", () => {
    const db = createDb(":memory:");
    const plan = getExjobb(db, "sv");
    expect(plan.start).toBeNull();
    saveExjobb(db, plan, now);
    expect(db.select().from(tasksTable).all()).toEqual([]); // no start date, no dates, no tasks
    saveExjobb(db, { ...getExjobb(db, "sv"), start: "2027-01-18" }, now);
    const all = db.select().from(tasksTable).all();
    expect(all).toHaveLength(plan.steps.length);
    expect(all.find((t) => t.title.includes("startar"))?.dueAt?.toISOString()).toBe("2027-01-18T22:59:00.000Z");
    const saved = getExjobb(db, "sv");
    saveExjobb(db, { ...saved, start: "2027-02-01", steps: saved.steps.map((s) => (s.id === "cv" ? { ...s, done: true } : s)) }, now);
    expect(db.select().from(tasksTable).all()).toHaveLength(plan.steps.length); // updated in place, not duplicated
    expect(getOpenTasks(db)).toHaveLength(plan.steps.length - 1);
    expect(db.select().from(tasksTable).all().find((t) => t.title.includes("startar"))?.dueAt?.toISOString()).toBe("2027-02-01T22:59:00.000Z");
  });

  it("shows career events on each of their days", () => {
    const db = createDb(":memory:");
    db.insert(careerEvents).values({ title: "Utnarm", kind: "fair", startDate: "2026-11-18", endDate: "2026-11-19", location: "Ångström" }).run();
    db.insert(careerEvents).values({ title: "Sommarjobb öppnar", kind: "window", startDate: "2026-12-01" }).run();
    const week = careerAgenda(db, new Date("2026-11-15T23:00:00Z"), new Date("2026-11-22T23:00:00Z"));
    expect(week.map((e) => [e.title, e.startAt.toISOString().slice(0, 10), e.allDay])).toEqual([["Utnarm", "2026-11-17", true], ["Utnarm", "2026-11-18", true]]);
  });
});

describe("projects", () => {
  const now = new Date("2026-11-11T09:00:00Z"); // Wednesday, week 46
  it("counts time on the project and on its tasks, and puts the weekly budget into the workload", () => {
    const db = createDb(":memory:");
    const p = db.insert(projects).values({ title: "Kompass", status: "active", weeklyBudgetMin: 300, createdAt: now }).returning().get();
    db.insert(projects).values({ title: "Vilande", status: "paused", weeklyBudgetMin: 600, createdAt: now }).run();
    const t = createTask(db, { title: "Bygg tavla", projectId: p.id, source: "manual" }, now);
    expect(t.status).toBe("todo"); // a project task is not inbox material
    const log = (workKey: string, start: string, minutes: number) => db.insert(timeEntries).values({ workKey, title: "x", workType: "project", startedAt: new Date(start), endedAt: new Date(new Date(start).getTime() + minutes * 60_000) }).run();
    log(`project:${p.id}`, "2026-11-10T10:00:00Z", 60); // this week
    log(`task:${t.id}`, "2026-11-09T10:00:00Z", 30); // this week
    log(`project:${p.id}`, "2026-11-02T10:00:00Z", 120); // last week
    expect(projectTime(db, p.id, now)).toMatchObject({ total: 210, thisWeek: 90 });

    const load = projectLoadByDay(db, now, ["2026-11-09", "2026-11-16"], [1, 2, 3, 4, 5]);
    // this week: 300 budget - 90 logged = 210 over Wed, Thu, Fri; next week: 300 over five days
    expect(load.get("2026-11-11")?.get(`project:${p.id}`)).toBe(70);
    expect(load.get("2026-11-10")).toBeUndefined();
    expect(load.get("2026-11-16")?.get(`project:${p.id}`)).toBe(60);
    expect([...load.values()].every((m) => m.size === 1)).toBe(true); // the paused project adds nothing

    const weeks = getWeekLoads(db, now, 2);
    expect(weeks.map((w) => Math.round(w.studyMin))).toEqual([210, 300]);
    expect(weeks[1].byCourse.get(`project:${p.id}`)).toBe(300);
  });
});
