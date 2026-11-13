import { addDays, dateKey, mondayOf, parseKey, zonedToUtc } from "../time";
import type { ItemInput, ProviderContext, ProviderResult, SyncProvider } from "./types";

/**
 * Fake but realistic data so the app can be tried without a token.
 * `variant` 0 is the starting state; variant 1 is "a few days later" with a moved deadline,
 * new files, a teacher comment and a lab sign-up, so the Radar has something to show.
 * All dates are relative to `now`, so the demo always looks current.
 */
export class DemoProvider implements SyncProvider {
  readonly id = "demo";
  readonly label = "Demo data";
  readonly variant: 0 | 1;
  /** Dates are laid out relative to this instant, so two runs at different times describe the same world. */
  private readonly anchor: Date | null;

  constructor(variant: 0 | 1 = 1, anchor: Date | null = null) {
    this.variant = variant;
    this.anchor = anchor;
  }

  async fetch(ctx: ProviderContext): Promise<ProviderResult> {
    const v1 = this.variant === 1;
    const today = dateKey(this.anchor ?? ctx.now);
    const at = (offsetDays: number, h: number, m = 0) => {
      const { year, month, day } = parseKey(addDays(today, offsetDays));
      return zonedToUtc(year, month, day, h, m);
    };
    const iso = (d: Date) => d.toISOString();

    const MEK = "mek2", EM = "em", KV = "kvant";
    const courses = [
      { externalId: MEK, name: "Mekanik II 1FA102 HT2026", shortName: "Mekanik II", code: "1FA102", term: "HT2026", htmlUrl: null, teachers: ["Anna Lindqvist"] },
      { externalId: EM, name: "Elektromagnetism 1FA514 HT2026", shortName: "Elektromagnetism", code: "1FA514", term: "HT2026", htmlUrl: null, teachers: ["Maria Öberg", "Johan Ek"] },
      { externalId: KV, name: "Kvantfysik 1FA521 HT2026", shortName: "Kvantfysik", code: "1FA521", term: "HT2026", htmlUrl: null, teachers: ["Erik Sandberg"] },
    ];

    const sub = (state: string, extra: Record<string, unknown> = {}) => ({
      submission_state: state, submitted_at: null, grade: null, score: null, late: false, missing: false, excused: false, ...extra,
    });
    const assignment = (id: string, course: string, title: string, due: Date, body: string, fields: Record<string, unknown>): ItemInput => ({
      kind: "assignment", externalId: id, courseRef: course, title, htmlUrl: null, dueAt: due, bodyText: body,
      fields: { points_possible: 10, submission_types: "online_upload", is_quiz: false, ...fields },
    });

    const assignments: ItemInput[] = [
      assignment("a-kv-lab3", KV, "Lab 3: rapport (Franck–Hertz)", v1 ? at(6, 23, 59) : at(2, 23, 59),
        "Rapporten lämnas in som PDF. Max 6 sidor. Använd mallen i modulen Laborationer.", sub("unsubmitted")),
      assignment("a-mek-inl4", MEK, "Inlämningsuppgift 4: Lagrangemekanik", at(1, 17, 0),
        "Uppgifterna 4.1–4.6 i kompendiet. Handskrivet går bra, skanna som PDF.", sub("unsubmitted")),
      assignment("a-mek-inl3", MEK, "Inlämningsuppgift 3: Stela kroppar", at(-2, 17, 0),
        "Uppgifterna 3.1–3.5.", sub("unsubmitted", { missing: true })),
      assignment("a-em-lab2", EM, "Lab 2: rapport (Induktion)", at(-9, 23, 59), "Rapport enligt labb-PM.",
        v1 ? sub("graded", { submitted_at: iso(at(-10, 21, 14)), grade: "G", score: 10 })
           : sub("submitted", { submitted_at: iso(at(-10, 21, 14)) })),
      assignment("a-em-proj", EM, "Projektplan: antenndesign", at(9, 12, 0),
        "En sida: mål, metod, tidsplan och arbetsfördelning i gruppen.", sub("unsubmitted")),
      assignment("a-kv-prelab4", KV, "Pre-lab 4: Zeemaneffekten", at(8, 8, 0), "Förberedelseuppgifter 1–3 inför Lab 4.", sub("unsubmitted")),
      assignment("a-kv-lab2", KV, "Lab 2: rapport (Spektrum)", at(-20, 23, 59), "Rapport.", sub("graded", { submitted_at: iso(at(-21, 20, 0)), grade: "G", score: 10 })),
      assignment("a-kv-quiz", KV, "Dugga 2: Väteatomen", at(4, 10, 0), "Webbdugga, 45 minuter.", { ...sub("unsubmitted"), is_quiz: true }),
    ];
    if (v1) {
      assignments.push(assignment("a-mek-inl5", MEK, "Inlämningsuppgift 5: Små svängningar", at(12, 17, 0), "Uppgifterna 5.1–5.4.", sub("unsubmitted")));
    }

    const announcements: ItemInput[] = [
      { kind: "announcement", externalId: "n-mek-1", courseRef: MEK, title: "Välkommen till Mekanik II", htmlUrl: null,
        bodyText: "Kursen börjar måndag. Kurs-PM finns under Filer.", fields: { posted_at: iso(at(-20, 9, 0)), author: "Anna Lindqvist" } },
    ];
    if (v1) {
      announcements.push(
        { kind: "announcement", externalId: "n-kv-2", courseRef: KV, title: "Anmälan till labbgrupper, Lab 4", htmlUrl: null,
          bodyText: `Anmäl dig till en labbgrupp senast ${at(3, 17, 0).toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm", weekday: "long", day: "numeric", month: "long" })} kl. 17.00. Anmälan görs under Personer → Grupper. Den som inte anmält sig får ingen labbtid.`,
          fields: { posted_at: iso(at(0, 8, 12)), author: "Erik Sandberg" } },
        { kind: "announcement", externalId: "n-em-3", courseRef: EM, title: "Lösningsförslag till räkneövning 6", htmlUrl: null,
          bodyText: "Lösningsförslagen ligger nu under Filer → Räkneövningar.", fields: { posted_at: iso(at(-1, 15, 40)), author: "Maria Öberg" } },
      );
    }

    const file = (id: string, course: string, name: string, size: number, modified: Date): ItemInput => ({
      kind: "file", externalId: id, courseRef: course, title: name, htmlUrl: null,
      fields: { size, content_type: "application/pdf", modified_at: iso(modified) },
    });
    const files: ItemInput[] = [
      file("f-kv-1", KV, "Föreläsning_7_Väteatomen.pdf", 2_340_112, at(-6, 14, 0)),
      file("f-mek-pm", MEK, "Kurs-PM_Mekanik_II.pdf", v1 ? 412_880 : 398_114, v1 ? at(-1, 11, 5) : at(-21, 10, 0)),
      file("f-em-1", EM, "Labb-PM_Lab2.pdf", 880_230, at(-18, 9, 0)),
    ];
    if (v1) {
      files.push(file("f-kv-2", KV, "Övningar_v46.pdf", 311_907, at(0, 7, 55)), file("f-em-2", EM, "Lösningar_RÖ6.pdf", 198_441, at(-1, 15, 35)));
    }

    const comments: ItemInput[] = v1
      ? [{ kind: "submission_comment", externalId: "c-em-1", courseRef: EM, title: "Lab 2: rapport (Induktion)", htmlUrl: null,
           bodyText: "Bra rapport! Felanalysen i avsnitt 4 kunde vara tydligare, men godkänt.",
           fields: { author: "Maria Öberg", created_at: iso(at(-1, 16, 2)) } }]
      : [];

    const modules: ItemInput[] = [
      { kind: "module", externalId: "m-kv-lab", courseRef: KV, title: "Laborationer", htmlUrl: null,
        fields: { position: 3, items: ["Lab 1: Fotoelektrisk effekt", "Lab 2: Spektrum", "Lab 3: Franck–Hertz", ...(v1 ? ["Lab 4: Zeemaneffekten"] : [])] } },
    ];

    const booking: ItemInput[] = v1
      ? [{ kind: "appointment_group", externalId: "ag-kv-lab4", courseRef: KV, title: "Labbtider Lab 4: Zeemaneffekten", htmlUrl: null,
           startAt: at(10, 8, 15), endAt: at(12, 17, 0), location: "Ångström 6K1113",
           fields: { participants_per_appointment: 2, max_appointments_per_participant: 1, requiring_action: true, reserved_times: 0 } }]
      : [];

    // Weekly timetable, three weeks either side of now. [weekday 0=Mon, start h, m, end h, m]
    const timetable: [string, string, string, number, number, number, number, number, string][] = [
      [MEK, "Föreläsning", "Mekanik II", 0, 10, 15, 12, 0, "Ångström 10132 Häggsalen"],
      [KV, "Föreläsning", "Kvantfysik", 0, 13, 15, 15, 0, "Ångström 2001"],
      [EM, "Föreläsning", "Elektromagnetism", 1, 8, 15, 10, 0, "Ångström 4001"],
      [MEK, "Räkneövning", "Mekanik II", 2, 13, 15, 15, 0, "Ångström 2003"],
      [EM, "Föreläsning", "Elektromagnetism", 3, 10, 15, 12, 0, "Ångström 4001"],
      [KV, "Laboration", "Kvantfysik", 3, 13, 15, 17, 0, "Ångström 6K1113"],
      [KV, "Föreläsning", "Kvantfysik", 4, 10, 15, 12, 0, "Ångström 2001"],
    ];
    const schedule: ItemInput[] = [];
    const monday = mondayOf(today);
    for (let w = -1; w <= 3; w++) {
      for (const [course, type, name, wd, sh, sm, eh, em, room] of timetable) {
        const key = addDays(monday, w * 7 + wd);
        const { year, month, day } = parseKey(key);
        // In variant 1, next week's Thursday EM lecture has moved room.
        const moved = v1 && w === 1 && course === EM && wd === 3;
        schedule.push({
          kind: "schedule_event", externalId: `te-${course}-${key}-${sh}`, courseRef: course,
          title: `${name}, ${type}`, htmlUrl: null,
          startAt: zonedToUtc(year, month, day, sh, sm), endAt: zonedToUtc(year, month, day, eh, em),
          location: moved ? "Ångström 80127 Siegbahnsalen" : room,
        });
      }
    }
    schedule.push({
      kind: "schedule_event", externalId: "te-mek-tenta", courseRef: MEK, title: "Mekanik II, Tentamen", htmlUrl: null,
      startAt: at(29, 8, 0), endAt: at(29, 13, 0), location: "Bergsbrunnagatan 15, Sal 1",
    });

    const ok = (key: string, items: ItemInput[], trackRemovals: "all" | "future" | "none" = "all") =>
      ({ key, status: "ok" as const, trackRemovals, items });

    return {
      courses,
      scopes: [
        ok("assignments", assignments),
        ok("announcements", announcements, "none"),
        ok("files", files),
        ok("comments", comments, "none"),
        ok("modules", modules),
        ok("appointment_groups", booking, "future"),
        ok("schedule", schedule, "future"),
      ],
      requests: 0,
    };
  }
}
