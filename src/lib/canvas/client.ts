/**
 * Read-only Canvas client. GET is the only verb it knows.
 *
 * Safety rules (see CLAUDE.md):
 * - the token is only ever sent to hosts in CANVAS_HOSTS, including on paginated "next" links;
 * - redirects are never followed, so the Authorization header cannot leak to another host;
 * - the token is never logged or put in a URL.
 */

/** Studium is uppsala.instructure.com. (uu.instructure.com is a different institution.) */
export const CANVAS_HOSTS = new Set(["uppsala.instructure.com"]);

export class CanvasError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "CanvasError";
    this.status = status;
  }
  /** Feature switched off, hidden tab, or not permitted for students: not worth retrying. */
  get unavailable(): boolean {
    return this.status === 403 || this.status === 404;
  }
}

export function parseNextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type CanvasClientOptions = {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** Injected in tests so retries do not really wait. */
  sleepImpl?: (ms: number) => Promise<unknown>;
};

export class CanvasClient {
  readonly baseUrl: string;
  requests = 0;
  rateRemaining: number | null = null;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<unknown>;

  constructor(opts: CanvasClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleepImpl ?? sleep;
    this.assertAllowed(this.baseUrl);
  }

  private assertAllowed(url: string): URL {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new CanvasError(`Invalid Canvas URL`, null);
    }
    if (u.protocol !== "https:" || !CANVAS_HOSTS.has(u.host)) {
      throw new CanvasError(`Refusing to send the Canvas token to ${u.host}`, null);
    }
    return u;
  }

  private async request(url: string): Promise<Response> {
    this.assertAllowed(url);
    let lastError: CanvasError | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await this.sleep(1500 * 2 ** (attempt - 1));
      let res: Response;
      try {
        this.requests++;
        res = await this.fetchImpl(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
          redirect: "manual",
          signal: AbortSignal.timeout(45_000),
        });
      } catch (err) {
        lastError = new CanvasError(`Network error: ${err instanceof Error ? err.message : String(err)}`, null);
        continue;
      }

      const remaining = res.headers.get("x-rate-limit-remaining");
      if (remaining !== null) {
        this.rateRemaining = Number(remaining);
        // Canvas's bucket refills continuously; slow down well before it is empty.
        if (this.rateRemaining < 50) await this.sleep(5000);
        else if (this.rateRemaining < 150) await this.sleep(1500);
      }

      if (res.ok) return res;

      const body = await res.text().catch(() => "");
      if (res.status === 403 && /rate limit exceeded/i.test(body)) {
        lastError = new CanvasError("Rate limit exceeded", 429);
        continue;
      }
      if (res.status >= 500) {
        lastError = new CanvasError(`Canvas server error ${res.status}`, res.status);
        continue;
      }
      if (res.status >= 300 && res.status < 400) {
        throw new CanvasError(`Unexpected redirect (${res.status}); not followed`, res.status);
      }
      let message = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(body) as { errors?: { message?: string }[]; message?: string };
        message = j.errors?.[0]?.message ?? j.message ?? message;
      } catch {
        /* keep the status text */
      }
      throw new CanvasError(message, res.status);
    }
    throw lastError ?? new CanvasError("Request failed", null);
  }

  /**
   * Downloads a course file. Canvas answers with a redirect to its file storage, carrying a
   * short-lived signed URL. The token is sent to Studium only: every hop after that is
   * fetched WITHOUT the Authorization header, so the token cannot leak to the storage host.
   */
  async download(url: string, maxBytes: number): Promise<{ bytes: Uint8Array; contentType: string }> {
    this.assertAllowed(url);
    let next = url;
    for (let hop = 0; hop < 5; hop++) {
      const u = new URL(next);
      if (u.protocol !== "https:") throw new CanvasError("Refusing a non-https download", null);
      const onCanvas = CANVAS_HOSTS.has(u.host);
      this.requests++;
      const res = await this.fetchImpl(next, {
        method: "GET",
        headers: onCanvas ? { Authorization: `Bearer ${this.token}` } : {},
        redirect: "manual",
        signal: AbortSignal.timeout(90_000),
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new CanvasError("Redirect without a location", res.status);
        next = new URL(loc, next).toString();
        continue;
      }
      if (!res.ok) throw new CanvasError(`Download failed: HTTP ${res.status}`, res.status);
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > maxBytes) throw new CanvasError(`File is larger than ${Math.round(maxBytes / 1_048_576)} MB`, null);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > maxBytes) throw new CanvasError(`File is larger than ${Math.round(maxBytes / 1_048_576)} MB`, null);
      return { bytes, contentType: res.headers.get("content-type") ?? "" };
    }
    throw new CanvasError("Too many redirects", null);
  }

  static fromEnv(): CanvasClient | null {
    const token = (process.env.CANVAS_TOKEN ?? "").trim();
    return token ? new CanvasClient({ baseUrl: (process.env.CANVAS_BASE_URL ?? "https://uppsala.instructure.com").trim(), token }) : null;
  }

  async get<T>(path: string): Promise<T> {
    const res = await this.request(`${this.baseUrl}${path}`);
    return (await res.json()) as T;
  }

  /** Follows `Link: rel="next"` until the list is exhausted. */
  async getAll<T>(path: string, maxPages = 100): Promise<T[]> {
    const out: T[] = [];
    let url: string | null = `${this.baseUrl}${path}`;
    for (let page = 0; url && page < maxPages; page++) {
      const res: Response = await this.request(url);
      const data = (await res.json()) as T[] | Record<string, unknown>;
      if (!Array.isArray(data)) throw new CanvasError("Expected a list from Canvas", res.status);
      out.push(...data);
      url = parseNextLink(res.headers.get("link"));
    }
    if (url) throw new CanvasError(`More than ${maxPages} pages; refusing to return a partial list`, null);
    return out;
  }
}
