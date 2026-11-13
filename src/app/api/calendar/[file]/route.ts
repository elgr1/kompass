import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { buildCalendar, type FeedEntry } from "@/lib/ics-export";
import { careerAgenda } from "@/lib/career/store";
import { getBlocks } from "@/lib/plan/store";
import { getDeadlines, getEvents } from "@/lib/queries";
import { getFeedToken } from "@/lib/settings";
import { addDays, dateKey, startOfDay } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Private calendar feed: /api/calendar/<token>.ics (add ?schedule=1 to include the TimeEdit schedule). */
export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const db = getDb();
  const given = Buffer.from(file.replace(/\.ics$/, ""));
  const expected = Buffer.from(getFeedToken(db));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response("Not found", { status: 404 });

  const now = new Date();
  const today = dateKey(now);
  const from = startOfDay(addDays(today, -30));
  const to = startOfDay(addDays(today, 240));
  const entries: FeedEntry[] = getDeadlines(db, from, to, now).map((d) => ({
    uid: d.id.replace(/[^a-zA-Z0-9]/g, "-"),
    title: `${d.state === "open" || d.state === "missing" ? "" : "✓ "}${d.title}${d.course ? ` · ${d.course.shortName}` : ""}`,
    start: d.hasTime ? new Date(d.dueAt.getTime() - 30 * 60_000) : d.dueAt,
    end: d.dueAt,
    allDay: !d.hasTime,
    url: d.htmlUrl,
  }));
  // Accepted study blocks and busy time are part of "everything"; proposals are not.
  for (const b of getBlocks(db, from, to)) {
    if (b.status === "accepted") entries.push({ uid: `block-${b.id}`, title: b.title, start: b.startAt, end: b.endAt });
  }
  for (const e of careerAgenda(db, from, to)) entries.push({ uid: e.id.replace(/[^a-zA-Z0-9]/g, "-"), title: e.title, start: e.startAt, allDay: true, location: e.location, url: e.htmlUrl });
  if (new URL(req.url).searchParams.get("schedule") === "1") {
    for (const e of getEvents(db, from, to)) {
      entries.push({ uid: e.id.replace(/[^a-zA-Z0-9]/g, "-"), title: e.title, start: e.startAt, end: e.endAt, allDay: e.allDay, location: e.location, url: e.htmlUrl });
    }
  }
  return new Response(buildCalendar(entries, now), { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store" } });
}
