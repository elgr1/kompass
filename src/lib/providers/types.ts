/**
 * The one interface every data source implements. The sync engine, Radar and views
 * only ever see this shape, so they do not care whether data came from the Canvas API,
 * an ICS feed, demo data, or (Phase 2) manual import.
 */

export type ItemKind =
  | "assignment"
  | "quiz"
  | "discussion"
  | "announcement"
  | "module"
  | "page"
  | "file"
  | "syllabus"
  | "calendar_event"
  | "schedule_event" // TimeEdit lecture / lab / exam
  | "group"
  | "appointment_group"
  | "planner_item"
  | "submission_comment";

export type CourseInput = {
  externalId: string;
  name: string;
  shortName: string;
  code: string | null;
  term: string | null;
  htmlUrl: string | null;
  teachers?: string[];
};

export type ItemInput = {
  kind: ItemKind;
  externalId: string;
  /** Course id within this provider, or a full `${provider}:${id}` to point at another provider's course. */
  courseRef?: string | null;
  title: string;
  htmlUrl: string | null;
  startAt?: Date | null;
  endAt?: Date | null;
  dueAt?: Date | null;
  allDay?: boolean;
  location?: string | null;
  bodyText?: string | null;
  /** Extra normalized fields that should be diffed (kept small and stable). */
  fields?: Record<string, unknown>;
  raw?: unknown;
};

export type ScopeResult = {
  /** Stable identity of "what was fetched", e.g. `course:123:assignments`. */
  key: string;
  /** ok = fetched completely; unavailable = feature off / forbidden for this course; error = try again later. */
  status: "ok" | "unavailable" | "error";
  error?: string;
  /**
   * all    = an item missing from the result was removed at the source.
   * future = only trust removals of items that start in the future (rolling-window feeds).
   * none   = never infer removals (windowed endpoints).
   */
  trackRemovals: "all" | "future" | "none";
  /** false = keep snapshots but do not emit Radar entries (duplicated views of other items). */
  radar?: boolean;
  items: ItemInput[];
};

export type ProviderResult = {
  /** When present, the full list of courses this provider knows about. */
  courses?: CourseInput[];
  scopes: ScopeResult[];
  requests?: number;
};

export type ProviderContext = {
  now: Date;
  /** Courses already known from any provider, for matching schedule events by course code. */
  knownCourses: { id: string; provider: string; code: string | null; name: string; shortName: string }[];
  /** User-confirmed links from a schedule's course name (normalized) to a course id. */
  aliases: Map<string, string>;
};

export interface SyncProvider {
  readonly id: string;
  readonly label: string;
  fetch(ctx: ProviderContext): Promise<ProviderResult>;
}
