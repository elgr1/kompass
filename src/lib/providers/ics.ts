import { parseIcs, type IcsEvent } from "../ics";
import type { CourseInput, ItemInput, ProviderContext, ProviderResult, ScopeResult, SyncProvider } from "./types";

/**
 * ICS subscription URLs contain a private key in the path/query, so they are treated
 * like credentials: only fetched from the expected host, never logged in full.
 */
async function fetchIcs(url: string, allowedHosts: Set<string>, fetchImpl: typeof fetch): Promise<IcsEvent[]> {
  const u = new URL(url.replace(/^webcal:/i, "https:"));
  if (u.protocol !== "https:" || !allowedHosts.has(u.host)) {
    throw new Error(`Refusing to fetch a calendar feed from ${u.host}`);
  }
  const res = await fetchImpl(u, { redirect: "manual", signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`Calendar feed answered HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("Response is not an iCalendar feed");
  return parseIcs(text);
}

const splitUrls = (v: string | undefined) =>
  (v ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

export const normalizeName = (s: string) => s.toLowerCase().replace(/[.\s]+$/g, "").replace(/\s+/g, " ").trim();

/** Matches a schedule entry to a known course by its course code, e.g. "1FA535". */
export function matchCourse(text: string, known: Pick<ProviderContext["knownCourses"][number], "id" | "code">[]): string | null {
  const hits = known.filter((c) => c.code && text.includes(c.code));
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * UU's TimeEdit feed writes the summary as "<student groups>, <Course name>.  , <Activity>",
 * e.g. "F3.A, F3.B1-2, Reglerteknik I.  , Laboration". The course is the part ending in a full stop.
 */
export function parseTimeEditSummary(summary: string): { course: string | null; activity: string | null; groups: string[] } {
  const parts = summary.split(/\s*,\s*/).map((p) => p.trim()).filter(Boolean);
  let idx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/\.$/.test(parts[i])) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return { course: null, activity: null, groups: [] };
  return {
    course: parts[idx].replace(/[.\s]+$/, ""),
    activity: parts.slice(idx + 1).join(", ") || null,
    groups: parts.slice(0, idx),
  };
}

const slug = (s: string) => normalizeName(s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** TimeEdit lectures, labs and exams from one or more "Prenumerera" links. */
export class TimeEditIcsProvider implements SyncProvider {
  readonly id = "timeedit";
  readonly label = "TimeEdit (ICS)";
  static readonly HOSTS = new Set(["cloud.timeedit.net"]);
  private readonly urls: string[];
  private readonly fetchImpl: typeof fetch;

  constructor(urls: string[], fetchImpl: typeof fetch = fetch) {
    this.urls = urls;
    this.fetchImpl = fetchImpl;
  }

  static fromEnv(): TimeEditIcsProvider | null {
    const urls = splitUrls(process.env.TIMEEDIT_ICS_URLS);
    return urls.length ? new TimeEditIcsProvider(urls) : null;
  }

  async fetch(ctx: ProviderContext): Promise<ProviderResult> {
    const scopes: ScopeResult[] = [];
    // Courses from other sources (Studium) that a schedule entry can be attached to.
    const others = ctx.knownCourses.filter((c) => c.provider !== this.id);
    const byName = new Map<string, string>();
    for (const c of others) for (const n of [c.shortName, c.name]) byName.set(normalizeName(n), c.id);
    /** Course names that match nothing yet: they become schedule-only courses the user can link later. */
    const own = new Map<string, CourseInput>();

    const resolve = (e: IcsEvent, courseName: string | null): string | null => {
      const byCode = matchCourse(`${e.summary}\n${e.description ?? ""}`, others);
      if (byCode) return byCode;
      if (!courseName) return null;
      const key = normalizeName(courseName);
      const linked = ctx.aliases.get(key) ?? byName.get(key);
      if (linked) return linked;
      const id = slug(courseName);
      own.set(id, { externalId: id, name: courseName, shortName: courseName, code: null, term: null, htmlUrl: null });
      return id;
    };

    for (const [i, url] of this.urls.entries()) {
      const key = `feed:${i}`;
      try {
        const events = await fetchIcs(url, TimeEditIcsProvider.HOSTS, this.fetchImpl);
        scopes.push({
          key,
          status: "ok",
          trackRemovals: "future", // the feed is a rolling window, so past events dropping out is not a removal
          items: events.map((e): ItemInput => {
            const s = parseTimeEditSummary(e.summary);
            return {
              kind: "schedule_event",
              externalId: e.uid,
              courseRef: resolve(e, s.course),
              title: s.course ? [s.course, s.activity].filter(Boolean).join(", ") : e.summary || "(schedule)",
              htmlUrl: e.url ?? "https://cloud.timeedit.net/uu/web/schema/",
              startAt: e.start,
              endAt: e.end,
              allDay: e.allDay,
              location: e.location?.replace(/^Plats:\s*/i, "") || null,
              bodyText: e.description,
              fields: { activity: s.activity },
              raw: e,
            };
          }),
        });
      } catch (err) {
        scopes.push({ key, status: "error", error: err instanceof Error ? err.message : String(err), trackRemovals: "future", items: [] });
      }
    }
    // Only replace the course list when every feed was read, so a failed feed cannot hide its courses.
    const complete = scopes.every((sc) => sc.status === "ok");
    return { ...(complete ? { courses: [...own.values()] } : {}), scopes, requests: this.urls.length };
  }
}

/**
 * Fallback for when no API token is available: Canvas's private calendar feed.
 * Covers assignment due dates and calendar events only.
 */
export class CanvasIcsProvider implements SyncProvider {
  readonly id = "canvas-ics";
  readonly label = "Studium (calendar feed)";
  static readonly HOSTS = new Set(["uppsala.instructure.com"]);
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;

  constructor(url: string, fetchImpl: typeof fetch = fetch) {
    this.url = url;
    this.fetchImpl = fetchImpl;
  }

  static fromEnv(): CanvasIcsProvider | null {
    const url = (process.env.CANVAS_ICS_URL ?? "").trim();
    return url ? new CanvasIcsProvider(url) : null;
  }

  async fetch(ctx: ProviderContext): Promise<ProviderResult> {
    try {
      const events = await fetchIcs(this.url, CanvasIcsProvider.HOSTS, this.fetchImpl);
      const items = events.map((e): ItemInput => {
        const isAssignment = e.uid.startsWith("event-assignment-");
        const courseRef = matchCourse(`${e.summary}\n${e.description ?? ""}`, ctx.knownCourses);
        return {
          kind: isAssignment ? "assignment" : "calendar_event",
          externalId: e.uid,
          courseRef,
          title: e.summary.replace(/\s*\[[^\]]+\]\s*$/, "") || "(untitled)", // Canvas appends "[course code]"
          htmlUrl: e.url,
          ...(isAssignment ? { dueAt: e.start } : { startAt: e.start, endAt: e.end, allDay: e.allDay }),
          location: e.location,
          bodyText: e.description,
          raw: e,
        };
      });
      return { scopes: [{ key: "feed", status: "ok", trackRemovals: "future", items }], requests: 1 };
    } catch (err) {
      return {
        scopes: [{ key: "feed", status: "error", error: err instanceof Error ? err.message : String(err), trackRemovals: "future", items: [] }],
        requests: 1,
      };
    }
  }
}
