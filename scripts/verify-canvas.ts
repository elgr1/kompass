/**
 * Phase 0: verify that the Studium (Canvas) API is usable with a personal access token.
 *
 *   npm run verify:canvas
 *
 * Read-only: only GET requests. The token is sent to CANVAS_BASE_URL and nowhere
 * else (redirects are not followed), and it is never printed.
 * No dependencies; runs on Node >= 23.6 (native TypeScript + fetch).
 */

const ALLOWED_HOSTS = new Set(["uppsala.instructure.com"]);

const baseUrl = (process.env.CANVAS_BASE_URL ?? "https://uppsala.instructure.com").replace(/\/+$/, "");
const token = (process.env.CANVAS_TOKEN ?? "").trim();

type Result = {
  name: string;
  path: string;
  ok: boolean;
  status: number | null;
  detail: string;
  rateRemaining: string | null;
  requestCost: string | null;
  paginated: boolean;
  body: unknown;
};

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(2);
}

if (!token) {
  fail(
    "CANVAS_TOKEN is empty. Put your token in .env (CANVAS_TOKEN=...) and run again.\n" +
      "  Create one in Studium: Konto → Inställningar → Godkända integrationer → “+ Ny åtkomsttoken”.",
  );
}

let host: string;
try {
  const u = new URL(baseUrl);
  if (u.protocol !== "https:") fail(`CANVAS_BASE_URL must be https (got ${u.protocol})`);
  host = u.host;
} catch {
  fail(`CANVAS_BASE_URL is not a valid URL: ${baseUrl}`);
}
if (!ALLOWED_HOSTS.has(host)) {
  fail(
    `Refusing to send the token to ${host}. Allowed: ${[...ALLOWED_HOSTS].join(", ")}.\n` +
      "  (Edit ALLOWED_HOSTS in scripts/verify-canvas.ts if UU changes its Canvas host.)",
  );
}

function summarize(body: unknown): string {
  if (Array.isArray(body)) return `${body.length} item${body.length === 1 ? "" : "s"}`;
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (Array.isArray(o.errors)) {
      return o.errors.map((e) => (e as { message?: string }).message ?? JSON.stringify(e)).join("; ");
    }
    if (typeof o.message === "string") return o.message;
    return "object";
  }
  return typeof body === "string" ? body.slice(0, 120) : String(body);
}

async function call(name: string, path: string): Promise<Result> {
  const r: Result = {
    name,
    path,
    ok: false,
    status: null,
    detail: "",
    rateRemaining: null,
    requestCost: null,
    paginated: false,
    body: null,
  };
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "manual", // never forward the token to another host
      signal: AbortSignal.timeout(30_000),
    });
    r.status = res.status;
    r.rateRemaining = res.headers.get("x-rate-limit-remaining");
    r.requestCost = res.headers.get("x-request-cost");
    r.paginated = /rel="next"/.test(res.headers.get("link") ?? "");
    if (res.status >= 300 && res.status < 400) {
      r.detail = `redirect → ${res.headers.get("location") ?? "?"} (not followed)`;
      return r;
    }
    const text = await res.text();
    try {
      r.body = JSON.parse(text);
    } catch {
      r.body = text;
    }
    r.ok = res.ok;
    r.detail = summarize(r.body);
  } catch (err) {
    r.detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }
  return r;
}

function print(r: Result): void {
  const mark = r.ok ? "✓" : "✗";
  const rate =
    r.rateRemaining !== null
      ? `  [rate remaining ${Number(r.rateRemaining).toFixed(1)}, cost ${Number(r.requestCost ?? 0).toFixed(3)}]`
      : "";
  console.log(`${mark} ${r.name}`);
  console.log(`    GET ${r.path}`);
  console.log(`    ${r.status ?? "no response"} · ${r.detail}${r.paginated ? " (more pages)" : ""}${rate}`);
}

const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" }); // YYYY-MM-DD

console.log(`Kompass · Canvas API check against ${baseUrl}`);
console.log(`Date (Europe/Stockholm): ${today}\n`);

const results: Result[] = [];
const run = async (name: string, path: string) => {
  const r = await call(name, path);
  results.push(r);
  print(r);
  return r;
};

const self = await run("Who am I", "/api/v1/users/self");
if (self.status === 401) {
  console.log("\n→ 401: the token was rejected (wrong, expired, or revoked). Skipping the rest.");
  process.exit(1);
}
if (self.ok) {
  const u = self.body as { name?: string; id?: number };
  console.log(`    signed in as: ${u.name ?? "?"} (user id ${u.id ?? "?"})`);
}

const courses = await run(
  "Active courses",
  "/api/v1/courses?enrollment_state=active&include[]=term&per_page=100",
);
type Course = { id: number; name?: string; course_code?: string; term?: { name?: string } };
const courseList: Course[] = courses.ok && Array.isArray(courses.body) ? (courses.body as Course[]) : [];
for (const c of courseList) {
  console.log(`    · ${c.id}  ${c.name ?? c.course_code ?? "(unnamed)"}${c.term?.name ? `  [${c.term.name}]` : ""}`);
}

await run("Planner items", `/api/v1/planner/items?start_date=${today}&per_page=100`);
await run("My groups", "/api/v1/users/self/groups?per_page=100");
await run("Appointment groups (reservable)", "/api/v1/appointment_groups?scope=reservable&per_page=100");

if (courseList.length > 0) {
  const codes = courseList
    .slice(0, 10)
    .map((c) => `context_codes[]=course_${c.id}`)
    .join("&");
  await run(`Announcements (${Math.min(courseList.length, 10)} course(s))`, `/api/v1/announcements?${codes}&per_page=100`);
} else {
  console.log("– Announcements: skipped (no active courses returned to query)");
}

const passed = results.filter((r) => r.ok).length;
const remaining = results
  .map((r) => r.rateRemaining)
  .filter((v): v is string => v !== null)
  .map(Number);

console.log(`\n${passed}/${results.length} calls succeeded.`);
if (remaining.length > 0) {
  console.log(
    `Rate limit: X-Rate-Limit-Remaining ended at ${remaining.at(-1)!.toFixed(1)} ` +
      `(lowest seen ${Math.min(...remaining).toFixed(1)}; Canvas throttles with 403 when the bucket hits 0).`,
  );
} else {
  console.log("Rate limit: no X-Rate-Limit-Remaining header was returned.");
}
const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.log("Failed: " + failed.map((r) => `${r.name} (${r.status ?? "network"})`).join(", "));
}
process.exit(failed.length === 0 ? 0 : 1);

export {};
