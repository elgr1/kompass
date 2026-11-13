import { describe, expect, it } from "vitest";
import { createDb } from "../src/lib/db/index";
import { courses, items, suggestions, tasks } from "../src/lib/db/schema";
import { importText, runDetector } from "../src/lib/detect/run";
import { buildCalendar, fold } from "../src/lib/ics-export";
import { parseIcs } from "../src/lib/ics";
import type { NotifyChannel, Outgoing } from "../src/lib/notify/channels";
import { digestDue, planReminders, type Remindable } from "../src/lib/notify/plan";
import { notifyTick } from "../src/lib/notify/run";
import { getDeadlines } from "../src/lib/queries";
import { captureTask, createTask, setTaskDone } from "../src/lib/tasks";

const now = new Date("2026-11-12T09:00:00Z"); // Thu 10:00 Stockholm
const at = (iso: string) => new Date(iso);

function seed() {
  const db = createDb(":memory:");
  const course = (id: string, shortName: string, extra: Record<string, unknown> = {}) =>
    db.insert(courses).values({ id, provider: "canvas", externalId: id, name: shortName, shortName, color: "#000", firstSeenAt: now, lastSeenAt: now, ...extra }).run();
  course("canvas:1", "Reglerteknik I", { code: "1RT490", nicknames: "regler" });
  course("canvas:2", "Elektromagnetism II", { hidden: true });
  const item = (id: string, kind: string, courseId: string, title: string, bodyText: string, fields: Record<string, unknown> = {}, dueAt: Date | null = null) =>
    db.insert(items).values({
      id, provider: "canvas", kind, externalId: id, scope: "s", courseId, title, htmlUrl: `https://uppsala.instructure.com/${id}`, bodyText, dueAt,
      fields, comparable: {}, hash: "h", firstSeenAt: now, lastSeenAt: now, changedAt: now,
    }).run();
  return { db, item };
}

describe("detector over mirrored items", () => {
  it("creates pending suggestions with quote, course and source link, and never duplicates them", () => {
    const { db, item } = seed();
    item("a1", "announcement", "canvas:1", "Labbgrupper", "Hej!\nAnmäl dig till en labbgrupp senast fredag kl. 17.00.", { posted_at: "2026-11-11T08:00:00Z" });
    item("a2", "announcement", "canvas:1", "Föreläsning", "Föreläsning 7 hålls 17/11 i sal 2001.");
    item("a3", "announcement", "canvas:2", "Gammal kurs", "Anmäl dig senast 20 november."); // hidden course
    item("as", "assignment", "canvas:1", "Inl 1", "Lämnas in senast 24 november kl 23.59.", {}, at("2026-11-24T22:59:00Z")); // repeats its own deadline
    item("f1", "file", "canvas:1", "Kurs-PM.pdf", "Anmäl dig senast 20 november."); // files are not scanned

    expect(runDetector(db, now).added).toBe(1);
    const [s] = db.select().from(suggestions).all();
    expect(s).toMatchObject({ itemId: "a1", courseId: "canvas:1", kind: "signup", status: "pending", hasTime: true, sourceUrl: "https://uppsala.instructure.com/a1", quote: "Anmäl dig till en labbgrupp senast fredag kl. 17.00." });
    expect(s.dueAt.toISOString()).toBe("2026-11-13T16:00:00.000Z"); // the Friday after it was posted, 17:00 local

    expect(runDetector(db, now).added).toBe(0);
    expect(db.select().from(tasks).all()).toHaveLength(0); // nothing becomes a task by itself
  });

  it("imports pasted text as suggestions", () => {
    const { db } = seed();
    expect(importText(db, "Tentamensanmälan i Ladok senast 2026-12-01. Tentan går 14 januari kl 8.", "Kurs-PM", "canvas:1", now)).toBe(2);
    expect(db.select().from(suggestions).all().map((s) => s.kind).sort()).toEqual(["exam", "signup"]);
    expect(importText(db, "Tentamensanmälan i Ladok senast 2026-12-01. Tentan går 14 januari kl 8.", "Kurs-PM", "canvas:1", now)).toBe(0);
  });
});

describe("tasks", () => {
  it("captures a line into a task, files undated course-less ones in the inbox, and toggles done", () => {
    const { db } = seed();
    const a = captureTask(db, "labbrapport regler fre 17 #lab", now)!;
    expect(a).toMatchObject({ title: "Labbrapport", courseId: "canvas:1", status: "todo", hasTime: true, tags: ["lab"], source: "capture" });
    expect(a.dueAt?.toISOString()).toBe("2026-11-13T16:00:00.000Z");
    const b = captureTask(db, "köp labbrock", now)!;
    expect(b.status).toBe("inbox");
    expect(captureTask(db, "   ", now)).toBeNull();
    setTaskDone(db, b.id, true, now);
    setTaskDone(db, b.id, false, now);
    expect(db.select().from(tasks).all().map((t) => t.status).sort()).toEqual(["inbox", "todo"]);
  });

  it("lists my tasks together with Studium deadlines, without hidden courses", () => {
    const { db, item } = seed();
    item("as1", "assignment", "canvas:1", "Inl 1", "", { submission_state: "unsubmitted" }, at("2026-11-24T22:59:00Z"));
    item("as2", "assignment", "canvas:2", "Gammal", "", {}, at("2026-11-20T22:59:00Z"));
    createTask(db, { title: "Anmäl labbgrupp", dueAt: at("2026-11-13T16:00:00Z"), hasTime: true, kind: "signup", source: "manual" }, now);
    const list = getDeadlines(db, now, at("2026-12-01T00:00:00Z"), now);
    expect(list.map((d) => [d.title, d.origin, d.state])).toEqual([["Anmäl labbgrupp", "task", "open"], ["Inl 1", "source", "open"]]);
  });
});

describe("reminders", () => {
  const signup = (due: string, hasTime = true): Remindable => ({ id: "task:1", title: "Anmäl labbgrupp", dueAt: at(due), hasTime, kind: "signup" });
  const keys = (n: Date, r: Remindable, sent: string[] = []) => planReminders(n, [r], new Set(sent), "sv").send.map((x) => x.key.split(":").pop());

  it("escalates sign-ups at 3 days, 1 day and 3 hours, each once", () => {
    const r = signup("2026-11-20T16:00:00Z");
    expect(keys(at("2026-11-16T16:00:00Z"), r)).toEqual([]); // 4 days left
    expect(keys(at("2026-11-17T17:00:00Z"), r)).toEqual(["3d"]);
    expect(keys(at("2026-11-19T17:00:00Z"), r)).toEqual(["1d"]);
    expect(keys(at("2026-11-20T13:30:00Z"), r)).toEqual(["3h"]);
    expect(keys(at("2026-11-20T16:30:00Z"), r)).toEqual([]); // closed
    const first = planReminders(at("2026-11-17T17:00:00Z"), [r], new Set(), "sv").send[0];
    expect(planReminders(at("2026-11-17T17:05:00Z"), [r], new Set([first.key]), "sv").send).toEqual([]);
    expect(first.title).toContain("Anmälan stänger");
  });

  it("after a closed laptop sends only the most urgent reminder and marks the earlier ones done", () => {
    const p = planReminders(at("2026-11-20T14:00:00Z"), [signup("2026-11-20T16:00:00Z")], new Set(), "sv");
    expect(p.send.map((x) => x.key.split(":").pop())).toEqual(["3h"]);
    expect(p.markSent.map((k) => k.split(":").pop())).toEqual(["3d", "1d"]);
  });

  it("gives ordinary deadlines one reminder, date-only sign-ups a morning reminder, and restarts when a deadline moves", () => {
    const plain: Remindable = { id: "x", title: "Inl 1", dueAt: at("2026-11-20T22:59:00Z"), hasTime: true, kind: "deadline" };
    expect(keys(at("2026-11-18T10:00:00Z"), plain)).toEqual([]);
    expect(keys(at("2026-11-20T08:00:00Z"), plain)).toEqual(["1d"]);
    const dateOnly = signup("2026-11-20T22:59:00Z", false);
    expect(keys(at("2026-11-20T06:30:00Z"), dateOnly)).toEqual(["1d"]); // 07:30 local, before the 08:00 morning reminder
    expect(keys(at("2026-11-20T07:05:00Z"), dateOnly)).toEqual(["day"]);
    const sent = planReminders(at("2026-11-20T08:00:00Z"), [plain], new Set(), "sv").send.map((x) => x.key);
    expect(planReminders(at("2026-11-21T08:00:00Z"), [{ ...plain, dueAt: at("2026-11-21T22:59:00Z") }], new Set(sent), "sv").send).toHaveLength(1);
  });

  it("schedules the morning digest and the Sunday preview once each", () => {
    expect(digestDue(at("2026-11-12T04:00:00Z"), new Set())).toBeNull(); // 05:00
    expect(digestDue(at("2026-11-12T06:00:00Z"), new Set())).toEqual({ key: "digest:2026-11-12", type: "morning" });
    expect(digestDue(at("2026-11-12T06:00:00Z"), new Set(["digest:2026-11-12"]))).toBeNull();
    expect(digestDue(at("2026-11-12T12:00:00Z"), new Set())).toBeNull(); // 13:00: too late for "morning"
    expect(digestDue(at("2026-11-15T16:00:00Z"), new Set())).toEqual({ key: "weekly:2026-11-15", type: "weekly" }); // Sunday 17:00
  });

  it("delivers through the configured channel, records it, and retries a failed send", async () => {
    const { db } = seed();
    createTask(db, { title: "Anmäl labbgrupp", dueAt: at("2026-11-12T11:00:00Z"), hasTime: true, kind: "signup", source: "manual" }, now);
    const got: Outgoing[] = [];
    let fail = true;
    const ch: NotifyChannel = { id: "test", send: async (n) => { if (fail) throw new Error("offline"); got.push(n); } };
    const early = at("2026-11-12T10:45:00Z"); // 11:45 local, 15 min before close, outside the digest window
    expect(await notifyTick(db, early, [ch])).toBe(0); // channel is down: nothing recorded
    fail = false;
    expect(await notifyTick(db, early, [ch])).toBe(1); // so it is retried
    expect(got[0].title).toContain("Anmäl labbgrupp");
    expect(await notifyTick(db, early, [ch])).toBe(0);
  });
});

describe("calendar feed", () => {
  it("writes valid, escaped, folded iCalendar that our own parser can read back", () => {
    const ics = buildCalendar([
      { uid: "task-1", title: "Anmäl labbgrupp; Lab 4, Kvantfysik", start: at("2026-11-13T15:30:00Z"), end: at("2026-11-13T16:00:00Z"), description: "rad 1\nrad 2", url: "https://uppsala.instructure.com/x" },
      { uid: "task-2", title: "Hela dagen", start: at("2026-11-20T22:59:00Z"), allDay: true },
    ], now);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("SUMMARY:Anmäl labbgrupp\; Lab 4\\, Kvantfysik");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261120");
    expect(ics).toContain("DTEND;VALUE=DATE:20261121");
    const back = parseIcs(ics);
    expect(back.map((e) => [e.uid, e.summary, e.allDay])).toEqual([["task-1@kompass", "Anmäl labbgrupp; Lab 4, Kvantfysik", false], ["task-2@kompass", "Hela dagen", true]]);
    expect(back[0].start.toISOString()).toBe("2026-11-13T15:30:00.000Z");
    expect(back[0].description).toBe("rad 1\nrad 2");
  });

  it("folds long lines at 75 bytes without splitting å/ä/ö", () => {
    const folded = fold(`SUMMARY:${"åäö ".repeat(40)}`);
    for (const line of folded.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${"åäö ".repeat(40)}`);
  });
});
