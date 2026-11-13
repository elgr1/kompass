import { and, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db";
import { courses, fileTexts, items, suggestions } from "../db/schema";
import { extractDates } from "../detect/dates";
import { storeCandidates } from "../detect/run";
import { getSetting, setSetting } from "../settings";
import { dateKey } from "../time";
import { extractWithClaude, LLM_MAX_CHARS, type LlmSource } from "./extract";

export type LlmCandidate = { id: string; kind: string; title: string; course: string | null; courseId: string | null; url: string | null; source: LlmSource; tooLong: boolean };

const SCANNED = ["announcement", "page", "syllabus", "discussion", "assignment", "file"];
const sentMap = (db: Db): Record<string, string> => { try { return JSON.parse(getSetting(db, "llm_sent") ?? "{}"); } catch { return {}; } };

/**
 * Texts worth a second look: recent, in a visible course, containing something date-like,
 * where the rules produced no suggestion, and not already sent in this version.
 */
export function llmCandidates(db: Db, now: Date, limit = 12): LlmCandidate[] {
  const cs = new Map(db.select().from(courses).all().map((c) => [c.id, c]));
  const texts = new Map(db.select().from(fileTexts).all().filter((f) => f.text).map((f) => [f.itemId, f.text]));
  const covered = new Set(db.select({ id: suggestions.itemId }).from(suggestions).all().map((s) => s.id));
  const sent = sentMap(db);
  const since = now.getTime() - 60 * 86_400_000;
  return db
    .select()
    .from(items)
    .where(and(inArray(items.kind, SCANNED), isNull(items.deletedAt)))
    .all()
    .flatMap((r) => {
      const text = (r.kind === "file" ? texts.get(r.id) : r.bodyText) ?? "";
      const stamp = r.fields.posted_at ?? r.fields.modified_at;
      const posted = typeof stamp === "string" && !Number.isNaN(Date.parse(stamp)) ? new Date(stamp) : null;
      const course = r.courseId ? cs.get(r.courseId) : undefined;
      if (text.length < 200 || covered.has(r.id) || sent[r.id] === r.hash || course?.hidden) return [];
      if ((posted ?? r.firstSeenAt).getTime() < since) return [];
      if (extractDates(text.slice(0, LLM_MAX_CHARS), posted ?? now).length === 0) return [];
      return [{ row: r, text, posted }];
    })
    .sort((a, b) => (b.posted ?? b.row.firstSeenAt).getTime() - (a.posted ?? a.row.firstSeenAt).getTime())
    .slice(0, limit)
    .map(({ row, text, posted }) => ({
      id: row.id, kind: row.kind, title: row.title, course: row.courseId ? cs.get(row.courseId)?.shortName ?? null : null, courseId: row.courseId, url: row.htmlUrl,
      source: { title: row.title, text, posted: posted ? dateKey(posted) : null }, tooLong: text.length > LLM_MAX_CHARS,
    }));
}

/** Sends the chosen texts, one request each, and stores what comes back as ordinary suggestions marked "ai". */
export async function runLlm(db: Db, ids: string[], now: Date, extract: typeof extractWithClaude = extractWithClaude): Promise<{ sent: number; added: number; errors: string[] }> {
  const chosen = llmCandidates(db, now, 200).filter((c) => ids.includes(c.id) && !c.tooLong);
  const rows = new Map(db.select({ id: items.id, hash: items.hash }).from(items).all().map((r) => [r.id, r.hash]));
  const today = dateKey(now);
  let added = 0;
  const errors: string[] = [];
  const sent = sentMap(db);
  for (const c of chosen) {
    try {
      const found = await extract(c.source, { today });
      added += storeCandidates(db, { id: c.id, courseId: c.courseId, title: c.title, url: c.url, label: `ai:${c.kind}` }, found, now);
      sent[c.id] = rows.get(c.id) ?? "";
    } catch (err) {
      errors.push(`${c.title}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  setSetting(db, "llm_sent", JSON.stringify(sent));
  setSetting(db, "llm_last", JSON.stringify({ at: now.getTime(), sent: chosen.length, added, errors }));
  return { sent: chosen.length, added, errors };
}
