import { describe, expect, it } from "vitest";
import { buildComparable, diffComparable, diffScope, normalize, type Existing } from "../src/lib/sync/diff";
import type { ItemInput } from "../src/lib/providers/types";
import { triage } from "../src/lib/radar/triage";
import { htmlToText } from "../src/lib/text";

const now = new Date("2026-11-12T09:00:00Z");
const lab: ItemInput = {
  kind: "assignment", externalId: "7", courseRef: "42", title: "Lab 3 report", htmlUrl: "https://x/7",
  dueAt: new Date("2026-11-14T22:59:00Z"), bodyText: "Max 6 pages", fields: { points_possible: 10, submission_state: "unsubmitted", grade: null },
};
const asExisting = (i: ItemInput, extra: Partial<Existing> = {}): Existing => {
  const n = normalize("canvas", "s", i);
  return { id: n.id, hash: n.hash, comparable: n.comparable, deletedAt: null, when: n.startAt ?? n.dueAt, ...extra };
};

describe("normalize", () => {
  it("builds stable ids and course references", () => {
    const n = normalize("canvas", "course:42:assignments", lab);
    expect(n.id).toBe("canvas:assignment:7");
    expect(n.courseId).toBe("canvas:42");
    expect(n.scope).toBe("canvas|course:42:assignments");
    expect(normalize("timeedit", "feed:0", { ...lab, courseRef: "canvas:42" }).courseId).toBe("canvas:42");
  });

  it("hashes equal content equally, regardless of key order, null fields or raw payload", () => {
    const a = normalize("canvas", "s", lab);
    const b = normalize("canvas", "s", { ...lab, raw: { updated_at: "later" }, location: null, fields: { grade: null, submission_state: "unsubmitted", points_possible: 10 } });
    expect(a.hash).toBe(b.hash);
    expect(buildComparable(lab)).not.toHaveProperty("grade");
  });
});

describe("diffComparable", () => {
  it("reports each changed field with before and after", () => {
    const moved = { ...lab, dueAt: new Date("2026-11-18T22:59:00Z"), fields: { ...lab.fields, grade: "G" } };
    expect(diffComparable(buildComparable(lab), buildComparable(moved))).toEqual([
      { field: "due_at", before: "2026-11-14T22:59:00.000Z", after: "2026-11-18T22:59:00.000Z" },
      { field: "grade", before: null, after: "G" },
    ]);
  });
});

describe("diffScope", () => {
  const other: ItemInput = { ...lab, externalId: "8", title: "Problem set 4" };

  it("is empty when nothing changed (idempotent)", () => {
    const d = diffScope([asExisting(lab), asExisting(other)], [normalize("canvas", "s", lab), normalize("canvas", "s", other)], { trackRemovals: "all", now });
    expect([d.created.length, d.updated.length, d.removed.length, d.unchanged.length]).toEqual([0, 0, 0, 2]);
  });

  it("detects added, updated and removed items", () => {
    const moved = { ...lab, dueAt: new Date("2026-11-18T22:59:00Z") };
    const fresh: ItemInput = { ...lab, externalId: "9", title: "Lab 4 report" };
    const d = diffScope([asExisting(lab), asExisting(other)], [normalize("canvas", "s", moved), normalize("canvas", "s", fresh)], { trackRemovals: "all", now });
    expect(d.created.map((x) => x.id)).toEqual(["canvas:assignment:9"]);
    expect(d.updated.map((x) => x.diffs.map((f) => f.field))).toEqual([["due_at"]]);
    expect(d.removed.map((x) => x.id)).toEqual(["canvas:assignment:8"]);
  });

  it("never infers removals for windowed scopes", () => {
    expect(diffScope([asExisting(lab)], [], { trackRemovals: "none", now }).removed).toEqual([]);
  });

  it("only trusts removals of future items for rolling feeds", () => {
    const ev = (id: string, start: string): ItemInput => ({ kind: "schedule_event", externalId: id, title: "Lecture", htmlUrl: null, startAt: new Date(start) });
    const d = diffScope([asExisting(ev("past", "2026-11-01T09:00:00Z")), asExisting(ev("future", "2026-11-20T09:00:00Z"))], [], { trackRemovals: "future", now });
    expect(d.removed.map((x) => x.id)).toEqual(["canvas:schedule_event:future"]);
  });

  it("treats a removed item that comes back as new, and does not remove it twice", () => {
    const gone = asExisting(lab, { deletedAt: new Date("2026-11-10T00:00:00Z") });
    expect(diffScope([gone], [normalize("canvas", "s", lab)], { trackRemovals: "all", now }).created).toHaveLength(1);
    expect(diffScope([gone], [], { trackRemovals: "all", now }).removed).toEqual([]);
  });

  it("collapses duplicate ids within one fetch", () => {
    const d = diffScope([], [normalize("canvas", "s", lab), normalize("canvas", "s", { ...lab, title: "Lab 3 report v2" })], { trackRemovals: "all", now });
    expect(d.created.map((x) => x.title)).toEqual(["Lab 3 report v2"]);
  });
});

describe("triage", () => {
  const base = { now, title: "x", diffs: [], comparable: {} };

  it("flags a moved deadline on unsubmitted work, but not on handed-in work", () => {
    const diffs = [{ field: "due_at", before: "2026-11-14T22:59:00.000Z", after: "2026-11-18T22:59:00.000Z" }];
    expect(triage({ ...base, type: "updated", kind: "assignment", diffs, comparable: { submission_state: "unsubmitted" } })).toBe("action");
    expect(triage({ ...base, type: "updated", kind: "assignment", diffs, comparable: { submission_state: "graded" } })).toBe("fyi");
  });

  it("flags new assignments with a future deadline, teacher comments and bookable lab slots", () => {
    expect(triage({ ...base, type: "added", kind: "assignment", comparable: { due_at: "2026-11-20T10:00:00.000Z" } })).toBe("action");
    expect(triage({ ...base, type: "added", kind: "assignment", comparable: { due_at: "2026-10-01T10:00:00.000Z" } })).toBe("fyi");
    expect(triage({ ...base, type: "added", kind: "submission_comment" })).toBe("action");
    expect(triage({ ...base, type: "added", kind: "appointment_group" })).toBe("action");
  });

  it("flags sign-up announcements in Swedish and English, and leaves the rest as FYI", () => {
    const ann = (title: string, body: string) => triage({ ...base, type: "added", kind: "announcement", title, comparable: { body } });
    expect(ann("Labbgrupper", "Anmäl dig senast fredag kl. 17.00")).toBe("action");
    expect(ann("Lab groups", "Please sign up for a lab group before week 45")).toBe("action");
    expect(ann("Omtenta", "Tentamensanmälan öppnar i Ladok")).toBe("action");
    expect(ann("Lösningsförslag", "Lösningarna ligger nu under Filer")).toBe("fyi");
    expect(triage({ ...base, type: "added", kind: "file", title: "Anmälan.pdf" })).toBe("fyi");
  });

  it("flags schedule changes only when they are close", () => {
    const diffs = [{ field: "location", before: "A", after: "B" }];
    expect(triage({ ...base, type: "updated", kind: "schedule_event", diffs, comparable: { start_at: "2026-11-16T09:15:00.000Z" } })).toBe("action");
    expect(triage({ ...base, type: "updated", kind: "schedule_event", diffs, comparable: { start_at: "2027-01-20T09:15:00.000Z" } })).toBe("fyi");
  });
});

describe("htmlToText", () => {
  it("turns Canvas rich text into readable plain text", () => {
    expect(htmlToText('<p>Anm&auml;l dig <strong>senast</strong>&nbsp;fre 14/11</p><ul><li>Grupp A</li><li>Grupp B</li></ul><script>x()</script>'))
      .toBe("Anmäl dig senast fre 14/11\n\n- Grupp A\n- Grupp B");
    expect(htmlToText("")).toBeNull();
    expect(htmlToText("<p> </p>")).toBeNull();
  });
});
