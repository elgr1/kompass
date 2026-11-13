import { describe, expect, it } from "vitest";
import { CanvasClient, CanvasError, parseNextLink } from "../src/lib/canvas/client";
import { normalizeAssignment, normalizeCourse, shortCourseName } from "../src/lib/providers/canvas-api";

const BASE = "https://uppsala.instructure.com";
const json = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "content-type": "application/json", ...init.headers } });

function client(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as typeof fetch;
  return { c: new CanvasClient({ baseUrl: BASE, token: "secret", fetchImpl, sleepImpl: async () => {} }), calls };
}

describe("Canvas client", () => {
  it("parses the next link", () => {
    expect(parseNextLink(`<${BASE}/a?page=1>; rel="current", <${BASE}/a?page=2>; rel="next"`)).toBe(`${BASE}/a?page=2`);
    expect(parseNextLink(`<${BASE}/a?page=1>; rel="current"`)).toBeNull();
    expect(parseNextLink(null)).toBeNull();
  });

  it("follows pagination, sends only GET with the bearer token, and never follows redirects", async () => {
    const { c, calls } = client((url) =>
      url.endsWith("page=2") ? json([{ id: 3 }]) : json([{ id: 1 }, { id: 2 }], { headers: { link: `<${BASE}/api/v1/x?page=2>; rel="next"` } }),
    );
    expect(await c.getAll("/api/v1/x")).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.init.method).toBe("GET");
      expect(call.init.redirect).toBe("manual");
      expect((call.init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    }
  });

  it("refuses to send the token to any other host, including via a next link", async () => {
    expect(() => new CanvasClient({ baseUrl: "https://uu.instructure.com", token: "secret" })).toThrow(/Refusing/);
    expect(() => new CanvasClient({ baseUrl: "http://uppsala.instructure.com", token: "secret" })).toThrow(/Refusing/);
    const { c, calls } = client(() => json([{ id: 1 }], { headers: { link: `<https://evil.example/api?page=2>; rel="next"` } }));
    await expect(c.getAll("/api/v1/x")).rejects.toThrow(/Refusing/);
    expect(calls).toHaveLength(1);
  });

  it("retries rate limiting and server errors, then succeeds", async () => {
    let n = 0;
    const { c, calls } = client(() => {
      n++;
      if (n === 1) return new Response("403 Forbidden (Rate Limit Exceeded)", { status: 403 });
      if (n === 2) return json({}, { status: 502 });
      return json({ ok: true });
    });
    expect(await c.get("/api/v1/x")).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
  });

  it("does not retry a real 401/403/404 and marks 403/404 as unavailable", async () => {
    const { c, calls } = client(() => json({ errors: [{ message: "Invalid access token." }] }, { status: 401 }));
    const err = (await c.get("/api/v1/x").catch((e) => e)) as CanvasError;
    expect(err).toBeInstanceOf(CanvasError);
    expect(err.message).toBe("Invalid access token.");
    expect(err.unavailable).toBe(false);
    expect(calls).toHaveLength(1);
    const forbidden = (await client(() => json({ message: "unauthorized" }, { status: 403 })).c.get("/api/v1/x").catch((e) => e)) as CanvasError;
    expect(forbidden.unavailable).toBe(true);
  });

  it("tracks the rate-limit header", async () => {
    const { c } = client(() => json({}, { headers: { "x-rate-limit-remaining": "612.5" } }));
    await c.get("/api/v1/x");
    expect(c.rateRemaining).toBe(612.5);
  });
});

describe("Canvas normalization", () => {
  it("shortens UU course names and extracts the course code", () => {
    expect(shortCourseName("Kvantfysik F 1FA535 13046 HT2026")).toBe("Kvantfysik F");
    expect(shortCourseName("Civilingenjörsprogrammet i teknisk fysik")).toBe("Civilingenjörsprogrammet i teknisk fysik");
    expect(normalizeCourse({ id: 123998, name: "Kvantfysik F 1FA535 13046 HT2026", term: { name: "HT2026" } }, BASE)).toMatchObject({
      externalId: "123998", shortName: "Kvantfysik F", code: "1FA535", term: "HT2026", htmlUrl: `${BASE}/courses/123998`,
    });
  });

  it("normalizes an assignment with its submission status and source link", () => {
    const n = normalizeAssignment(
      { id: 7, name: "Lab 3", html_url: `${BASE}/courses/1/assignments/7`, due_at: "2026-11-14T22:59:00Z", description: "<p>Max 6 sidor</p>",
        points_possible: 10, submission_types: ["online_upload"], submission: { workflow_state: "graded", grade: "G", score: 10 } },
      "1",
    );
    expect(n).toMatchObject({ kind: "assignment", externalId: "7", courseRef: "1", title: "Lab 3", bodyText: "Max 6 sidor", htmlUrl: `${BASE}/courses/1/assignments/7` });
    expect(n.dueAt?.toISOString()).toBe("2026-11-14T22:59:00.000Z");
    expect(n.fields).toMatchObject({ submission_state: "graded", grade: "G", submission_types: "online_upload" });
  });
});
