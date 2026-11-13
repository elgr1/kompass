import { describe, expect, it } from "vitest";
import { parseIcs } from "../src/lib/ics";
import { matchCourse, parseTimeEditSummary, TimeEditIcsProvider } from "../src/lib/providers/ics";

const feed = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:te-1@timeedit",
  "DTSTART:20261112T091500Z",
  "DTEND:20261112T110000Z",
  "SUMMARY:1FA535\\, Kvantfysik F\\, Föreläsning",
  "LOCATION:Ångström 2001\\, Hus 2",
  "DESCRIPTION:Lärare: A. Lindqvist\\nKapitel 7 och en väldigt lång rad som",
  "  fortsätter på nästa rad",
  "BEGIN:VALARM",
  "DESCRIPTION:should be ignored",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:local-1",
  "DTSTART;TZID=Europe/Stockholm:20260601T081500",
  "DTEND;TZID=Europe/Stockholm:20260601T100000",
  "SUMMARY:Sommartid",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:allday-1",
  "DTSTART;VALUE=DATE:20261224",
  "SUMMARY:Julafton",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "SUMMARY:No UID, skipped",
  "DTSTART:20261112T091500Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("ICS parsing", () => {
  const events = parseIcs(feed);

  it("parses events and skips invalid ones", () => {
    expect(events.map((e) => e.uid)).toEqual(["te-1@timeedit", "local-1", "allday-1"]);
  });

  it("unescapes text, unfolds long lines and ignores alarms", () => {
    const e = events[0];
    expect(e.summary).toBe("1FA535, Kvantfysik F, Föreläsning");
    expect(e.location).toBe("Ångström 2001, Hus 2");
    expect(e.description).toBe("Lärare: A. Lindqvist\nKapitel 7 och en väldigt lång rad som fortsätter på nästa rad");
    expect(e.start.toISOString()).toBe("2026-11-12T09:15:00.000Z");
    expect(e.end?.toISOString()).toBe("2026-11-12T11:00:00.000Z");
  });

  it("reads TZID times as Stockholm wall time, including summer time", () => {
    expect(events[1].start.toISOString()).toBe("2026-06-01T06:15:00.000Z");
  });

  it("treats bare dates as all-day events at local midnight", () => {
    expect(events[2].allDay).toBe(true);
    expect(events[2].start.toISOString()).toBe("2026-12-23T23:00:00.000Z");
    expect(events[2].end).toBeNull();
  });

  it("matches a schedule entry to a course by code, only when unambiguous", () => {
    const known = [
      { id: "canvas:1", code: "1FA535" },
      { id: "canvas:2", code: "1RT490" },
      { id: "canvas:3", code: null },
    ];
    expect(matchCourse(events[0].summary, known)).toBe("canvas:1");
    expect(matchCourse("1FA535 och 1RT490 samläses", known)).toBeNull();
    expect(matchCourse("Okänd kurs", known)).toBeNull();
  });
});

describe("TimeEdit provider (UU summary format)", () => {
  it("splits groups, course name and activity", () => {
    expect(parseTimeEditSummary("F3.A, F3.B1-2, Reglerteknik I.  , Laboration")).toEqual({ course: "Reglerteknik I", activity: "Laboration", groups: ["F3.A", "F3.B1-2"] });
    expect(parseTimeEditSummary("MasMat.FM1, MasStatMat2, Finansiella derivat.  , Föreläsning").course).toBe("Finansiella derivat");
    expect(parseTimeEditSummary("F3, Kvantfysik F.").activity).toBeNull();
    expect(parseTimeEditSummary("Något helt annat")).toEqual({ course: null, activity: null, groups: [] });
  });

  const ev = (uid: string, summary: string) =>
    ["BEGIN:VEVENT", `UID:${uid}`, "DTSTART:20261112T121500Z", "DTEND:20261112T140000Z", `SUMMARY:${summary.replace(/,/g, "\\,")}`, "LOCATION:Plats: 102162\\, Ångström", "END:VEVENT"].join("\r\n");
  const ics = ["BEGIN:VCALENDAR", ev("1", "F3.A, Reglerteknik I.  , Laboration"), ev("2", "MasMat, Finansiella derivat.  , Föreläsning"), ev("3", "F3, Okänd kurs.  , Lektion"), "END:VCALENDAR"].join("\r\n");
  const fetchImpl = (async () => new Response(ics)) as unknown as typeof fetch;
  const known = [
    { id: "canvas:1", provider: "canvas", code: "1RT490", name: "Reglerteknik I 1RT490 11803 HT2026", shortName: "Reglerteknik I" },
    { id: "canvas:2", provider: "canvas", code: "1MA209", name: "Financial Derivatives 1MA209 10105 HT2026", shortName: "Financial Derivatives" },
  ];

  it("links by exact name, by user alias, and otherwise creates a schedule-only course", async () => {
    const p = new TimeEditIcsProvider(["https://cloud.timeedit.net/uu/web/x.ics"], fetchImpl);
    const r = await p.fetch({ now: new Date(), knownCourses: known, aliases: new Map([["finansiella derivat", "canvas:2"]]) });
    const [scope] = r.scopes;
    expect(scope.status).toBe("ok");
    expect(scope.items.map((i) => [i.title, i.courseRef, i.location])).toEqual([
      ["Reglerteknik I, Laboration", "canvas:1", "102162, Ångström"],
      ["Finansiella derivat, Föreläsning", "canvas:2", "102162, Ångström"],
      ["Okänd kurs, Lektion", "okand-kurs", "102162, Ångström"],
    ]);
    expect(r.courses).toEqual([{ externalId: "okand-kurs", name: "Okänd kurs", shortName: "Okänd kurs", code: null, term: null, htmlUrl: null }]);
  });

  it("refuses feeds from other hosts and reports the scope as failed", async () => {
    const p = new TimeEditIcsProvider(["https://evil.example/x.ics"], fetchImpl);
    const r = await p.fetch({ now: new Date(), knownCourses: [], aliases: new Map() });
    expect(r.scopes[0]).toMatchObject({ status: "error", items: [] });
    expect(r.courses).toBeUndefined();
  });
});
