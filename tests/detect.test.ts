import { describe, expect, it } from "vitest";
import { parseCapture } from "../src/lib/capture/parse";
import { extractDates } from "../src/lib/detect/dates";
import { extractCandidates, splitSentences } from "../src/lib/detect/extract";

// Thursday 12 November 2026, 10:00 in Stockholm
const ref = new Date("2026-11-12T09:00:00Z");
const one = (text: string, shorthand = false) => {
  const [m, ...rest] = extractDates(text, ref, { shorthand });
  expect(rest, `expected exactly one date in "${text}"`).toEqual([]);
  return m ? `${m.date}${m.time ? ` ${m.time}` : ""}${m.precision === "week" ? " (week)" : ""}` : null;
};

describe("date extraction: formats", () => {
  it.each([
    ["Lämnas in 2026-11-14", "2026-11-14"],
    ["fre 14/11", "2026-11-14"],
    ["senast 14/11-26", "2026-11-14"],
    ["den 14/11 2026", "2026-11-14"],
    ["senast 15 november kl. 23.59", "2026-11-15 23:59"],
    ["senast den 15:e nov kl 17", "2026-11-15 17:00"],
    ["fredag 20 november 13:15", "2026-11-20 13:15"],
    ["by November 20th", "2026-11-20"],
    ["on Fri, Nov 20, 2026 at 5 pm", "2026-11-20 17:00"],
    ["the 3rd of December at 10:00", "2026-12-03 10:00"],
    ["no later than 1 Dec", "2026-12-01"],
    ["scheduled for Wednesday, October 28.", "2026-10-28"],
    ["Fri 27 Nov 17:00.", "2026-11-27 17:00"],
    ["klockan 08.00 den 14 januari", "2027-01-14 08:00"],
    ["Deadline 23:59 on 30 November", "2026-11-30 23:59"],
    ["1 maj", "2027-05-01"],
  ])("%s -> %s", (text, expected) => expect(one(text)).toBe(expected));
});

describe("date extraction: relative and week-based", () => {
  it.each([
    ["Anmäl dig på fredag", "2026-11-13"],
    ["by Monday at 12:00", "2026-11-16 12:00"],
    ["senast torsdag", "2026-11-12"], // written on a Thursday: that same day
    ["imorgon kl 9", "2026-11-13 09:00"],
    ["tomorrow", "2026-11-13"],
    ["idag 17:00", "2026-11-12 17:00"],
    ["before week 47", "2026-11-16 (week)"],
    ["under v. 49", "2026-11-30 (week)"],
    ["vecka 2", "2027-01-11 (week)"],
  ])("%s -> %s", (text, expected) => expect(one(text)).toBe(expected));

  it("resolves a date without a year to the occurrence nearest the reference date", () => {
    expect(one("10 januari")).toBe("2027-01-10"); // next January, not last
    expect(one("3 oktober")).toBe("2026-10-03"); // six weeks ago is still "this" October
    expect(extractDates("14/11", new Date("2027-01-05T09:00:00Z"))[0].date).toBe("2026-11-14");
  });

  it("uses the reference date for relative words", () => {
    // an announcement posted Monday 2 Nov saying "on Friday" means 6 Nov
    expect(extractDates("Anmälan stänger på fredag", new Date("2026-11-02T08:00:00Z"))[0].date).toBe("2026-11-06");
  });
});

describe("date extraction: what it must not do", () => {
  it("finds nothing in text without dates", () => {
    for (const t of ["a time constant of 1/2s", "The exam is graded fail/3/4/5.", "Betyg U/3/4/5", "Kapitel 14 och uppgift 3.2", "Sal 2003, Ångström", "Max 6 sidor, 10 poäng", "Friday feeling", "Du får 2.5 hp", "version 2.1 av labb-PM"]) {
      expect(extractDates(t, ref).filter((m) => !/friday/i.test(m.text)), t).toEqual([]);
    }
  });

  it("rejects impossible dates", () => {
    expect(extractDates("31/2 eller 2026-13-01 eller 30 februari", ref)).toEqual([]);
  });

  it("does not treat short weekday names as dates in running text", () => {
    expect(extractDates("Vi ses i sal sun eller mon", ref)).toEqual([]);
  });

  it("finds several dates and reports where they are", () => {
    const text = "Lab 1 den 17/11 och Lab 2 den 24/11 kl. 13.15.";
    const ms = extractDates(text, ref);
    expect(ms.map((m) => [m.date, m.time])).toEqual([["2026-11-17", null], ["2026-11-24", "13:15"]]);
    expect(text.slice(ms[1].index, ms[1].index + ms[1].length)).toBe("24/11 kl. 13.15");
  });
});

describe("hidden-deadline detector", () => {
  const find = (text: string, title?: string) =>
    extractCandidates(text, { ref, title, notBefore: ref }).map((c) => `${c.kind} ${c.date}${c.time ? ` ${c.time}` : ""}`);

  it("keeps sentences together around abbreviations", () => {
    expect(splitSentences("Anmäl dig senast fre 14/11 kl. 17.00. Labben går v. 47 i sal 2003.\n- Ta med labbrock")).toEqual([
      "Anmäl dig senast fre 14/11 kl. 17.00.",
      "Labben går v. 47 i sal 2003.",
      "Ta med labbrock",
    ]);
  });

  it("finds sign-ups, bookings, exams and hand-ins in Swedish and English", () => {
    expect(find("Anmäl dig till en labbgrupp senast fredag 13 november kl. 17.00.")).toEqual(["signup 2026-11-13 17:00"]);
    expect(find("Please sign up for a lab group by Friday.")).toEqual(["signup 2026-11-13"]);
    expect(find("Choose your project group before week 47.")).toEqual(["signup 2026-11-16"]);
    expect(find("Boka labbtid i kalendern senast 20/11.")).toEqual(["booking 2026-11-20"]);
    expect(find("Anmälan till omtentan görs i Ladok senast 2026-12-01.")).toEqual(["signup 2026-12-01"]);
    expect(find("Tentamen äger rum 14 januari kl. 08.00 i Bergsbrunnagatan.")).toEqual(["exam 2027-01-14 08:00"]);
    expect(find("Rapporten ska lämnas in senast den 30 november kl 23.59.")).toEqual(["deadline 2026-11-30 23:59"]);
    expect(find("The project plan is due November 24 at 12:00.")).toEqual(["deadline 2026-11-24 12:00"]);
  });

  it("ignores dates that carry no obligation", () => {
    expect(find("The output is the sum of both voltages due to the two inputs, see the lab on 20 November.")).toEqual([]); // "due to" is not a deadline
    expect(find("Föreläsning 7 hålls 17/11 i sal 2001. Kapitel 5 behandlas.")).toEqual([]);
    expect(find("Lösningsförslag publicerades 10 november.")).toEqual([]);
  });

  it("uses the title when the sentence itself has only the date", () => {
    expect(find("Sista dag är 20 november.", "Anmälan till labbgrupper")).toEqual(["signup 2026-11-20"]);
    const strong = extractCandidates("Anmäl dig senast 20 november.", { ref })[0].confidence;
    const weak = extractCandidates("Mer info kommer 20 november.", { ref, title: "Anmälan till labbgrupper" })[0].confidence;
    expect(weak).toBeLessThan(strong);
  });

  it("picks the date that follows the action word", () => {
    expect(find("Labben går 17/11, anmäl dig senast 14/11.")).toEqual(["signup 2026-11-14"]);
  });

  it("ignores 'on Friday' when it is unknown when the text was written", () => {
    const text = "Like before, you can book Friday tutorial (T2) via this link. Book a slot no later than 20 November.";
    expect(extractCandidates(text, { ref, refIsKnown: false }).map((c) => c.date)).toEqual(["2026-11-20"]);
    expect(extractCandidates(text, { ref, refIsKnown: true }).map((c) => c.date)).toEqual(["2026-11-13", "2026-11-20"]);
  });

  it("drops past dates, the item's own deadline, and duplicates", () => {
    expect(find("Anmäl dig senast 2 november.")).toEqual([]);
    expect(extractCandidates("Lämnas in senast 30 november.", { ref, ownDate: "2026-11-30" })).toEqual([]);
    expect(find("Anmäl dig senast 20/11. Glöm inte: anmälan stänger 20 november!")).toEqual(["signup 2026-11-20"]);
  });

  it("keeps the sentence as evidence and stores date-only deadlines at 23:59 local time", () => {
    const [c] = extractCandidates("Hej!\nAnmäl dig senast 20 november.\nMvh", { ref });
    expect(c.quote).toBe("Anmäl dig senast 20 november.");
    expect(c.hasTime).toBe(false);
    expect(c.dueAt.toISOString()).toBe("2026-11-20T22:59:00.000Z");
  });
});

describe("quick capture", () => {
  const courses = [
    { id: "canvas:1", shortName: "Reglerteknik I", code: "1RT490", nicknames: "regler, rt" },
    { id: "canvas:2", shortName: "Fasta tillståndets fysik F", code: "1TM013", nicknames: "fysik3" },
    { id: "canvas:3", shortName: "Financial Derivatives", code: "1MA209", nicknames: "" },
  ];
  const cap = (s: string) => parseCapture(s, { now: ref, courses });

  it("parses the examples from the brief", () => {
    expect(cap("labbrapport fysik3 fre 17")).toEqual({ title: "Labbrapport", date: "2026-11-13", time: "17:00", courseId: "canvas:2", tags: [], kind: "task" });
    expect(cap("apply Ericsson summer internship by 1 dec #career")).toEqual({
      title: "Apply Ericsson summer internship", date: "2026-12-01", time: null, courseId: null, tags: ["career"], kind: "task",
    });
  });

  it("reads 'weekday + number' as a date when it fits, otherwise as an hour", () => {
    expect(cap("möte fre 13")).toMatchObject({ date: "2026-11-13", time: null }); // Friday is the 13th
    expect(cap("möte mån 9")).toMatchObject({ date: "2026-11-16", time: "09:00" });
  });

  it("reads a bare number at the end of the line as the hour", () => {
    expect(cap("ring CSN imorgon 9")).toMatchObject({ title: "Ring CSN", date: "2026-11-13", time: "09:00" });
    expect(cap("plugga 24/11 14 #plugg")).toMatchObject({ title: "Plugga", date: "2026-11-24", time: "14:00", tags: ["plugg"] });
    expect(cap("läs imorgon 3 kapitel")).toMatchObject({ date: "2026-11-13", time: null }); // "3 kapitel" is not a time
  });

  it("understands dates, times, tags, course codes and @course", () => {
    expect(cap("plugga inför dugga imorgon 14:00 #plugg #viktigt")).toMatchObject({ title: "Plugga inför dugga", date: "2026-11-13", time: "14:00", tags: ["plugg", "viktigt"] });
    expect(cap("inlämning 1RT490 24/11 kl 23.59")).toMatchObject({ title: "Inlämning", date: "2026-11-24", time: "23:59", courseId: "canvas:1" });
    expect(cap("läs kapitel 4 @regler")).toMatchObject({ title: "Läs kapitel 4", courseId: "canvas:1", date: null });
    expect(cap("financial quiz på måndag")).toMatchObject({ title: "Financial quiz", courseId: "canvas:3", date: "2026-11-16" });
  });

  it("leaves plain text alone and flags sign-ups", () => {
    expect(cap("köp ny labbrock")).toEqual({ title: "Köp ny labbrock", date: null, time: null, courseId: null, tags: [], kind: "task" });
    expect(cap("anmäl mig till labbgrupp senast fredag").kind).toBe("signup");
  });
});
