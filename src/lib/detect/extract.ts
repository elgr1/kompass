import type { TaskKind } from "../db/schema";
import { truncate } from "../text";
import { parseKey, zonedToUtc } from "../time";
import { extractDates, type DateMention } from "./dates";

/**
 * Hidden-deadline detector, rule-based part. Pure: text in, candidates out.
 * A candidate is a sentence that contains BOTH a date and a word that signals
 * "you must do something" (sign up, book, hand in, exam...). Dates alone are ignored,
 * otherwise every lecture note would become a suggestion.
 */

export type Candidate = {
  kind: TaskKind;
  /** the sentence the date was found in, for showing as evidence */
  quote: string;
  date: string;
  time: string | null;
  precision: "day" | "week";
  dueAt: Date;
  hasTime: boolean;
  /** 0-100: how sure the rules are that this is something to act on */
  confidence: number;
};

// Order matters: "anmälan till tentamen senast..." is a sign-up, not an exam.
const KINDS: { kind: TaskKind; re: RegExp; weight: number }[] = [
  { kind: "signup", weight: 90, re: /anmäl|sign(?:ing)?[\s-]?up|registrer|\bregist(?:er|ration)|\benrol|gruppindelning|labbgrupp|gruppval|välj\p{L}*\s+(?:en\s+|din\s+)?(?:labb|projekt)?grupp|(?:choose|pick|select|join)\s+(?:a\s+|your\s+)?(?:lab\s+|project\s+)?group/iu },
  { kind: "booking", weight: 85, re: /(?<![\p{L}])boka|bokning|\bbook\s+(?:a|your|an)\b|\breserve\b|\btime\s?slot|labbtid/iu },
  { kind: "exam", weight: 70, re: /tentamen|(?<![\p{L}])tenta(?:n)?(?![\p{L}])|omtenta|(?<![\p{L}])dugga|\bexam(?:ination)?\b|re-?exam|kontrollskrivning/iu },
  { kind: "deadline", weight: 75, re: /senast|deadline|sista\s+dag|lämna\p{L}*\s+in|inlämn|\bhand(?:ed)?\s+in\b|\bsubmi(?:t|ssion)|\bdue\b(?!\s+to\b)|no\s+later\s+than|at\s+the\s+latest/iu },
  { kind: "deadline", weight: 45, re: /(?<![\p{L}])innan(?![\p{L}])|(?<![\p{L}])före(?![\p{L}])|\bbefore\b|\buntil\b|(?<![\p{L}])till\s+och\s+med/iu },
];

function classify(text: string): { kind: TaskKind; weight: number; index: number } | null {
  for (const k of KINDS) {
    const m = text.match(k.re);
    if (m) return { kind: k.kind, weight: k.weight, index: m.index ?? 0 };
  }
  return null;
}

/** Sentence-ish units. Does not split after "kl." or "v." because only an uppercase letter starts a new one. */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-ZÅÄÖ"“(])/u))
    .map((s) => s.replace(/^[-•*\s]+/, "").trim())
    .filter((s) => s.length > 0);
}

export function dueFromMention(m: Pick<DateMention, "date" | "time" | "precision">): { dueAt: Date; hasTime: boolean } {
  const { year, month, day } = parseKey(m.date);
  if (m.time) {
    const [h, min] = m.time.split(":").map(Number);
    return { dueAt: zonedToUtc(year, month, day, h, min), hasTime: true };
  }
  return { dueAt: zonedToUtc(year, month, day, 23, 59), hasTime: false };
}

export type ExtractOptions = {
  /** When the text was written: resolves "på fredag" and dates without a year. */
  ref: Date;
  /** Used when the sentence has a date but the action word is only in the title ("Anmälan till labbgrupper"). */
  title?: string;
  /** Candidates due before this are dropped. */
  notBefore?: Date;
  /**
   * false when `ref` is only a guess (pages and syllabi have no posting date):
   * "book Friday tutorial" then says nothing about which Friday, so such mentions are skipped.
   */
  refIsKnown?: boolean;
  /** The item's own deadline (YYYY-MM-DD): a description that repeats it is not a hidden deadline. */
  ownDate?: string | null;
};

export function extractCandidates(text: string, opts: ExtractOptions): Candidate[] {
  const titleClass = opts.title ? classify(opts.title) : null;
  const out = new Map<string, Candidate>();

  for (const sentence of splitSentences(text)) {
    const mentions = extractDates(sentence, opts.ref).filter((m) => opts.refIsKnown !== false || !m.relative);
    if (mentions.length === 0) continue;
    const own = classify(sentence);
    if (!own && !titleClass) continue;
    // "Sista dag är 20/11" under the title "Anmälan till labbgrupper" is a sign-up, not a generic deadline.
    const specific = titleClass && titleClass.kind !== "deadline" ? titleClass.kind : null;
    const cls = own ? { kind: own.kind === "deadline" && specific ? specific : own.kind, weight: own.weight } : titleClass!;

    // With several dates in one sentence, the deadline is usually the one right after the action word.
    const after = own ? mentions.filter((m) => m.index >= own.index) : [];
    const m = after[0] ?? mentions[mentions.length - 1];
    if (opts.ownDate && m.date === opts.ownDate) continue;
    const { dueAt, hasTime } = dueFromMention(m);
    if (opts.notBefore && dueAt < opts.notBefore) continue;

    let confidence = own ? cls.weight : Math.round(cls.weight * 0.6);
    if (m.time) confidence += 5;
    if (m.precision === "week") confidence -= 10;
    confidence = Math.max(5, Math.min(99, confidence));

    const key = `${m.date}|${m.time ?? ""}`;
    const prev = out.get(key);
    if (!prev || prev.confidence < confidence) {
      out.set(key, { kind: cls.kind, quote: truncate(sentence.replace(/\s+/g, " "), 320), date: m.date, time: m.time, precision: m.precision, dueAt, hasTime, confidence });
    }
  }
  return [...out.values()].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}
