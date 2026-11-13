import { afterEach, describe, expect, it } from "vitest";
import { createDb } from "../src/lib/db/index";
import { courses, items, suggestions } from "../src/lib/db/schema";
import { buildPrompt, extractWithClaude, llmEnabled, LLM_MAX_CHARS } from "../src/lib/llm/extract";
import { llmCandidates, runLlm } from "../src/lib/llm/run";

const text = "Hej alla!\nLabb 4 körs v. 48. Grupp A: mån 23/11, grupp B: ons 25/11.\nLista för gruppval ligger ute t.o.m. 19/11 kl 12.\nVi ses!";
const source = { title: "Info om Lab 4", text, posted: "2026-11-10" };
const reply = (deadlines: unknown[], stop_reason = "end_turn") => async () => ({ stop_reason, content: [{ type: "text", text: JSON.stringify({ deadlines }) }] }) as never;

describe("optional Claude extraction", () => {
  afterEach(() => { delete process.env.LLM_EXTRACTION_ENABLED; delete process.env.ANTHROPIC_API_KEY; });

  it("is off unless both the switch and a key are set", () => {
    expect(llmEnabled()).toBe(false);
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(llmEnabled()).toBe(false);
    process.env.LLM_EXTRACTION_ENABLED = "true";
    expect(llmEnabled()).toBe(true);
  });

  it("sends exactly the previewed prompt: the title, the posting date and the text, nothing else", async () => {
    let seen: { system?: unknown; messages: { content: unknown }[]; model: string } | null = null;
    await extractWithClaude(source, { today: "2026-11-13", create: async (req) => { seen = req as never; return { stop_reason: "end_turn", content: [{ type: "text", text: '{"deadlines":[]}' }] } as never; } });
    const p = buildPrompt(source, "2026-11-13");
    expect(seen!.system).toBe(p.system);
    expect(seen!.messages).toEqual([{ role: "user", content: p.user }]);
    expect(p.user).toBe(`Today: 2026-11-13\nPosted: 2026-11-10\nTitle: Info om Lab 4\n\n<text>\n${text}\n</text>`);
    expect(seen!.model).toBe("claude-opus-5-5");
  });

  it("keeps answers whose quote is really in the text, and drops invented, past or malformed ones", async () => {
    const out = await extractWithClaude(source, {
      today: "2026-11-13",
      create: reply([
        { kind: "signup", date: "2026-11-19", time: "12:00", quote: "Lista för gruppval ligger ute  t.o.m. 19/11 kl 12." }, // whitespace differs: fine
        { kind: "deadline", date: "2026-11-30", time: null, quote: "Rapporten ska lämnas in senast 30 november." }, // not in the text
        { kind: "signup", date: "2026-11-01", time: null, quote: "Lista för gruppval ligger ute t.o.m. 19/11 kl 12." }, // in the past
        { kind: "exam", date: "25 november", time: "25:99", quote: "Grupp A: mån 23/11, grupp B: ons 25/11." }, // not a date
      ]),
    });
    expect(out.map((c) => [c.kind, c.date, c.time, c.hasTime])).toEqual([["signup", "2026-11-19", "12:00", true]]);
    expect(out[0].dueAt.toISOString()).toBe("2026-11-19T11:00:00.000Z");
  });

  it("fails clearly on a refusal, a cut-off answer, unexpected output or over-long text", async () => {
    await expect(extractWithClaude(source, { today: "2026-11-13", create: reply([], "refusal") })).rejects.toThrow("declined");
    await expect(extractWithClaude(source, { today: "2026-11-13", create: reply([], "max_tokens") })).rejects.toThrow("cut off");
    await expect(extractWithClaude(source, { today: "2026-11-13", create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Sure! Here you go" }] }) as never })).rejects.toThrow("expected format");
    await expect(extractWithClaude({ ...source, text: "x".repeat(LLM_MAX_CHARS + 1) }, { today: "2026-11-13", create: reply([]) })).rejects.toThrow("too long");
  });

  it("offers only recent, undetected, dated texts from visible courses, and stores results as AI-marked suggestions", async () => {
    const db = createDb(":memory:");
    const now = new Date("2026-11-13T09:00:00Z");
    for (const [id, hidden] of [["c1", false], ["c2", true]] as const) db.insert(courses).values({ id, provider: "canvas", externalId: id, name: id, shortName: id, color: "#000", hidden, firstSeenAt: now, lastSeenAt: now }).run();
    const item = (id: string, courseId: string, bodyText: string, posted: string) =>
      db.insert(items).values({ id, provider: "canvas", kind: "announcement", externalId: id, scope: "s", courseId, title: id, htmlUrl: `https://uppsala.instructure.com/${id}`, bodyText, fields: { posted_at: posted }, comparable: {}, hash: `h-${id}`, firstSeenAt: now, lastSeenAt: now, changedAt: now }).run();
    const pad = " Mer information kommer på föreläsningen.".repeat(6);
    item("messy", "c1", text + pad, "2026-11-10T08:00:00Z");
    item("nodates", "c1", "Välkomna till kursen." + pad, "2026-11-10T08:00:00Z");
    item("old", "c1", text + pad, "2026-06-01T08:00:00Z");
    item("hidden", "c2", text + pad, "2026-11-10T08:00:00Z");
    expect(llmCandidates(db, now).map((c) => c.id)).toEqual(["messy"]);

    const r = await runLlm(db, ["messy", "old"], now, async () => [{ kind: "signup", quote: "Lista för gruppval ligger ute t.o.m. 19/11 kl 12.", date: "2026-11-19", time: "12:00", precision: "day", dueAt: new Date("2026-11-19T11:00:00Z"), hasTime: true, confidence: 60 }]);
    expect(r).toEqual({ sent: 1, added: 1, errors: [] }); // "old" was not on offer, so it is not sent
    expect(db.select().from(suggestions).all()).toMatchObject([{ itemId: "messy", sourceLabel: "ai:announcement", status: "pending", kind: "signup" }]);
    expect(llmCandidates(db, now)).toEqual([]); // not offered again
  });
});
