import { describe, expect, it } from "vitest";
import { addDays, dateKey, fmtTime, isoWeek, minutesOfDay, mondayOf, startOfDay, weekday, zonedToUtc } from "../src/lib/time";

describe("Europe/Stockholm time", () => {
  it("converts winter and summer wall time to UTC", () => {
    expect(zonedToUtc(2026, 11, 14, 23, 59).toISOString()).toBe("2026-11-14T22:59:00.000Z"); // CET, +1
    expect(zonedToUtc(2026, 6, 1, 8, 15).toISOString()).toBe("2026-06-01T06:15:00.000Z"); // CEST, +2
  });

  it("handles both sides of the autumn DST change (25 Oct 2026)", () => {
    expect(zonedToUtc(2026, 10, 24, 12).toISOString()).toBe("2026-10-24T10:00:00.000Z");
    expect(zonedToUtc(2026, 10, 25, 12).toISOString()).toBe("2026-10-25T11:00:00.000Z");
    // that Sunday is 25 hours long
    expect(startOfDay("2026-10-26").getTime() - startOfDay("2026-10-25").getTime()).toBe(25 * 3_600_000);
  });

  it("handles the spring DST change (29 Mar 2026)", () => {
    expect(zonedToUtc(2026, 3, 29, 12).toISOString()).toBe("2026-03-29T10:00:00.000Z");
    expect(startOfDay("2026-03-30").getTime() - startOfDay("2026-03-29").getTime()).toBe(23 * 3_600_000);
  });

  it("assigns a 23:59 deadline to the right local day", () => {
    const due = new Date("2026-11-14T22:59:00Z"); // 23:59 in Stockholm
    expect(dateKey(due)).toBe("2026-11-14");
    expect(fmtTime(due)).toBe("23:59");
    expect(minutesOfDay(due)).toBe(23 * 60 + 59);
    // 23:30 UTC in summer is already the next day locally
    expect(dateKey(new Date("2026-06-01T23:30:00Z"))).toBe("2026-06-02");
  });

  it("does date-key arithmetic across month, year and DST boundaries", () => {
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekday("2026-11-12")).toBe(4); // Thursday
    expect(mondayOf("2026-11-15")).toBe("2026-11-09"); // Sunday belongs to the week that started Monday
  });

  it("computes ISO week numbers", () => {
    expect(isoWeek("2026-11-12")).toEqual({ year: 2026, week: 46 });
    expect(isoWeek("2027-01-01")).toEqual({ year: 2026, week: 53 });
    expect(isoWeek("2024-12-30")).toEqual({ year: 2025, week: 1 });
  });
});
