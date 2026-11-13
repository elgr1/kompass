import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Candidate } from "../detect/extract";
import { dueFromMention } from "../detect/extract";
import { isDateKey } from "../time";

/**
 * Optional second pass for messy text the rules cannot read (tables, run-on sentences).
 *
 * Off unless BOTH `LLM_EXTRACTION_ENABLED=true` and `ANTHROPIC_API_KEY` are set in `.env`.
 * Nothing is ever sent automatically: the user picks the texts on a preview page that shows
 * exactly what will leave the machine. Results are suggestions like any other, and a quote
 * that does not literally occur in the source text is thrown away.
 */

export const llmEnabled = () => process.env.LLM_EXTRACTION_ENABLED === "true" && Boolean(process.env.ANTHROPIC_API_KEY?.trim());
export const llmModel = () => process.env.LLM_MODEL?.trim() || "claude-opus-5-5";
/** Longer texts are not offered for sending (they are never cut silently). */
export const LLM_MAX_CHARS = 40_000;

const Found = z.object({
  deadlines: z.array(
    z.object({
      kind: z.enum(["signup", "booking", "exam", "deadline"]),
      date: z.string(),
      time: z.string().nullable(),
      quote: z.string(),
    }),
  ),
});

export type LlmSource = { title: string; text: string; posted: string | null };

/** The exact request content. Shown to the user before anything is sent. */
export function buildPrompt(source: LlmSource, today: string): { system: string; user: string } {
  return {
    system:
      "You read course material for a university student in Sweden (text in Swedish or English) and list things the student must act on by a date: " +
      "sign-ups (anmälan, group or lab-group choice), bookings of lab or presentation slots, hand-in deadlines, and exams or exam registration. " +
      "Ignore lecture times, past events, and dates that carry no obligation for the student. " +
      "For each item give: kind; date as YYYY-MM-DD; time as HH:MM in 24-hour form, or null when the text gives none; and quote, the sentence or table row from the text that states it, copied exactly, character for character. " +
      "Resolve dates without a year, weekdays and week numbers (Swedish ISO weeks) relative to when the text was posted. If nothing qualifies, return an empty list.",
    user: `Today: ${today}\nPosted: ${source.posted ?? "unknown"}\nTitle: ${source.title}\n\n<text>\n${source.text}\n</text>`,
  };
}

type CreateFn = (req: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming) => Promise<Pick<Anthropic.Beta.Messages.BetaMessage, "stop_reason" | "content">>;

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export async function extractWithClaude(source: LlmSource, opts: { today: string; create?: CreateFn }): Promise<Candidate[]> {
  if (source.text.length > LLM_MAX_CHARS) throw new Error("Text is too long to send");
  const prompt = buildPrompt(source, opts.today);
  const create: CreateFn = opts.create ?? ((req) => new Anthropic().beta.messages.create(req));
  const response = await create({
    model: llmModel(),
    max_tokens: 16000,
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
    // Extraction from a short text is routine work; thinking stays on (it cannot be turned off on this model).
    output_config: { effort: "low", format: zodOutputFormat(Found) },
    // If the model declines, let the API retry on its default fallback instead of failing the batch.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined to read this text");
  if (response.stop_reason === "max_tokens") throw new Error("The answer was cut off");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let parsed: z.infer<typeof Found>;
  try {
    parsed = Found.parse(JSON.parse(text));
  } catch {
    throw new Error("The model's answer was not in the expected format");
  }

  const haystack = squash(source.text);
  const out = new Map<string, Candidate>();
  for (const d of parsed.deadlines) {
    const time = d.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(d.time) ? d.time : null;
    const quote = d.quote.replace(/\s+/g, " ").trim();
    // Guard against invention: the evidence must really be in the text, and the date must be real and not past.
    if (!isDateKey(d.date) || d.date < opts.today || quote.length < 8 || !haystack.includes(squash(quote))) continue;
    out.set(`${d.date}|${time ?? ""}`, { kind: d.kind, quote: quote.slice(0, 320), date: d.date, time, precision: "day", ...dueFromMention({ date: d.date, time, precision: "day" }), confidence: 60 });
  }
  return [...out.values()].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}
