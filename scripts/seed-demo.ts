/**
 * Seeds data/demo.sqlite: a baseline sync "two days ago", then a second sync with changes,
 * so the Radar shows a moved deadline, new files, a teacher comment and a lab sign-up.
 */
import { rmSync } from "node:fs";
process.env.KOMPASS_DEMO = "1";
const { createDb, defaultDbPath } = await import("../src/lib/db/index");
const { DemoProvider } = await import("../src/lib/providers/demo");
const { runSync } = await import("../src/lib/sync/engine");
const { runDetector } = await import("../src/lib/detect/run");
const { captureTask } = await import("../src/lib/tasks");

const file = defaultDbPath();
for (const ext of ["", "-wal", "-shm"]) rmSync(file + ext, { force: true });
const db = createDb(file);
const now = new Date();
const a = await runSync(db, new DemoProvider(0, now), { now: new Date(now.getTime() - 2 * 86_400_000) });
const b = await runSync(db, new DemoProvider(1, now), { now: new Date(now.getTime() - 20 * 60_000) });
const found = runDetector(db, now).added;
captureTask(db, "plugga gamla tentor mekanik imorgon 15:00 #plugg", now);
captureTask(db, "köp ny labbrock", now);
const { generateProposals } = await import("../src/lib/plan/store");
const { timeEntries } = await import("../src/lib/db/schema");
// Logged time on finished and open work, so "Your pace" and "time left" have something to show.
const log = (workKey: string, title: string, courseId: string, workType: string, daysAgo: number, minutes: number) => {
  const startedAt = new Date(now.getTime() - daysAgo * 86_400_000);
  db.insert(timeEntries).values({ workKey, title, courseId, workType, startedAt, endedAt: new Date(startedAt.getTime() + minutes * 60_000) }).run();
};
log("demo:assignment:a-em-lab2", "Lab 2: rapport (Induktion)", "demo:em", "lab_report", 11, 510);
log("demo:assignment:a-kv-lab3", "Lab 3: rapport (Franck–Hertz)", "demo:kvant", "lab_report", 1, 95);
generateProposals(db, now);
// Example notes: linked pages, a lab report from the template, and a project board.
const notes = await import("../src/lib/notes/store");
const addDays = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString().slice(0, 10);
notes.createDoc(db, { title: "Zeemaneffekten", content: `Uppsplittring av spektrallinjer i ett yttre magnetfält. Bygger på [[Väteatomen]].

> [!note] Normal Zeemaneffekt
> För $S = 0$ ges energiskiftet av
>
> $$
> \\Delta E = \\mu_B \\, m_l \\, B
> $$

## Inför Lab 4

- [x] Läs labb-PM
- [ ] Räkna förberedelseuppgift 1–3
- [ ] Anmäl till labbgrupp

| Storhet | Värde |
| --- | --- |
| $\\mu_B$ | $9{,}274 \\cdot 10^{-24}$ J/T |
| $g_s$ | $\\approx 2$ |

\`\`\`python
import numpy as np
B = np.linspace(0, 1.2, 50)   # tesla
dE = 9.274e-24 * B
\`\`\`
` }, now);
notes.createDoc(db, { title: "Väteatomen", content: "Radiella vågfunktioner $R_{nl}(r)$ och energinivåer $E_n = -13{,}6\\,\\text{eV}/n^2$.\n\nSe även [[Zeemaneffekten]] och [[Störningsräkning]]." }, now);
notes.createFromTemplate(db, "lab_report", "sv", { title: "Labbrapport: Franck–Hertz" }, now);
notes.createFromTemplate(db, "weekly_review", "sv", {}, now);
const projects = notes.createDatabase(db, "projects", "sv", now);
const row = (title: string, props: Record<string, unknown>, content = "") => notes.createDoc(db, { title, databaseId: projects.id, props, content }, now);
row("Antenndesign (EM-projekt)", { status: "Pågår", prio: "Hög", start: addDays(-6), due: addDays(9), course: "demo:em" }, "## Mål\n\nDimensionera en patchantenn för 2,4 GHz.\n\n- [x] Litteraturstudie\n- [ ] Simulering\n- [ ] Rapport");
row("Kompass (det här verktyget)", { status: "Pågår", prio: "Medel", start: addDays(-20), due: addDays(30), link: "https://github.com/" });
row("Väderstation med Raspberry Pi", { status: "Idé", prio: "Låg" });
row("Sommarjobbsansökningar", { status: "Väntar", prio: "Hög", start: addDays(3), due: addDays(18) });
row("Mekanik II: gamla tentor", { status: "Klart", prio: "Medel", start: addDays(-14), due: addDays(-2), course: "demo:mek2" });
// Phase 5: career pipeline, contacts, fairs, thesis plan, a project, degree courses and an exam registration.
const schema = await import("../src/lib/db/schema");
const career = await import("../src/lib/career/store");
const { parseLadok, isPass } = await import("../src/lib/degree/ladok");
const { createTask } = await import("../src/lib/tasks");
const { eq } = await import("drizzle-orm");
const labels = { apply: "Ansök", follow: "Följ upp" };
const app = (company: string, role: string, type: "summer" | "thesis" | "trainee", status: "interested" | "preparing" | "applied" | "interview" | "rejected", deadline: string | null, followUpAt: string | null = null) => {
  const a = db.insert(schema.applications).values({ company, role, type, status, deadline, followUpAt, createdAt: now, updatedAt: now }).returning().get();
  career.syncApplication(db, a.id, labels, now);
};
app("Ericsson", "Sommarjobb, radioalgoritmer", "summer", "preparing", addDays(12));
app("Saab", "Sommarjobb, signalbehandling", "summer", "interested", addDays(25));
app("ABB", "Exjobb, reglering av elnät", "thesis", "applied", addDays(-4), addDays(10));
app("Northvolt", "Sommarjobb, batterimodellering", "summer", "interview", addDays(-15));
app("Volvo Cars", "Graduate Program", "trainee", "rejected", addDays(-30));
db.insert(schema.contacts).values([
  { name: "Sara Holm", company: "Ericsson", title: "Rekryterare", email: "sara.holm@example.com", metAt: "Utnarm 2026", lastContacted: addDays(-120), nudgeDays: 90 },
  { name: "Jonas Berg", company: "ABB", title: "Utvecklingsingenjör, alumn från F", metAt: "Gästföreläsning i Reglerteknik", lastContacted: addDays(-20), nudgeDays: 60 },
  { name: "Lina Åkesson", company: "Saab", title: "Systemingenjör", metAt: "Utnarm 2026", lastContacted: null, nudgeDays: 90 },
]).run();
db.insert(schema.careerEvents).values([
  { title: "Utnarm, arbetsmarknadsmässa", kind: "fair", startDate: addDays(5), endDate: addDays(5), location: "Ångströmlaboratoriet" },
  { title: "Sommarjobbsansökningar öppnar (många företag)", kind: "window", startDate: addDays(18), endDate: addDays(60) },
]).run();
const plan = career.getExjobb(db, "sv");
career.saveExjobb(db, { ...plan, start: addDays(250), contact: "Studievägledare på institutionen", reviewer: "", steps: plan.steps.map((st) => (st.id === "area" ? { ...st, done: true } : st)) }, now);

const proj = db.insert(schema.projects).values({ title: "Väderstation med Raspberry Pi", goal: "Logga temperatur, tryck och luftfuktighet och visa dem på en egen sida.", status: "active", weeklyBudgetMin: 240, repoUrl: "https://github.com/", targetDate: addDays(45), createdAt: now }).returning().get();
db.insert(schema.milestones).values([
  { projectId: proj.id, title: "Sensorer inkopplade och avlästa", dueDate: addDays(-5), done: true },
  { projectId: proj.id, title: "Data sparas i SQLite", dueDate: addDays(9), done: false },
  { projectId: proj.id, title: "Webbsida med grafer", dueDate: addDays(30), done: false },
]).run();
const t1 = createTask(db, { title: "Löd fast BME280-sensorn", projectId: proj.id, source: "manual" }, now);
const t2 = createTask(db, { title: "Skriv loggningsskript", projectId: proj.id, source: "manual" }, now);
createTask(db, { title: "Välj grafbibliotek", projectId: proj.id, source: "manual" }, now);
db.update(schema.tasks).set({ status: "done", completedAt: now }).where(eq(schema.tasks.id, t1.id)).run();
db.update(schema.tasks).set({ status: "doing" }).where(eq(schema.tasks.id, t2.id)).run();
log(`project:${proj.id}`, proj.title, "", "project", 1, 80);
log(`task:${t1.id}`, t1.title, "", "project", 3, 45);

const ladok = parseLadok(["1MA013\tEnvariabelanalys\t10,0\t4\t2024-01-12", "1MA025\tLinjär algebra och geometri I\t5,0\t5\t2023-10-27", "1FA104\tMekanik I\t5,0\t4\t2024-03-15", "1TD433\tProgrammeringsteknik I\t5,0\tG\t2023-12-20", "1MA016\tFlervariabelanalys\t10,0\t3\t2024-06-03", "1FA102\tMekanik II\t5,0\tU\t2026-10-20"].join("\n"));
for (const r of ladok.rows) db.insert(schema.degreeCourses).values({ code: r.code, name: r.name, hp: r.hpTenths, grade: r.grade, date: r.date, status: isPass(r.grade) ? "done" : "ongoing", category: r.code.startsWith("1MA") ? "Matematik" : "Teknisk fysik", source: "ladok" }).run();
db.insert(schema.degreeCourses).values([
  { code: "1FA514", name: "Elektromagnetism", hp: 100, status: "ongoing", term: "HT2026", category: "Teknisk fysik", source: "manual" },
  { code: "1FA521", name: "Kvantfysik", hp: 100, status: "ongoing", term: "HT2026", category: "Teknisk fysik", source: "manual" },
  { code: "1FA352", name: "Kvantmekanik, fördjupning", hp: 100, status: "planned", term: "VT2027", category: "Profil", prereq: "1FA521", source: "manual" },
  { code: "1TD354", name: "Beräkningsvetenskap för PDE", hp: 50, status: "planned", term: "VT2027", category: "Profil", prereq: "1MA016", source: "manual" },
  { code: "1FA195", name: "Examensarbete", hp: 300, status: "planned", term: "VT2028", category: "Exjobb", source: "manual" },
]).run();
const exam = db.select().from(schema.items).all().find((i) => i.id === "demo:schedule_event:te-mek-tenta");
if (exam?.startAt) {
  const reg = new Date(exam.startAt.getTime() - 12 * 86_400_000).toISOString().slice(0, 10);
  const taskId = career.syncLinkedTask(db, { taskId: null, title: "Tentaanmälan: Mekanik II, Tentamen", due: reg, kind: "signup", url: "/degree?tab=exams", done: false }, now);
  db.insert(schema.exams).values({ sourceItemId: exam.id, title: exam.title, courseId: exam.courseId, examAt: exam.startAt, regDeadline: reg, registered: false, taskId }).run();
}
console.log(`Demo: ${found} hidden deadline(s) found, 2 example tasks added.`);
console.log(`Demo data seeded: ${a.stats.items} items, then +${b.stats.added} new, ${b.stats.updated} changed.`);
console.log("Start the demo with: npm run demo");
