import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db";
import { courses, fileTexts, items, suggestions } from "../db/schema";
import { dateKey, startOfDay } from "../time";
import { extractCandidates, type Candidate } from "./extract";

/** Kinds whose text can hide a deadline. Files (PDFs) are not read yet. */
const SCANNED = ["announcement", "page", "syllabus", "discussion", "assignment", "quiz", "calendar_event", "appointment_group"];

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

export function storeCandidates(db: Db, source: { id: string | null; courseId: string | null; title: string; url: string | null; label: string }, cands: Candidate[], now: Date): number {
  let added = 0;
  for (const c of cands) {
    // Keyed on source + date + kind: a finding the user dismissed never comes back,
    // but a deadline that moves in the text produces a new suggestion.
    const key = hash(`${source.id ?? source.label}|${c.date}|${c.time ?? ""}|${c.kind}`);
    const res = db
      .insert(suggestions)
      .values({
        key, itemId: source.id, courseId: source.courseId, kind: c.kind, title: source.title, quote: c.quote, dueAt: c.dueAt, hasTime: c.hasTime,
        precision: c.precision, confidence: c.confidence, sourceUrl: source.url, sourceLabel: source.label, status: "pending", createdAt: now,
      })
      .onConflictDoNothing()
      .run();
    added += res.changes;
  }
  return added;
}

/** Scans mirrored text for dated obligations. Only ever creates *suggestions*; the user turns them into tasks. */
export function runDetector(db: Db, now: Date = new Date()): { scanned: number; added: number } {
  const hidden = new Set(db.select({ id: courses.id }).from(courses).where(eq(courses.hidden, true)).all().map((c) => c.id));
  const rows = db.select().from(items).where(and(inArray(items.kind, SCANNED), isNull(items.deletedAt))).all();
  const today = startOfDay(dateKey(now));
  let scanned = 0;
  let added = 0;
  db.transaction((tx) => {
    for (const r of rows) {
      if (!r.bodyText || (r.courseId && hidden.has(r.courseId))) continue;
      scanned++;
      // "på fredag" is relative to when the text was posted, not to today.
      const posted = typeof r.fields.posted_at === "string" ? new Date(r.fields.posted_at) : null;
      const known = posted !== null && !Number.isNaN(posted.getTime());
      const cands = extractCandidates(r.bodyText, { ref: known ? posted : r.firstSeenAt, refIsKnown: known, title: r.title, notBefore: today, ownDate: r.dueAt ? dateKey(r.dueAt) : null });
      if (cands.length) added += storeCandidates(tx as unknown as Db, { id: r.id, courseId: r.courseId, title: r.title, url: r.htmlUrl, label: r.kind }, cands, now);
    }
  });
  // Text read out of PDFs (kurs-PM, lab instructions). The file's modified date stands in for "posted".
  const texts = new Map(db.select().from(fileTexts).all().filter((f) => f.text).map((f) => [f.itemId, f.text]));
  if (texts.size) {
    const files = db.select().from(items).where(and(eq(items.kind, "file"), isNull(items.deletedAt))).all();
    db.transaction((tx) => {
      for (const r of files) {
        const body = texts.get(r.id);
        if (!body || (r.courseId && hidden.has(r.courseId))) continue;
        scanned++;
        const modified = typeof r.fields.modified_at === "string" ? new Date(r.fields.modified_at) : null;
        const known = modified !== null && !Number.isNaN(modified.getTime());
        const cands = extractCandidates(body, { ref: known ? modified : r.firstSeenAt, refIsKnown: known, notBefore: today });
        if (cands.length) added += storeCandidates(tx as unknown as Db, { id: r.id, courseId: r.courseId, title: r.title, url: r.htmlUrl, label: "file" }, cands, now);
      }
    });
  }
  return { scanned, added };
}

/** Manual import: paste an announcement, an e-mail or text copied from a kurs-PM. */
export function importText(db: Db, text: string, title: string, courseId: string | null, now: Date = new Date()): number {
  const cands = extractCandidates(text, { ref: now, title, notBefore: startOfDay(dateKey(now)) });
  return storeCandidates(db, { id: null, courseId, title, url: null, label: `manual:${hash(text).slice(0, 8)}` }, cands, now);
}
