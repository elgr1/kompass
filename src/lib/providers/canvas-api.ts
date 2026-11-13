import { CanvasClient, CanvasError } from "../canvas/client";
import { htmlToText } from "../text";
import type { CourseInput, ItemInput, ProviderContext, ProviderResult, ScopeResult, SyncProvider } from "./types";

/* Canvas payloads are large; only the fields we read are typed. */
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const COURSE_CODE = /\b\d[A-Z]{2}\d{3}\b/;
const date = (v: unknown): Date | null => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const courseFromContext = (code: unknown): string | null =>
  typeof code === "string" && code.startsWith("course_") ? code.slice("course_".length) : null;

/** "Kvantfysik F 1FA535 13046 HT2026" -> "Kvantfysik F" */
export function shortCourseName(name: string): string {
  const s = name.replace(/\s+\d[A-Z]{2}\d{3}\b.*$/, "").trim();
  return s || name;
}

export function normalizeCourse(c: Any, baseUrl: string): CourseInput {
  const name: string = c.name ?? c.course_code ?? `Course ${c.id}`;
  const code = `${c.course_code ?? ""} ${name}`.match(COURSE_CODE)?.[0] ?? null;
  return {
    externalId: String(c.id),
    name,
    shortName: shortCourseName(name),
    code,
    term: c.term?.name ?? null,
    htmlUrl: `${baseUrl}/courses/${c.id}`,
    teachers: Array.isArray(c.teachers) ? c.teachers.map((t: Any) => String(t.display_name ?? "")).filter(Boolean) : [],
  };
}

export function normalizeAssignment(a: Any, courseId: string): ItemInput {
  const s: Any | undefined = a.submission;
  return {
    kind: "assignment",
    externalId: String(a.id),
    courseRef: courseId,
    title: a.name ?? "(untitled)",
    htmlUrl: a.html_url ?? null,
    dueAt: date(a.due_at), // for a student this already includes any override that applies to me
    bodyText: htmlToText(a.description),
    fields: {
      unlock_at: a.unlock_at ?? null,
      lock_at: a.lock_at ?? null,
      points_possible: a.points_possible ?? null,
      submission_types: Array.isArray(a.submission_types) ? a.submission_types.join(", ") : null,
      is_quiz: Boolean(a.quiz_id ?? a.is_quiz_assignment),
      submission_state: s?.workflow_state ?? null, // unsubmitted | submitted | graded | pending_review
      submitted_at: s?.submitted_at ?? null,
      grade: s?.grade ?? null,
      score: s?.score ?? null,
      late: s?.late ?? null,
      missing: s?.missing ?? null,
      excused: s?.excused ?? null,
    },
    raw: a,
  };
}

export function normalizeAnnouncement(a: Any): ItemInput {
  return {
    kind: "announcement",
    externalId: String(a.id),
    courseRef: courseFromContext(a.context_code),
    title: a.title ?? "(untitled)",
    htmlUrl: a.html_url ?? null,
    bodyText: htmlToText(a.message),
    fields: { posted_at: a.posted_at ?? a.delayed_post_at ?? null, author: a.author?.display_name ?? a.user_name ?? null },
    raw: a,
  };
}

const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function pool<T>(inputs: T[], size: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, inputs.length) }, async () => {
      while (i < inputs.length) await fn(inputs[i++]);
    }),
  );
}

export class CanvasApiProvider implements SyncProvider {
  readonly id = "canvas";
  readonly label = "Studium (Canvas API)";
  private readonly client: CanvasClient;

  constructor(client: CanvasClient) {
    this.client = client;
  }

  static fromEnv(): CanvasApiProvider | null {
    const token = (process.env.CANVAS_TOKEN ?? "").trim();
    if (!token) return null;
    const baseUrl = (process.env.CANVAS_BASE_URL ?? "https://uppsala.instructure.com").trim();
    return new CanvasApiProvider(new CanvasClient({ baseUrl, token }));
  }

  /** Runs one fetch and turns any failure into a scope status instead of failing the whole sync. */
  private async scope(
    key: string,
    opts: Pick<ScopeResult, "trackRemovals" | "radar">,
    fn: () => Promise<ItemInput[]>,
  ): Promise<ScopeResult> {
    try {
      return { key, status: "ok", items: await fn(), ...opts };
    } catch (err) {
      const unavailable = err instanceof CanvasError && err.unavailable;
      return {
        key,
        status: unavailable ? "unavailable" : "error",
        error: err instanceof Error ? err.message : String(err),
        items: [],
        ...opts,
      };
    }
  }

  async fetch(ctx: ProviderContext): Promise<ProviderResult> {
    const c = this.client;
    const base = c.baseUrl;
    const api = "/api/v1";
    const startRequests = c.requests;

    // These two are required: without them nothing else can be interpreted, so let errors propagate.
    const self = await c.get<Any>(`${api}/users/self`);
    const rawCourses = await c.getAll<Any>(
      `${api}/courses?enrollment_state=active&include[]=term&include[]=syllabus_body&include[]=teachers&per_page=100`,
    );
    const courses = rawCourses.filter((x) => x && x.id && !x.access_restricted_by_date);
    const scopes: ScopeResult[] = [];

    scopes.push({
      key: "syllabus",
      status: "ok",
      trackRemovals: "all",
      items: courses
        .filter((x) => htmlToText(x.syllabus_body))
        .map((x) => ({
          kind: "syllabus" as const,
          externalId: String(x.id),
          courseRef: String(x.id),
          title: "Kursöversikt / Syllabus",
          htmlUrl: `${base}/courses/${x.id}/assignments/syllabus`,
          bodyText: htmlToText(x.syllabus_body),
          raw: { syllabus_body: x.syllabus_body },
        })),
    });

    await pool(courses, 3, async (course) => {
      const cid = String(course.id);
      const p = `${api}/courses/${cid}`;
      const k = (name: string) => `course:${cid}:${name}`;
      let assignmentNames = new Map<string, string>();
      let moduleItems: Any[] = [];
      const off = (name: string) => scopes.find((x) => x.key === k(name))?.status === "unavailable";

      scopes.push(
        await this.scope(k("assignments"), { trackRemovals: "all" }, async () => {
          const list = await c.getAll<Any>(`${p}/assignments?include[]=submission&order_by=due_at&per_page=100`);
          assignmentNames = new Map(list.map((a) => [String(a.id), String(a.name ?? "")]));
          return list.map((a) => normalizeAssignment(a, cid));
        }),
      );

      scopes.push(
        await this.scope(k("comments"), { trackRemovals: "none" }, async () => {
          const subs = await c.getAll<Any>(
            `${p}/students/submissions?student_ids[]=self&include[]=submission_comments&per_page=100`,
          );
          const out: ItemInput[] = [];
          for (const s of subs) {
            for (const com of (s.submission_comments ?? []) as Any[]) {
              if (com.author_id === self.id) continue; // my own comments are not news
              out.push({
                kind: "submission_comment",
                externalId: String(com.id),
                courseRef: cid,
                title: assignmentNames.get(String(s.assignment_id)) || "Inlämning",
                htmlUrl: `${base}/courses/${cid}/assignments/${s.assignment_id}/submissions/${self.id}`,
                bodyText: typeof com.comment === "string" ? com.comment : null,
                fields: { author: com.author_name ?? null, created_at: com.created_at ?? null },
                raw: com,
              });
            }
          }
          return out;
        }),
      );

      scopes.push(
        await this.scope(k("quizzes"), { trackRemovals: "all" }, async () =>
          (await c.getAll<Any>(`${p}/quizzes?per_page=100`)).map((q) => ({
            kind: "quiz" as const,
            externalId: String(q.id),
            courseRef: cid,
            title: q.title ?? "(untitled)",
            htmlUrl: q.html_url ?? null,
            dueAt: date(q.due_at),
            bodyText: htmlToText(q.description),
            fields: {
              unlock_at: q.unlock_at ?? null,
              lock_at: q.lock_at ?? null,
              points_possible: q.points_possible ?? null,
              quiz_type: q.quiz_type ?? null,
              time_limit: q.time_limit ?? null,
              assignment_id: q.assignment_id ?? null,
            },
            raw: q,
          })),
        ),
      );

      scopes.push(
        await this.scope(k("discussions"), { trackRemovals: "all" }, async () =>
          (await c.getAll<Any>(`${p}/discussion_topics?per_page=100`)).map((d) => ({
            kind: "discussion" as const,
            externalId: String(d.id),
            courseRef: cid,
            title: d.title ?? "(untitled)",
            htmlUrl: d.html_url ?? null,
            bodyText: htmlToText(d.message),
            fields: { posted_at: d.posted_at ?? null, author: d.author?.display_name ?? null, todo_date: d.todo_date ?? null },
            raw: d,
          })),
        ),
      );

      scopes.push(
        await this.scope(k("modules"), { trackRemovals: "all" }, async () => {
          const mods = await c.getAll<Any>(`${p}/modules?include[]=items&include[]=content_details&per_page=100`);
          const out: ItemInput[] = [];
          for (const m of mods) {
            // Canvas omits `items` for very large modules; fetch them separately then.
            const modItems: Any[] = Array.isArray(m.items)
              ? m.items
              : m.items_count > 0
                ? await c.getAll<Any>(`${p}/modules/${m.id}/items?include[]=content_details&per_page=100`)
                : [];
            moduleItems.push(...modItems);
            out.push({
              kind: "module",
              externalId: String(m.id),
              courseRef: cid,
              title: m.name ?? "(untitled)",
              htmlUrl: `${base}/courses/${cid}/modules#module_${m.id}`,
              fields: {
                position: m.position ?? null,
                items: modItems.filter((i) => i.type !== "SubHeader").map((i) => String(i.title ?? "")),
              },
              raw: { ...m, items: modItems },
            });
          }
          return out;
        }),
      );

      scopes.push(
        await this.scope(k("pages"), { trackRemovals: "all" }, async () =>
          (await c.getAll<Any>(`${p}/pages?include[]=body&per_page=100`)).map((pg) => {
            const body = htmlToText(pg.body);
            return {
              kind: "page" as const,
              externalId: String(pg.page_id ?? pg.url),
              courseRef: cid,
              title: pg.title ?? "(untitled)",
              htmlUrl: pg.html_url ?? null,
              bodyText: body,
              // Without a body we can still notice edits through updated_at.
              fields: { front_page: Boolean(pg.front_page), todo_date: pg.todo_date ?? null, ...(body ? {} : { updated_at: pg.updated_at ?? null }) },
              raw: pg,
            };
          }),
        ),
      );

      scopes.push(
        await this.scope(k("files"), { trackRemovals: "all" }, async () =>
          (await c.getAll<Any>(`${p}/files?per_page=100`)).map((f) => ({
            kind: "file" as const,
            externalId: String(f.id),
            courseRef: cid,
            title: f.display_name ?? f.filename ?? "(file)",
            htmlUrl: `${base}/courses/${cid}/files/${f.id}`,
            fields: {
              size: f.size ?? null,
              content_type: f["content-type"] ?? null,
              modified_at: f.modified_at ?? f.updated_at ?? null,
              folder_id: f.folder_id ?? null,
            },
            raw: f,
          })),
        ),
      );

      // Many UU courses switch the Pages and Files tabs off and publish everything through modules.
      // In that case, read the pages and file details that the modules point to.
      if (off("pages")) {
        scopes.push(
          await this.scope(k("module_pages"), { trackRemovals: "all" }, async () => {
            const out: ItemInput[] = [];
            const urls = [...new Set(moduleItems.filter((i) => i.type === "Page" && i.page_url).map((i) => String(i.page_url)))];
            for (const url of urls) {
              let pg: Any;
              try {
                pg = await c.get<Any>(`${p}/pages/${encodeURIComponent(url)}`);
              } catch (err) {
                if (err instanceof CanvasError && err.unavailable) continue; // locked or unpublished page
                throw err;
              }
              out.push({
                kind: "page",
                externalId: String(pg.page_id ?? url),
                courseRef: cid,
                title: pg.title ?? "(untitled)",
                htmlUrl: pg.html_url ?? `${base}/courses/${cid}/pages/${url}`,
                bodyText: htmlToText(pg.body),
                fields: { front_page: Boolean(pg.front_page), todo_date: pg.todo_date ?? null },
                raw: pg,
              });
            }
            return out;
          }),
        );
      }
      if (off("files")) {
        scopes.push({
          key: k("module_files"),
          status: scopes.find((x) => x.key === k("modules"))?.status ?? "error",
          trackRemovals: "all",
          items: moduleItems
            .filter((i) => i.type === "File" && i.content_id)
            .map((i) => ({
              kind: "file" as const,
              externalId: String(i.content_id),
              courseRef: cid,
              title: i.content_details?.display_name ?? i.title ?? "(file)",
              htmlUrl: i.html_url ?? `${base}/courses/${cid}/files/${i.content_id}`,
              fields: {
                size: i.content_details?.size ?? null,
                content_type: i.content_details?.content_type ?? null,
                modified_at: i.content_details?.modified_at ?? i.content_details?.updated_at ?? null,
              },
              raw: i,
            })),
        });
      }
    });

    const contextCodes = courses.map((x) => `course_${x.id}`);

    scopes.push(
      await this.scope("announcements", { trackRemovals: "none" }, async () => {
        // The endpoint defaults to the last 14 days only; ask for a full year.
        const start = new Date(ctx.now.getTime() - 365 * 86_400_000).toISOString();
        const end = new Date(ctx.now.getTime() + 86_400_000).toISOString();
        const out: ItemInput[] = [];
        for (const codes of chunk(contextCodes, 10)) {
          const q = codes.map((x) => `context_codes[]=${x}`).join("&");
          const list = await c.getAll<Any>(`${api}/announcements?${q}&start_date=${start}&end_date=${end}&per_page=100`);
          out.push(...list.map(normalizeAnnouncement));
        }
        return out;
      }),
    );

    scopes.push(
      await this.scope("calendar_events", { trackRemovals: "future" }, async () => {
        const start = new Date(ctx.now.getTime() - 30 * 86_400_000).toISOString();
        const end = new Date(ctx.now.getTime() + 240 * 86_400_000).toISOString();
        const out: ItemInput[] = [];
        // Canvas accepts at most 10 context codes per calendar request.
        for (const codes of chunk([`user_${self.id}`, ...contextCodes], 10)) {
          const q = codes.map((x) => `context_codes[]=${x}`).join("&");
          const list = await c.getAll<Any>(
            `${api}/calendar_events?type=event&${q}&start_date=${start}&end_date=${end}&per_page=100`,
          );
          for (const e of list) {
            if (e.hidden) continue;
            out.push({
              kind: "calendar_event",
              externalId: String(e.id),
              courseRef: courseFromContext(e.context_code),
              title: e.title ?? "(untitled)",
              htmlUrl: e.html_url ?? null,
              startAt: date(e.start_at),
              endAt: date(e.end_at),
              allDay: Boolean(e.all_day),
              location: [e.location_name, e.location_address].filter(Boolean).join(", ") || null,
              bodyText: htmlToText(e.description),
              raw: e,
            });
          }
        }
        return out;
      }),
    );

    scopes.push(
      await this.scope("groups", { trackRemovals: "all" }, async () =>
        (await c.getAll<Any>(`${api}/users/self/groups?per_page=100`)).map((g) => ({
          kind: "group" as const,
          externalId: String(g.id),
          courseRef: g.course_id ? String(g.course_id) : null,
          title: g.name ?? "(group)",
          htmlUrl: `${base}/groups/${g.id}`,
          fields: { group_category_id: g.group_category_id ?? null },
          raw: g,
        })),
      ),
    );

    scopes.push(
      await this.scope("appointment_groups", { trackRemovals: "future" }, async () =>
        (await c.getAll<Any>(`${api}/appointment_groups?scope=reservable&per_page=100`)).map((g) => ({
          kind: "appointment_group" as const,
          externalId: String(g.id),
          courseRef: courseFromContext((g.context_codes ?? [])[0]),
          title: g.title ?? "(booking)",
          htmlUrl: g.html_url ?? `${base}/calendar`,
          startAt: date(g.start_at),
          endAt: date(g.end_at),
          location: g.location_name ?? null,
          bodyText: htmlToText(g.description),
          fields: {
            participants_per_appointment: g.participants_per_appointment ?? null,
            max_appointments_per_participant: g.max_appointments_per_participant ?? null,
            requiring_action: g.requiring_action ?? null,
            reserved_times: Array.isArray(g.reserved_times) ? g.reserved_times.length : null,
          },
          raw: g,
        })),
      ),
    );

    scopes.push(
      await this.scope("planner", { trackRemovals: "none", radar: false }, async () => {
        const start = new Date(ctx.now.getTime() - 14 * 86_400_000).toISOString();
        return (await c.getAll<Any>(`${api}/planner/items?start_date=${start}&per_page=100`)).map((pi) => ({
          kind: "planner_item" as const,
          externalId: `${pi.plannable_type}_${pi.plannable_id}`,
          courseRef: pi.course_id ? String(pi.course_id) : null,
          title: pi.plannable?.title ?? pi.plannable?.name ?? "(untitled)",
          htmlUrl: typeof pi.html_url === "string" ? (pi.html_url.startsWith("http") ? pi.html_url : `${base}${pi.html_url}`) : null,
          dueAt: date(pi.plannable_date),
          fields: {
            plannable_type: pi.plannable_type ?? null,
            completed: Boolean(pi.planner_override?.marked_complete),
            submitted: Boolean(pi.submissions && pi.submissions.submitted),
          },
          raw: pi,
        }));
      }),
    );

    return { courses: courses.map((x) => normalizeCourse(x, base)), scopes, requests: c.requests - startRequests };
  }
}
