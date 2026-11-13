import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Storage model
 * - `items`      one row per mirrored thing (assignment, announcement, file, lecture, ...)
 *                holding the latest normalized state + raw payload.
 * - `snapshots`  append-only history: a row every time an item's content hash changes.
 * - `changes`    the Radar: one row per detected add / update / removal, with field diffs.
 * - `scopes`     what was fetched (e.g. "course:123:assignments"); drives baseline and
 *                removal detection, and records per-scope errors.
 * - `sync_runs`  one row per provider run; drives the "stale since" banner.
 */

export const courses = sqliteTable("courses", {
  id: text("id").primaryKey(), // `${provider}:${externalId}`
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  code: text("code"),
  term: text("term"),
  htmlUrl: text("html_url"),
  color: text("color").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  /** User setting: hide a finished course from every view (it is still synced). */
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  /** User setting: comma-separated short names for quick capture, e.g. "regler, rt". */
  nicknames: text("nicknames").notNull().default(""),
  /** Teacher names from Studium, for the course page. */
  teachers: text("teachers", { mode: "json" }).$type<string[]>(),
  firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
});

export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(), // `${provider}:${kind}:${externalId}`
    provider: text("provider").notNull(),
    kind: text("kind").notNull(),
    externalId: text("external_id").notNull(),
    scope: text("scope").notNull(),
    courseId: text("course_id"),
    title: text("title").notNull(),
    htmlUrl: text("html_url"),
    startAt: integer("start_at", { mode: "timestamp_ms" }),
    endAt: integer("end_at", { mode: "timestamp_ms" }),
    dueAt: integer("due_at", { mode: "timestamp_ms" }),
    allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
    location: text("location"),
    bodyText: text("body_text"),
    fields: text("fields", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    comparable: text("comparable", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    raw: text("raw", { mode: "json" }).$type<unknown>(),
    hash: text("hash").notNull(),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
    changedAt: integer("changed_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("items_scope_idx").on(t.scope),
    index("items_kind_idx").on(t.kind),
    index("items_course_idx").on(t.courseId),
    index("items_due_idx").on(t.dueAt),
    index("items_start_idx").on(t.startAt),
  ],
);

export const snapshots = sqliteTable(
  "snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: text("item_id").notNull(),
    syncRunId: integer("sync_run_id").notNull(),
    capturedAt: integer("captured_at", { mode: "timestamp_ms" }).notNull(),
    hash: text("hash").notNull(),
    comparable: text("comparable", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    raw: text("raw", { mode: "json" }).$type<unknown>(),
  },
  (t) => [index("snapshots_item_idx").on(t.itemId)],
);

export type FieldDiff = { field: string; before: unknown; after: unknown };

export const changes = sqliteTable(
  "changes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: text("item_id").notNull(),
    courseId: text("course_id"),
    provider: text("provider").notNull(),
    kind: text("kind").notNull(),
    type: text("type").$type<"added" | "updated" | "removed">().notNull(),
    title: text("title").notNull(),
    htmlUrl: text("html_url"),
    diffs: text("diffs", { mode: "json" }).$type<FieldDiff[]>().notNull(),
    triage: text("triage").$type<"action" | "fyi">().notNull(),
    detectedAt: integer("detected_at", { mode: "timestamp_ms" }).notNull(),
    syncRunId: integer("sync_run_id").notNull(),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    snoozedUntil: integer("snoozed_until", { mode: "timestamp_ms" }),
    taskId: text("task_id"),
  },
  (t) => [index("changes_detected_idx").on(t.detectedAt), index("changes_item_idx").on(t.itemId)],
);

export const scopes = sqliteTable("scopes", {
  key: text("key").primaryKey(), // `${provider}|${scopeKey}`
  provider: text("provider").notNull(),
  baselineAt: integer("baseline_at", { mode: "timestamp_ms" }),
  lastOkAt: integer("last_ok_at", { mode: "timestamp_ms" }),
  lastStatus: text("last_status").$type<"ok" | "unavailable" | "error">().notNull(),
  lastError: text("last_error"),
  itemCount: integer("item_count").notNull().default(0),
});

export type SyncStats = {
  scopesOk: number;
  scopesUnavailable: number;
  scopesError: number;
  items: number;
  added: number;
  updated: number;
  removed: number;
  requests?: number;
};

export const syncRuns = sqliteTable("sync_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  status: text("status").$type<"running" | "ok" | "partial" | "error">().notNull(),
  error: text("error"),
  stats: text("stats", { mode: "json" }).$type<SyncStats>(),
});

/** "This TimeEdit course name is that Studium course", confirmed by the user on the Sync page. */
export const courseAliases = sqliteTable("course_aliases", {
  alias: text("alias").primaryKey(), // normalized name
  label: text("label").notNull(),
  courseId: text("course_id").notNull(),
});

export type TaskKind = "task" | "signup" | "booking" | "exam" | "deadline";

export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    notes: text("notes"),
    /** Date-only tasks are stored at 23:59 Stockholm time with hasTime = false. */
    dueAt: integer("due_at", { mode: "timestamp_ms" }),
    hasTime: integer("has_time", { mode: "boolean" }).notNull().default(false),
    courseId: text("course_id"),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
    kind: text("kind").$type<TaskKind>().notNull().default("task"),
    /** inbox = captured but not yet given a date or course */
    /** doing = picked up on a project board; treated as open everywhere else */
    status: text("status").$type<"inbox" | "todo" | "doing" | "done">().notNull(),
    projectId: integer("project_id"),
    source: text("source").$type<"manual" | "capture" | "radar" | "suggestion">().notNull(),
    sourceItemId: text("source_item_id"),
    sourceUrl: text("source_url"),
    sourceQuote: text("source_quote"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("tasks_due_idx").on(t.dueAt), index("tasks_status_idx").on(t.status)],
);

/** Dates found in text by the hidden-deadline detector. Never become tasks without a click. */
export const suggestions = sqliteTable(
  "suggestions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** hash of source + date + kind: the same finding is never suggested twice, even after dismissal */
    key: text("key").notNull().unique(),
    itemId: text("item_id"),
    courseId: text("course_id"),
    kind: text("kind").$type<TaskKind>().notNull(),
    title: text("title").notNull(),
    quote: text("quote").notNull(),
    dueAt: integer("due_at", { mode: "timestamp_ms" }).notNull(),
    hasTime: integer("has_time", { mode: "boolean" }).notNull(),
    precision: text("precision").$type<"day" | "week">().notNull(),
    confidence: integer("confidence").notNull(), // 0-100
    sourceUrl: text("source_url"),
    sourceLabel: text("source_label").notNull(),
    status: text("status").$type<"pending" | "accepted" | "dismissed">().notNull(),
    taskId: integer("task_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("suggestions_status_idx").on(t.status)],
);

/** One row per notification already delivered, so nothing is sent twice. */
export const sentNotifications = sqliteTable("sent_notifications", {
  key: text("key").primaryKey(),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull(),
  title: text("title").notNull(),
  ok: integer("ok", { mode: "boolean" }).notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * Planning data hangs off a "work key": `task:<id>` for my own tasks, or the item id
 * (e.g. `canvas:assignment:123`) for Studium deadlines. That way estimates, time logs and
 * study blocks work the same for both.
 */
export const workMeta = sqliteTable("work_meta", {
  key: text("key").primaryKey(),
  /** my own estimate in minutes; null = use the default for the work type */
  estimateMin: integer("estimate_min"),
  workType: text("work_type"),
});

export const blocks = sqliteTable(
  "blocks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workKey: text("work_key"),
    title: text("title").notNull(),
    courseId: text("course_id"),
    /** study = planned work; busy = time I am not available (work shift, training...) */
    kind: text("kind").$type<"study" | "busy">().notNull(),
    startAt: integer("start_at", { mode: "timestamp_ms" }).notNull(),
    endAt: integer("end_at", { mode: "timestamp_ms" }).notNull(),
    /** proposed blocks are suggestions until accepted */
    status: text("status").$type<"proposed" | "accepted">().notNull(),
    source: text("source").$type<"auto" | "manual" | "exam">().notNull(),
    planId: integer("plan_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("blocks_start_idx").on(t.startAt)],
);

export const timeEntries = sqliteTable(
  "time_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workKey: text("work_key"),
    title: text("title").notNull(),
    courseId: text("course_id"),
    workType: text("work_type").notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    /** null while the timer is running */
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    /** focus length in minutes when started as a pomodoro */
    targetMin: integer("target_min"),
  },
  (t) => [index("time_work_idx").on(t.workKey)],
);

export const examPlans = sqliteTable("exam_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  courseId: text("course_id"),
  examAt: integer("exam_at", { mode: "timestamp_ms" }).notNull(),
  topics: text("topics", { mode: "json" }).$type<string[]>().notNull(),
  oldExams: integer("old_exams").notNull(),
  bufferDays: integer("buffer_days").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/* ---- Projects, career, degree (Phase 5). Plain dates are YYYY-MM-DD strings in Stockholm time. ---- */

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  goal: text("goal").notNull().default(""),
  status: text("status").$type<"idea" | "active" | "paused" | "done">().notNull(),
  /** time I intend to spend per week; counted as load in the workload view while the project is active */
  weeklyBudgetMin: integer("weekly_budget_min").notNull().default(0),
  repoUrl: text("repo_url"),
  docsUrl: text("docs_url"),
  targetDate: text("target_date"),
  docId: integer("doc_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const milestones = sqliteTable("milestones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull(),
  title: text("title").notNull(),
  dueDate: text("due_date"),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
});

export const APPLICATION_STATUSES = ["interested", "preparing", "applied", "interview", "offer", "rejected"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export const APPLICATION_TYPES = ["summer", "internship", "trainee", "thesis", "parttime", "other"] as const;
export type ApplicationType = (typeof APPLICATION_TYPES)[number];

export const applications = sqliteTable("applications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  company: text("company").notNull(),
  role: text("role").notNull().default(""),
  type: text("type").$type<ApplicationType>().notNull(),
  status: text("status").$type<ApplicationStatus>().notNull(),
  deadline: text("deadline"),
  url: text("url"),
  cvVersion: text("cv_version"),
  letterVersion: text("letter_version"),
  followUpAt: text("follow_up_at"),
  appliedAt: text("applied_at"),
  /** notes page (interview prep etc.) */
  docId: integer("doc_id"),
  /** tasks that carry the deadline and the follow-up into Today, reminders and the calendar */
  taskId: integer("task_id"),
  followTaskId: integer("follow_task_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const contacts = sqliteTable("contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  company: text("company").notNull().default(""),
  title: text("title").notNull().default(""),
  email: text("email"),
  link: text("link"),
  /** where we met, e.g. a career fair */
  metAt: text("met_at").notNull().default(""),
  lastContacted: text("last_contacted"),
  /** suggest getting in touch again after this many days */
  nudgeDays: integer("nudge_days").notNull().default(90),
  notes: text("notes").notNull().default(""),
});

export const careerEvents = sqliteTable("career_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  kind: text("kind").$type<"fair" | "window" | "other">().notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  location: text("location"),
  url: text("url"),
});

export const degreeCourses = sqliteTable("degree_courses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code"),
  name: text("name").notNull(),
  hp: integer("hp_tenths").notNull(), // credits x 10, so 7.5 hp is exact
  grade: text("grade"),
  date: text("date"),
  status: text("status").$type<"done" | "ongoing" | "planned">().notNull(),
  term: text("term"),
  category: text("category").notNull().default(""),
  /** course codes this course requires, comma separated */
  prereq: text("prereq").notNull().default(""),
  source: text("source").$type<"ladok" | "manual" | "studium">().notNull(),
});

export const exams = sqliteTable("exams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** the TimeEdit entry this row annotates, if any */
  sourceItemId: text("source_item_id").unique(),
  title: text("title").notNull(),
  courseId: text("course_id"),
  examAt: integer("exam_at", { mode: "timestamp_ms" }).notNull(),
  regDeadline: text("reg_deadline"),
  registered: integer("registered", { mode: "boolean" }).notNull().default(false),
  retake: integer("retake", { mode: "boolean" }).notNull().default(false),
  result: text("result"),
  taskId: integer("task_id"),
});

export type Project = typeof projects.$inferSelect;
export type Milestone = typeof milestones.$inferSelect;
export type Application = typeof applications.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type CareerEvent = typeof careerEvents.$inferSelect;
export type DegreeCourse = typeof degreeCourses.$inferSelect;
export type Exam = typeof exams.$inferSelect;

/** Text read out of a mirrored PDF, so kurs-PM and lab instructions are searchable and scanned for deadlines. */
export const fileTexts = sqliteTable("file_texts", {
  itemId: text("item_id").primaryKey(),
  /** size + modified date of the version that was read; a different value means the file was replaced */
  version: text("version").notNull(),
  text: text("text").notNull(),
  pages: integer("pages").notNull().default(0),
  /** why reading failed (too large, not a PDF, scanned images...); such files are not retried until they change */
  error: text("error"),
  extractedAt: integer("extracted_at", { mode: "timestamp_ms" }).notNull(),
});

/** Mirrored material I have opened from inside the app. */
export const opened = sqliteTable("opened", {
  itemId: text("item_id").primaryKey(),
  openedAt: integer("opened_at", { mode: "timestamp_ms" }).notNull(),
});

/* ---- Notes workspace ---- */

export type PropType = "text" | "number" | "select" | "date" | "checkbox" | "url" | "course";
export type PropDef = { id: string; name: string; type: PropType; options?: string[] };
export type ViewType = "table" | "board" | "calendar" | "timeline" | "gallery";
export type FilterOp = "is" | "is_not" | "contains" | "empty" | "not_empty" | "before" | "after";
export type ViewDef = {
  id: string;
  name: string;
  type: ViewType;
  /** select property that makes the board columns / table groups */
  groupBy?: string | null;
  /** date properties used by calendar and timeline */
  dateProp?: string | null;
  endProp?: string | null;
  sortBy?: string | null; // property id, or "title" / "updated"
  sortDir?: "asc" | "desc";
  filters?: { prop: string; op: FilterOp; value?: string }[];
};

/** A page. When `databaseId` is set, the page is also a row in that database and `props` holds its values. */
export const docs = sqliteTable(
  "docs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    /** Markdown with a few extensions: - [ ] tasks, > [!note] callouts, $math$, [[links]] */
    content: text("content").notNull().default(""),
    parentId: integer("parent_id"),
    databaseId: integer("database_id"),
    props: text("props", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    courseId: text("course_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("docs_db_idx").on(t.databaseId), index("docs_parent_idx").on(t.parentId)],
);

/** Resolved [[wiki links]], kept for backlinks. Rebuilt whenever a page is saved. */
export const docLinks = sqliteTable(
  "doc_links",
  { fromId: integer("from_id").notNull(), toId: integer("to_id").notNull() },
  (t) => [index("doc_links_to_idx").on(t.toId), index("doc_links_from_idx").on(t.fromId)],
);

export const databases = sqliteTable("databases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  props: text("props", { mode: "json" }).$type<PropDef[]>().notNull(),
  views: text("views", { mode: "json" }).$type<ViewDef[]>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export type Doc = typeof docs.$inferSelect;
export type Database = typeof databases.$inferSelect;
export type Block = typeof blocks.$inferSelect;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type ExamPlan = typeof examPlans.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Suggestion = typeof suggestions.$inferSelect;
export type Course = typeof courses.$inferSelect;
export type Item = typeof items.$inferSelect;
export type Change = typeof changes.$inferSelect;
export type SyncRun = typeof syncRuns.$inferSelect;
export type ScopeRow = typeof scopes.$inferSelect;
