"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getDb, isDemo as isDemoDb } from "@/lib/db";
import { applications, careerEvents, contacts, degreeCourses, exams, milestones, projects, APPLICATION_STATUSES, APPLICATION_TYPES, type ApplicationStatus, type ApplicationType } from "@/lib/db/schema";
import { defaultExjobbSteps } from "@/lib/career/logic";
import { deleteApplication, getExjobb, saveExjobb, syncApplication, syncLinkedTask } from "@/lib/career/store";
import { isPass, parseLadok } from "@/lib/degree/ladok";
import { backupDatabase, dataDir, exportAll } from "@/lib/backup";
import { llmEnabled } from "@/lib/llm/extract";
import { acknowledgeFeedback, buildRetrospective } from "@/lib/stats/store";
import { runLlm } from "@/lib/llm/run";
import { getProject, projectKey } from "@/lib/projects/store";
import { dateKey } from "@/lib/time";
import { databases, docLinks, docs, type FilterOp, type PropDef, type PropType, type ViewDef, type ViewType } from "@/lib/db/schema";
import { coerce, newId } from "@/lib/notes/dbview";
import { toggleTask } from "@/lib/notes/markdown";
import { createDatabase, createDoc, createFromTemplate, deleteDoc, getDatabase, getDoc, renderDoc, saveDoc } from "@/lib/notes/store";
import { search, type SearchHit } from "@/lib/search";
import { blocks, changes, courseAliases, courses, examPlans, items, suggestions, tasks, timeEntries, workMeta, type TaskKind } from "@/lib/db/schema";
import { isWorkType } from "@/lib/plan/estimate";
import { atMinutes } from "@/lib/plan/schedule";
import { collectWork, createExamPlan, generateProposals, getPlanSettings, savePlanSettings } from "@/lib/plan/store";
import { dueFromMention } from "@/lib/detect/extract";
import { importText } from "@/lib/detect/run";
import { t } from "@/lib/i18n";
import { getChannels } from "@/lib/notify/channels";
import { deliver } from "@/lib/notify/run";
import { getPrefs } from "@/lib/prefs";
import { getFeedToken, setSetting } from "@/lib/settings";
import { captureTask, createTask, setTaskDone } from "@/lib/tasks";
import { isDateKey } from "@/lib/time";
import { normalizeName } from "@/lib/providers/ics";
import { syncAll } from "@/lib/sync/run";

const YEAR = 60 * 60 * 24 * 365;
const refresh = () => revalidatePath("/", "layout");

/** The only thing "Sync now" does is read from the configured sources. */
export async function syncNowAction() {
  await syncAll();
  refresh();
}

export async function setReadAction(id: number, read: boolean) {
  getDb().update(changes).set({ readAt: read ? new Date() : null, snoozedUntil: null }).where(eq(changes.id, id)).run();
  refresh();
}

export async function markAllReadAction() {
  getDb().update(changes).set({ readAt: new Date() }).where(isNull(changes.readAt)).run();
  refresh();
}

export async function snoozeAction(id: number, days: number) {
  const until = new Date(Date.now() + Math.min(Math.max(days, 1), 30) * 86_400_000);
  getDb().update(changes).set({ snoozedUntil: until }).where(eq(changes.id, id)).run();
  refresh();
}

export async function setTriageAction(id: number, triage: "action" | "fyi") {
  getDb().update(changes).set({ triage }).where(eq(changes.id, id)).run();
  refresh();
}

export async function toggleLangAction() {
  const jar = await cookies();
  const next = jar.get("kompass_lang")?.value === "en" ? "sv" : "en";
  jar.set("kompass_lang", next, { maxAge: YEAR, sameSite: "lax", path: "/" });
  setSetting(getDb(), "lang", next); // notifications are sent without a browser, so they read the language from here
  refresh();
}

export async function setThemeAction(theme: "light" | "dark") {
  (await cookies()).set("kompass_theme", theme, { maxAge: YEAR, sameSite: "lax", path: "/" });
  refresh();
}

/** "This schedule course is that Studium course." Remembered for all future syncs. */
export async function linkCourseAction(fromId: string, formData: FormData) {
  const to = String(formData.get("to") ?? "");
  const db = getDb();
  const from = db.select().from(courses).where(eq(courses.id, fromId)).get();
  const target = db.select().from(courses).where(and(eq(courses.id, to), eq(courses.active, true))).get();
  if (!from || !target || from.id === target.id) return;
  db.transaction((tx) => {
    const alias = { alias: normalizeName(from.name), label: from.name, courseId: target.id };
    tx.insert(courseAliases).values(alias).onConflictDoUpdate({ target: courseAliases.alias, set: alias }).run();
    tx.update(items).set({ courseId: target.id }).where(eq(items.courseId, from.id)).run();
    tx.update(changes).set({ courseId: target.id }).where(eq(changes.courseId, from.id)).run();
    tx.update(courses).set({ active: false }).where(eq(courses.id, from.id)).run();
  });
  refresh();
}

const KINDS: TaskKind[] = ["task", "signup", "booking", "exam", "deadline"];
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/* ---- Tasks ---- */

export async function captureAction(formData: FormData) {
  captureTask(getDb(), str(formData, "text"));
  refresh();
}

export async function toggleTaskAction(id: number, done: boolean) {
  setTaskDone(getDb(), id, done);
  refresh();
}

export async function updateTaskAction(id: number, formData: FormData) {
  const db = getDb();
  const prev = db.select().from(tasks).where(eq(tasks.id, id)).get();
  const title = str(formData, "title");
  if (!prev || !title) return;
  const date = str(formData, "date");
  const time = str(formData, "time");
  const due = isDateKey(date) ? dueFromMention({ date, time: /^\d{2}:\d{2}$/.test(time) ? time : null, precision: "day" }) : null;
  const courseId = str(formData, "course") || null;
  const kind = KINDS.includes(str(formData, "kind") as TaskKind) ? (str(formData, "kind") as TaskKind) : prev.kind;
  const tags = [...new Set(str(formData, "tags").split(/[\s,#]+/).map((x) => x.toLowerCase()).filter(Boolean))];
  db.update(tasks)
    .set({
      title, notes: str(formData, "notes") || null, dueAt: due?.dueAt ?? null, hasTime: due?.hasTime ?? false, courseId, kind, tags,
      status: prev.status === "done" || prev.status === "doing" ? prev.status : due || courseId || prev.projectId ? "todo" : "inbox",
    })
    .where(eq(tasks.id, id))
    .run();
  refresh();
}

export async function deleteTaskAction(id: number) {
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(tasks).where(eq(tasks.id, id)).run();
    tx.update(changes).set({ taskId: null }).where(eq(changes.taskId, String(id))).run();
  });
  refresh();
}

/* ---- Hidden-deadline suggestions: the only way a detected date becomes a task ---- */

export async function acceptSuggestionAction(id: number) {
  const db = getDb();
  const { lang } = await getPrefs();
  const s = db.select().from(suggestions).where(eq(suggestions.id, id)).get();
  if (!s || s.status !== "pending") return;
  db.transaction((tx) => {
    const task = createTask(tx as unknown as typeof db, {
      title: `${t(lang, `tkind.${s.kind}`)}: ${s.title}`, dueAt: s.dueAt, hasTime: s.hasTime, courseId: s.courseId, kind: s.kind,
      source: "suggestion", sourceItemId: s.itemId, sourceUrl: s.sourceUrl, sourceQuote: s.quote,
    });
    tx.update(suggestions).set({ status: "accepted", taskId: task.id }).where(eq(suggestions.id, id)).run();
  });
  refresh();
}

export async function dismissSuggestionAction(id: number) {
  getDb().update(suggestions).set({ status: "dismissed" }).where(and(eq(suggestions.id, id), eq(suggestions.status, "pending"))).run();
  refresh();
}

export async function importTextAction(formData: FormData) {
  const text = str(formData, "text");
  if (text) importText(getDb(), text.slice(0, 200_000), str(formData, "title") || "Inklistrad text", str(formData, "course") || null);
  refresh();
}

export async function radarToTaskAction(changeId: number) {
  const db = getDb();
  const c = db.select().from(changes).where(eq(changes.id, changeId)).get();
  if (!c || c.taskId) return;
  const item = db.select().from(items).where(eq(items.id, c.itemId)).get();
  const due = item?.dueAt ?? item?.startAt ?? null;
  db.transaction((tx) => {
    const task = createTask(tx as unknown as typeof db, {
      title: c.title, dueAt: due && due > new Date() ? due : null, hasTime: true, courseId: c.courseId,
      kind: c.kind === "appointment_group" ? "booking" : "task", source: "radar", sourceItemId: c.itemId, sourceUrl: c.htmlUrl,
    });
    tx.update(changes).set({ taskId: String(task.id), readAt: new Date() }).where(eq(changes.id, changeId)).run();
  });
  refresh();
}

/* ---- Settings ---- */

export async function setCourseAction(id: string, formData: FormData) {
  const hidden = formData.get("hidden");
  const set: { hidden?: boolean; nicknames?: string } = {};
  if (hidden === "1" || hidden === "0") set.hidden = hidden === "1";
  if (formData.has("nicknames")) set.nicknames = str(formData, "nicknames").slice(0, 200);
  if (Object.keys(set).length) getDb().update(courses).set(set).where(eq(courses.id, id)).run();
  refresh();
}

export async function testNotificationAction() {
  const { lang } = await getPrefs();
  await deliver(getChannels(), { title: lang === "sv" ? "Testnotis" : "Test notification", body: lang === "sv" ? "Så här ser en påminnelse från Kompass ut." : "This is what a Kompass reminder looks like." });
}

export async function regenerateFeedAction() {
  getFeedToken(getDb(), true);
  refresh();
}

/* ---- Planning ---- */

const hhmm = (v: string): number | null => {
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  return m && +m[1] <= 23 && +m[2] <= 59 ? +m[1] * 60 + +m[2] : null;
};

export async function proposeBlocksAction() {
  generateProposals(getDb(), new Date());
  refresh();
}

export async function acceptBlockAction(id: number) {
  getDb().update(blocks).set({ status: "accepted" }).where(eq(blocks.id, id)).run();
  refresh();
}

export async function acceptAllBlocksAction() {
  getDb().update(blocks).set({ status: "accepted" }).where(eq(blocks.status, "proposed")).run();
  refresh();
}

export async function removeBlockAction(id: number) {
  getDb().delete(blocks).where(eq(blocks.id, id)).run();
  refresh();
}

export async function clearProposalsAction() {
  getDb().delete(blocks).where(eq(blocks.status, "proposed")).run();
  refresh();
}

/** Moves a block to another day/time, keeping its length. Moving a proposal also accepts it. */
export async function moveBlockAction(id: number, formData: FormData) {
  const db = getDb();
  const b = db.select().from(blocks).where(eq(blocks.id, id)).get();
  const date = str(formData, "date");
  const start = hhmm(str(formData, "start"));
  if (!b || !isDateKey(date) || start === null) return;
  const startAt = atMinutes(date, start);
  db.update(blocks).set({ startAt, endAt: new Date(startAt.getTime() + (b.endAt.getTime() - b.startAt.getTime())), status: "accepted" }).where(eq(blocks.id, id)).run();
  refresh();
}

export async function addBlockAction(formData: FormData) {
  const title = str(formData, "title");
  const date = str(formData, "date");
  const from = hhmm(str(formData, "from"));
  const to = hhmm(str(formData, "to"));
  if (!title || !isDateKey(date) || from === null || to === null || to <= from) return;
  getDb().insert(blocks).values({
    title, kind: str(formData, "kind") === "busy" ? "busy" : "study", courseId: str(formData, "course") || null,
    startAt: atMinutes(date, from), endAt: atMinutes(date, to), status: "accepted", source: "manual", createdAt: new Date(),
  }).run();
  refresh();
}

export async function setEstimateAction(key: string, formData: FormData) {
  const hours = Number(str(formData, "hours").replace(",", "."));
  const type = str(formData, "type");
  const row = {
    key,
    estimateMin: Number.isFinite(hours) && hours > 0 ? Math.min(Math.round(hours * 60), 6000) : null,
    workType: isWorkType(type) ? type : null,
  };
  getDb().insert(workMeta).values(row).onConflictDoUpdate({ target: workMeta.key, set: row }).run();
  refresh();
}

function stopRunning(db: ReturnType<typeof getDb>, now: Date) {
  db.update(timeEntries).set({ endedAt: now }).where(isNull(timeEntries.endedAt)).run();
  // An accidental start-stop is not study time.
  for (const e of db.select().from(timeEntries).all()) {
    if (e.endedAt && e.endedAt.getTime() - e.startedAt.getTime() < 60_000) db.delete(timeEntries).where(eq(timeEntries.id, e.id)).run();
  }
}

export async function startTimerAction(formData: FormData) {
  const db = getDb();
  const now = new Date();
  const key = str(formData, "key");
  const work = key ? collectWork(db, now).find((w) => w.key === key) : undefined;
  const project = key.startsWith("project:") ? getProject(db, Number(key.slice(8))) : null;
  const target = Number(str(formData, "target"));
  const { lang } = await getPrefs();
  stopRunning(db, now);
  db.insert(timeEntries).values({
    workKey: work?.key ?? (project ? projectKey(project.id) : null),
    title: work?.title ?? project?.title ?? (str(formData, "title") || t(lang, "timer.free")), courseId: work?.course?.id ?? (str(formData, "course") || null),
    workType: work?.type ?? (project ? "project" : "other"), startedAt: now, targetMin: Number.isFinite(target) && target > 0 ? Math.min(target, 240) : null,
  }).run();
  refresh();
}

export async function stopTimerAction() {
  stopRunning(getDb(), new Date());
  refresh();
}

export async function logTimeAction(formData: FormData) {
  const db = getDb();
  const now = new Date();
  const minutes = Math.round(Number(str(formData, "minutes")));
  const work = collectWork(db, now).find((w) => w.key === str(formData, "key"));
  if (!work || !Number.isFinite(minutes) || minutes < 1 || minutes > 1440) return;
  db.insert(timeEntries).values({ workKey: work.key, title: work.title, courseId: work.course?.id ?? null, workType: work.type, startedAt: new Date(now.getTime() - minutes * 60_000), endedAt: now }).run();
  refresh();
}

export async function deleteEntryAction(id: number) {
  getDb().delete(timeEntries).where(eq(timeEntries.id, id)).run();
  refresh();
}

export async function createExamPlanAction(formData: FormData) {
  const { lang } = await getPrefs();
  const title = str(formData, "title");
  const date = str(formData, "date");
  const time = hhmm(str(formData, "time") || "08:00") ?? 480;
  if (!title || !isDateKey(date)) return;
  createExamPlan(getDb(), {
    title, courseId: str(formData, "course") || null, examAt: atMinutes(date, time),
    topics: str(formData, "topics").split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 40),
    oldExams: Math.max(0, Math.min(20, Math.round(Number(str(formData, "oldExams")) || 0))),
    bufferDays: Math.max(0, Math.min(7, Math.round(Number(str(formData, "bufferDays")) || 0))),
  }, { review: t(lang, "exam.l.review"), oldExam: t(lang, "exam.l.oldExam"), repeat: t(lang, "exam.l.repeat"), buffer: t(lang, "exam.l.buffer") }, new Date());
  refresh();
}

export async function deleteExamPlanAction(id: number) {
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(blocks).where(eq(blocks.planId, id)).run();
    tx.delete(examPlans).where(eq(examPlans.id, id)).run();
  });
  refresh();
}

export async function savePlanSettingsAction(formData: FormData) {
  const db = getDb();
  const cur = getPlanSettings(db);
  const days = [1, 2, 3, 4, 5, 6, 7].filter((d) => formData.get(`day${d}`) === "on");
  const num = (k: string, lo: number, hi: number, fallback: number) => {
    const n = Number(str(formData, k).replace(",", "."));
    return Number.isFinite(n) && n >= lo && n <= hi ? n : fallback;
  };
  const dayStart = hhmm(str(formData, "dayStart")) ?? cur.dayStart;
  const dayEnd = hhmm(str(formData, "dayEnd")) ?? cur.dayEnd;
  savePlanSettings(db, {
    ...cur,
    dayStart, dayEnd: dayEnd > dayStart ? dayEnd : cur.dayEnd,
    lunchStart: hhmm(str(formData, "lunchStart")) ?? cur.lunchStart, lunchEnd: hhmm(str(formData, "lunchEnd")) ?? cur.lunchEnd,
    days: days.length ? days : cur.days,
    maxPerDay: Math.round(num("maxHours", 0.5, 14, cur.maxPerDay / 60) * 60),
    blockMin: Math.round(num("blockMin", 25, 240, cur.blockMin)),
  });
  refresh();
}

/* ---- Notes: pages ---- */

export async function createPageAction(formData: FormData) {
  const { lang } = await getPrefs();
  const parent = Number(str(formData, "parentId"));
  const doc = createFromTemplate(getDb(), str(formData, "template") || "blank", lang, { title: str(formData, "title"), parentId: Number.isInteger(parent) && parent > 0 ? parent : null });
  redirect(`/notes/${doc.id}?edit=1`);
}

/** Called by the editor while typing. Returns the rendered page so the preview is exactly what the saved page will show. */
export async function saveDocAction(id: number, title: string, content: string): Promise<{ ok: boolean; html: string }> {
  const db = getDb();
  const { lang } = await getPrefs();
  const doc = saveDoc(db, id, { title: title.slice(0, 300), content: content.slice(0, 500_000) });
  return { ok: doc !== null, html: doc ? renderDoc(db, doc.content, lang) : "" };
}

export async function toggleDocTaskAction(id: number, index: number) {
  const db = getDb();
  const doc = getDoc(db, id);
  if (!doc) return;
  saveDoc(db, id, { content: toggleTask(doc.content, index) });
  revalidatePath(`/notes/${id}`);
}

export async function deleteDocAction(id: number) {
  const db = getDb();
  const doc = getDoc(db, id);
  if (!doc) return;
  deleteDoc(db, id);
  redirect(doc.databaseId ? `/db/${doc.databaseId}` : doc.parentId ? `/notes/${doc.parentId}` : "/notes");
}

/* ---- Notes: databases ---- */

const PROP_TYPES: PropType[] = ["text", "number", "select", "date", "checkbox", "url", "course"];
const VIEW_TYPES: ViewType[] = ["table", "board", "calendar", "timeline", "gallery"];
const OPS: FilterOp[] = ["is", "is_not", "contains", "empty", "not_empty", "before", "after"];
const options = (v: string) => [...new Set(v.split(",").map((x) => x.trim()).filter(Boolean))].slice(0, 40);

function patchDatabase(id: number, fn: (d: { props: PropDef[]; views: ViewDef[]; title: string }) => void) {
  const db = getDb();
  const d = getDatabase(db, id);
  if (!d) return;
  const next = { title: d.title, props: structuredClone(d.props), views: structuredClone(d.views) };
  fn(next);
  db.update(databases).set(next).where(eq(databases.id, id)).run();
  revalidatePath(`/db/${id}`);
}

export async function createDatabaseAction(formData: FormData) {
  const { lang } = await getPrefs();
  const d = createDatabase(getDb(), str(formData, "template") || "blank", lang);
  redirect(`/db/${d.id}`);
}

export async function renameDatabaseAction(id: number, formData: FormData) {
  const title = str(formData, "title");
  if (title) patchDatabase(id, (d) => { d.title = title.slice(0, 200); });
  refresh();
}

export async function deleteDatabaseAction(id: number) {
  const db = getDb();
  db.transaction((tx) => {
    const rows = tx.select({ id: docs.id }).from(docs).where(eq(docs.databaseId, id)).all().map((r) => r.id);
    for (const rid of rows) {
      tx.delete(docLinks).where(eq(docLinks.fromId, rid)).run();
      tx.delete(docLinks).where(eq(docLinks.toId, rid)).run();
    }
    tx.delete(docs).where(eq(docs.databaseId, id)).run();
    tx.delete(databases).where(eq(databases.id, id)).run();
  });
  setSetting(db, "search_dirty", "1");
  redirect("/notes");
}

export async function addRowAction(databaseId: number, formData: FormData) {
  const db = getDb();
  const d = getDatabase(db, databaseId);
  const title = str(formData, "title");
  if (!d || !title) return;
  // A row added from a board column or a calendar day starts with that value.
  const props: Record<string, unknown> = {};
  const def = d.props.find((p) => p.id === str(formData, "presetProp"));
  if (def) props[def.id] = coerce(def, str(formData, "presetValue"));
  createDoc(db, { title, databaseId, props });
  revalidatePath(`/db/${databaseId}`);
}

export async function setRowPropAction(rowId: number, propId: string, value: string) {
  const db = getDb();
  const row = getDoc(db, rowId);
  const d = row?.databaseId ? getDatabase(db, row.databaseId) : null;
  const def = d?.props.find((p) => p.id === propId);
  if (!row || !d || !def) return;
  db.update(docs).set({ props: { ...row.props, [propId]: coerce(def, value) }, updatedAt: new Date() }).where(eq(docs.id, rowId)).run();
  revalidatePath(`/db/${d.id}`);
  revalidatePath(`/notes/${rowId}`);
}

export async function addPropAction(databaseId: number, formData: FormData) {
  const name = str(formData, "name");
  const type = str(formData, "type") as PropType;
  if (!name || !PROP_TYPES.includes(type)) return;
  patchDatabase(databaseId, (d) => { d.props.push({ id: newId(), name: name.slice(0, 60), type, ...(type === "select" ? { options: options(str(formData, "options")) } : {}) }); });
}

export async function updatePropAction(databaseId: number, propId: string, formData: FormData) {
  patchDatabase(databaseId, (d) => {
    const p = d.props.find((x) => x.id === propId);
    if (!p) return;
    p.name = str(formData, "name").slice(0, 60) || p.name;
    if (p.type === "select") p.options = options(str(formData, "options"));
  });
}

export async function deletePropAction(databaseId: number, propId: string) {
  patchDatabase(databaseId, (d) => {
    d.props = d.props.filter((p) => p.id !== propId);
    for (const v of d.views) {
      for (const k of ["groupBy", "dateProp", "endProp", "sortBy"] as const) if (v[k] === propId) v[k] = null;
      v.filters = (v.filters ?? []).filter((f) => f.prop !== propId);
    }
  });
}

export async function addViewAction(databaseId: number, formData: FormData) {
  const { lang } = await getPrefs();
  const type = str(formData, "type") as ViewType;
  if (!VIEW_TYPES.includes(type)) return;
  const id = newId();
  patchDatabase(databaseId, (d) => {
    d.views.push({
      id, name: t(lang, `db.view.${type}`), type,
      groupBy: d.props.find((p) => p.type === "select")?.id ?? null,
      dateProp: d.props.find((p) => p.type === "date")?.id ?? null,
      endProp: d.props.filter((p) => p.type === "date")[1]?.id ?? null,
    });
  });
  redirect(`/db/${databaseId}?view=${id}`);
}

export async function saveViewAction(databaseId: number, viewId: string, formData: FormData) {
  patchDatabase(databaseId, (d) => {
    const v = d.views.find((x) => x.id === viewId);
    if (!v) return;
    const ids = new Set(d.props.map((p) => p.id));
    const ref = (k: string, extra: string[] = []) => { const x = str(formData, k); return ids.has(x) || extra.includes(x) ? x : null; };
    const type = str(formData, "type") as ViewType;
    v.name = str(formData, "name").slice(0, 60) || v.name;
    if (VIEW_TYPES.includes(type)) v.type = type;
    v.groupBy = ref("groupBy");
    v.dateProp = ref("dateProp");
    v.endProp = ref("endProp");
    v.sortBy = ref("sortBy", ["title", "updated"]);
    v.sortDir = str(formData, "sortDir") === "desc" ? "desc" : "asc";
    v.filters = [0, 1, 2].flatMap((i) => {
      const prop = ref(`f${i}prop`, ["title"]);
      const op = str(formData, `f${i}op`) as FilterOp;
      return prop && OPS.includes(op) ? [{ prop, op, value: str(formData, `f${i}value`).slice(0, 200) }] : [];
    });
  });
}

export async function deleteViewAction(databaseId: number, viewId: string) {
  patchDatabase(databaseId, (d) => { if (d.views.length > 1) d.views = d.views.filter((v) => v.id !== viewId); });
  redirect(`/db/${databaseId}`);
}

/** Live results for the command palette. */
export async function searchAction(q: string): Promise<SearchHit[]> {
  return q.trim().length < 2 ? [] : search(getDb(), q.slice(0, 200), 8);
}

export async function moveRowAction(propId: string, rowId: number, value: string) {
  await setRowPropAction(rowId, propId, value);
}

/* ---- Career ---- */

const dateOrNull = (v: string) => (isDateKey(v) ? v : null);
const urlOrNull = (v: string) => (v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : null);
async function appLabels() {
  const { lang } = await getPrefs();
  return { apply: t(lang, "career.task.apply"), follow: t(lang, "career.task.follow") };
}

export async function addApplicationAction(formData: FormData) {
  const company = str(formData, "title");
  if (!company) return;
  const status = str(formData, "presetValue") as ApplicationStatus;
  const type = str(formData, "type") as ApplicationType;
  const now = new Date();
  const db = getDb();
  const a = db.insert(applications).values({
    company: company.slice(0, 200), role: str(formData, "role").slice(0, 200), type: APPLICATION_TYPES.includes(type) ? type : "summer",
    status: APPLICATION_STATUSES.includes(status) ? status : "interested", deadline: dateOrNull(str(formData, "deadline")), createdAt: now, updatedAt: now,
  }).returning().get();
  syncApplication(db, a.id, await appLabels(), now);
  refresh();
}

export async function moveApplicationAction(id: number, status: string) {
  if (!APPLICATION_STATUSES.includes(status as ApplicationStatus)) return;
  const db = getDb();
  db.update(applications).set({ status: status as ApplicationStatus, updatedAt: new Date() }).where(eq(applications.id, id)).run();
  syncApplication(db, id, await appLabels());
  refresh();
}

export async function updateApplicationAction(id: number, formData: FormData) {
  const db = getDb();
  const company = str(formData, "company");
  const status = str(formData, "status") as ApplicationStatus;
  const type = str(formData, "type") as ApplicationType;
  if (!company) return;
  db.update(applications).set({
    company: company.slice(0, 200), role: str(formData, "role").slice(0, 200),
    ...(APPLICATION_STATUSES.includes(status) ? { status } : {}), ...(APPLICATION_TYPES.includes(type) ? { type } : {}),
    deadline: dateOrNull(str(formData, "deadline")), followUpAt: dateOrNull(str(formData, "followUpAt")), url: urlOrNull(str(formData, "url")),
    cvVersion: str(formData, "cvVersion").slice(0, 200) || null, letterVersion: str(formData, "letterVersion").slice(0, 200) || null, updatedAt: new Date(),
  }).where(eq(applications.id, id)).run();
  syncApplication(db, id, await appLabels());
  refresh();
}

export async function deleteApplicationAction(id: number) {
  deleteApplication(getDb(), id);
  redirect("/career");
}

/** Opens the application's notes page, creating it from the Application template the first time. */
export async function applicationNotesAction(id: number) {
  const db = getDb();
  const { lang } = await getPrefs();
  const a = db.select().from(applications).where(eq(applications.id, id)).get();
  if (!a) return;
  let docId = a.docId && getDoc(db, a.docId) ? a.docId : null;
  if (!docId) {
    docId = createFromTemplate(db, "application", lang, { title: `${t(lang, "career.app")}: ${[a.company, a.role].filter(Boolean).join(", ")}` }).id;
    db.update(applications).set({ docId }).where(eq(applications.id, id)).run();
    redirect(`/notes/${docId}?edit=1`);
  }
  redirect(`/notes/${docId}`);
}

export async function saveContactAction(id: number | null, formData: FormData) {
  const name = str(formData, "name");
  if (!name) return;
  const nudge = Number(str(formData, "nudgeDays"));
  const values = {
    name: name.slice(0, 200), company: str(formData, "company").slice(0, 200), title: str(formData, "title").slice(0, 200), email: str(formData, "email").slice(0, 200) || null,
    link: urlOrNull(str(formData, "link")), metAt: str(formData, "metAt").slice(0, 200), lastContacted: dateOrNull(str(formData, "lastContacted")),
    nudgeDays: Number.isFinite(nudge) && nudge >= 1 && nudge <= 3650 ? Math.round(nudge) : 90, notes: str(formData, "notes").slice(0, 5000),
  };
  if (id) getDb().update(contacts).set(values).where(eq(contacts.id, id)).run();
  else getDb().insert(contacts).values(values).run();
  refresh();
}

export async function touchContactAction(id: number) {
  getDb().update(contacts).set({ lastContacted: dateKey(new Date()) }).where(eq(contacts.id, id)).run();
  refresh();
}

export async function deleteContactAction(id: number) {
  getDb().delete(contacts).where(eq(contacts.id, id)).run();
  refresh();
}

export async function addCareerEventAction(formData: FormData) {
  const title = str(formData, "title");
  const startDate = dateOrNull(str(formData, "startDate"));
  const kind = str(formData, "kind");
  if (!title || !startDate) return;
  getDb().insert(careerEvents).values({
    title: title.slice(0, 200), kind: kind === "fair" || kind === "window" ? kind : "other", startDate, endDate: dateOrNull(str(formData, "endDate")),
    location: str(formData, "location").slice(0, 200) || null, url: urlOrNull(str(formData, "url")),
  }).run();
  refresh();
}

export async function deleteCareerEventAction(id: number) {
  getDb().delete(careerEvents).where(eq(careerEvents.id, id)).run();
  refresh();
}

export async function saveExjobbAction(formData: FormData) {
  const db = getDb();
  const { lang } = await getPrefs();
  const plan = getExjobb(db, lang);
  const steps = plan.steps
    .filter((s) => formData.get(`del_${s.id}`) !== "on")
    .map((s) => {
      const offset = Number(str(formData, `offset_${s.id}`));
      return { ...s, title: str(formData, `title_${s.id}`).slice(0, 300) || s.title, offset: Number.isFinite(offset) ? Math.round(Math.max(-2000, Math.min(400, offset))) : s.offset, done: formData.get(`done_${s.id}`) === "on" };
    });
  // a removed step takes its task with it
  for (const s of plan.steps) if (formData.get(`del_${s.id}`) === "on") syncLinkedTask(db, { taskId: s.taskId, title: s.title, due: null, kind: "task", url: "/career?tab=exjobb", done: false });
  const newTitle = str(formData, "newTitle");
  const newOffset = Number(str(formData, "newOffset"));
  if (newTitle) steps.push({ id: newId(), title: newTitle.slice(0, 300), offset: Number.isFinite(newOffset) ? Math.round(newOffset) : -30, done: false });
  saveExjobb(db, { start: dateOrNull(str(formData, "start")), contact: str(formData, "contact").slice(0, 300), reviewer: str(formData, "reviewer").slice(0, 300), notes: str(formData, "notes").slice(0, 5000), steps });
  refresh();
}

export async function resetExjobbStepsAction() {
  const db = getDb();
  const { lang } = await getPrefs();
  const plan = getExjobb(db, lang);
  for (const s of plan.steps) syncLinkedTask(db, { taskId: s.taskId, title: s.title, due: null, kind: "task", url: "/career?tab=exjobb", done: false });
  saveExjobb(db, { ...plan, steps: defaultExjobbSteps(lang) });
  refresh();
}

/* ---- Projects ---- */

const PROJECT_STATUSES = ["idea", "active", "paused", "done"] as const;

export async function createProjectAction(formData: FormData) {
  const title = str(formData, "title");
  if (!title) return;
  const p = getDb().insert(projects).values({ title: title.slice(0, 200), status: "active", createdAt: new Date() }).returning().get();
  redirect(`/projects/${p.id}`);
}

export async function updateProjectAction(id: number, formData: FormData) {
  const title = str(formData, "title");
  const status = str(formData, "status") as (typeof PROJECT_STATUSES)[number];
  const hours = Number(str(formData, "budgetHours").replace(",", "."));
  if (!title) return;
  getDb().update(projects).set({
    title: title.slice(0, 200), goal: str(formData, "goal").slice(0, 5000), ...(PROJECT_STATUSES.includes(status) ? { status } : {}),
    weeklyBudgetMin: Number.isFinite(hours) && hours >= 0 && hours <= 80 ? Math.round(hours * 60) : 0,
    repoUrl: urlOrNull(str(formData, "repoUrl")), docsUrl: urlOrNull(str(formData, "docsUrl")), targetDate: dateOrNull(str(formData, "targetDate")),
  }).where(eq(projects.id, id)).run();
  refresh();
}

export async function deleteProjectAction(id: number) {
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(milestones).where(eq(milestones.projectId, id)).run();
    tx.update(tasks).set({ projectId: null }).where(eq(tasks.projectId, id)).run(); // tasks survive as ordinary tasks
    tx.delete(projects).where(eq(projects.id, id)).run();
  });
  redirect("/projects");
}

export async function projectNotesAction(id: number) {
  const db = getDb();
  const { lang } = await getPrefs();
  const p = getProject(db, id);
  if (!p) return;
  let docId = p.docId && getDoc(db, p.docId) ? p.docId : null;
  if (!docId) {
    docId = createFromTemplate(db, "project", lang, { title: `${t(lang, "proj.one")}: ${p.title}` }).id;
    db.update(projects).set({ docId }).where(eq(projects.id, id)).run();
    redirect(`/notes/${docId}?edit=1`);
  }
  redirect(`/notes/${docId}`);
}

export async function addMilestoneAction(projectId: number, formData: FormData) {
  const title = str(formData, "title");
  if (title) getDb().insert(milestones).values({ projectId, title: title.slice(0, 200), dueDate: dateOrNull(str(formData, "dueDate")) }).run();
  refresh();
}

export async function toggleMilestoneAction(id: number, done: boolean) {
  getDb().update(milestones).set({ done }).where(eq(milestones.id, id)).run();
  refresh();
}

export async function deleteMilestoneAction(id: number) {
  getDb().delete(milestones).where(eq(milestones.id, id)).run();
  refresh();
}

export async function addProjectTaskAction(projectId: number, formData: FormData) {
  const title = str(formData, "title");
  if (!title) return;
  const db = getDb();
  const task = createTask(db, { title: title.slice(0, 300), projectId, source: "manual" });
  const stage = str(formData, "presetValue");
  if (stage === "doing") db.update(tasks).set({ status: "doing" }).where(eq(tasks.id, task.id)).run();
  else if (stage === "done") setTaskDone(db, task.id, true);
  refresh();
}

export async function moveProjectTaskAction(taskId: number, stage: string) {
  const db = getDb();
  if (stage === "done") setTaskDone(db, taskId, true);
  else if (stage === "doing" || stage === "todo") db.update(tasks).set({ status: stage, completedAt: null }).where(eq(tasks.id, taskId)).run();
  refresh();
}

/* ---- Degree and exams ---- */

const DEGREE_STATUSES = ["done", "ongoing", "planned"] as const;
const hpTenths = (v: string) => { const n = Number(v.replace(",", ".")); return Number.isFinite(n) && n >= 0 && n <= 300 ? Math.round(n * 10) : 0; };

/** Imports pasted Ladok results. Existing courses are matched on course code and updated, never duplicated. */
export async function importLadokAction(formData: FormData) {
  const db = getDb();
  const { rows, skipped } = parseLadok(str(formData, "text").slice(0, 200_000));
  let added = 0;
  let updated = 0;
  db.transaction((tx) => {
    for (const r of rows) {
      const status = isPass(r.grade) ? ("done" as const) : ("ongoing" as const);
      const prev = tx.select().from(degreeCourses).where(eq(degreeCourses.code, r.code)).get();
      if (prev) {
        tx.update(degreeCourses).set({ name: r.name, hp: r.hpTenths, grade: r.grade, date: r.date, status }).where(eq(degreeCourses.id, prev.id)).run();
        updated++;
      } else {
        tx.insert(degreeCourses).values({ code: r.code, name: r.name, hp: r.hpTenths, grade: r.grade, date: r.date, status, source: "ladok" }).run();
        added++;
      }
    }
  });
  setSetting(db, "ladok_last", JSON.stringify({ added, updated, skipped, at: Date.now() }));
  refresh();
}

export async function saveDegreeCourseAction(id: number | null, formData: FormData) {
  const name = str(formData, "name");
  const status = str(formData, "status") as (typeof DEGREE_STATUSES)[number];
  if (!name) return;
  const values = {
    code: str(formData, "code").toUpperCase().slice(0, 12) || null, name: name.slice(0, 200), hp: hpTenths(str(formData, "hp")), grade: str(formData, "grade").slice(0, 4) || null,
    status: DEGREE_STATUSES.includes(status) ? status : ("planned" as const), term: str(formData, "term").toUpperCase().replace(/\s/g, "").slice(0, 8) || null,
    category: str(formData, "category").slice(0, 60), prereq: str(formData, "prereq").toUpperCase().slice(0, 200),
  };
  if (id) getDb().update(degreeCourses).set(values).where(eq(degreeCourses.id, id)).run();
  else getDb().insert(degreeCourses).values({ ...values, source: "manual" }).run();
  refresh();
}

export async function deleteDegreeCourseAction(id: number) {
  getDb().delete(degreeCourses).where(eq(degreeCourses.id, id)).run();
  refresh();
}

export async function addStudiumCourseAction(courseId: string) {
  const db = getDb();
  const c = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!c || (c.code && db.select().from(degreeCourses).where(eq(degreeCourses.code, c.code)).get())) return;
  db.insert(degreeCourses).values({ code: c.code, name: c.shortName, hp: 0, status: "ongoing", term: c.term, source: "studium" }).run();
  refresh();
}

export async function setDegreeTargetAction(formData: FormData) {
  const n = Number(str(formData, "target").replace(",", "."));
  if (Number.isFinite(n) && n > 0 && n <= 600) setSetting(getDb(), "degree_target", String(Math.round(n * 10)));
  refresh();
}

/** Saves what I know about an exam; an open registration deadline becomes a sign-up task with escalating reminders. */
export async function saveExamAction(formData: FormData) {
  const db = getDb();
  const { lang } = await getPrefs();
  const title = str(formData, "title");
  const date = str(formData, "date");
  const minutes = hhmm(str(formData, "time") || "08:00") ?? 480;
  if (!title || !isDateKey(date)) return;
  const sourceItemId = str(formData, "sourceItemId") || null;
  const id = Number(str(formData, "id"));
  const prev = id ? db.select().from(exams).where(eq(exams.id, id)).get() : sourceItemId ? db.select().from(exams).where(eq(exams.sourceItemId, sourceItemId)).get() : undefined;
  const registered = formData.get("registered") === "on";
  const regDeadline = dateOrNull(str(formData, "regDeadline"));
  const taskId = syncLinkedTask(db, { taskId: prev?.taskId, title: `${t(lang, "exam.task")}: ${title}`, due: regDeadline, kind: "signup", url: "/degree?tab=exams", done: registered });
  const values = {
    title: title.slice(0, 200), courseId: str(formData, "course") || null, examAt: atMinutes(date, minutes), regDeadline, registered,
    retake: formData.get("retake") === "on", result: str(formData, "result").slice(0, 20) || null, taskId,
  };
  if (prev) db.update(exams).set(values).where(eq(exams.id, prev.id)).run();
  else db.insert(exams).values({ ...values, sourceItemId }).run();
  refresh();
}

export async function deleteExamAction(id: number) {
  const db = getDb();
  const e = db.select().from(exams).where(eq(exams.id, id)).get();
  if (!e) return;
  syncLinkedTask(db, { taskId: e.taskId, title: e.title, due: null, kind: "signup", url: "/degree?tab=exams", done: false });
  db.delete(exams).where(eq(exams.id, id)).run();
  refresh();
}

/* ---- Optional AI extraction ---- */

/** Sends only the texts the user ticked on the preview page. Refuses unless explicitly enabled in .env. */
export async function runLlmAction(formData: FormData) {
  if (!llmEnabled()) return;
  const ids = formData.getAll("id").map(String).slice(0, 30);
  if (ids.length) await runLlm(getDb(), ids, new Date());
  redirect("/found");
}

/* ---- Backup and export ---- */

export async function backupNowAction() {
  await backupDatabase(getDb(), `${dataDir()}/${isDemoDb() ? "backups-demo" : "backups"}`);
  refresh();
}

export async function exportAllAction() {
  exportAll(getDb(), `${dataDir()}/${isDemoDb() ? "exports-demo" : "exports"}`);
  refresh();
}

/* ---- Feedback inbox and retrospective ---- */

export async function acknowledgeFeedbackAction(itemId: string) {
  acknowledgeFeedback(getDb(), itemId);
  refresh();
}

export async function createRetrospectiveAction(formData: FormData) {
  const from = str(formData, "from");
  const to = str(formData, "to");
  if (!isDateKey(from) || !isDateKey(to) || to < from) return;
  const db = getDb();
  const { lang } = await getPrefs();
  const r = buildRetrospective(db, from, to, lang, new Date());
  const doc = createDoc(db, { title: r.title, content: r.content });
  redirect(`/notes/${doc.id}`);
}
