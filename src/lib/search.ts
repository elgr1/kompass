import { isNull } from "drizzle-orm";
import type { Db } from "./db";
import { courses, docs, fileTexts, items, tasks } from "./db/schema";
import { getSetting, setSetting } from "./settings";

/**
 * Full-text search over my pages, my tasks and everything mirrored from Studium and TimeEdit.
 * Uses SQLite FTS5. The index is small (a few thousand rows) and is simply rebuilt when
 * something changed, which keeps it impossible to get out of sync.
 */

export type SearchHit = { type: "doc" | "task" | "item"; ref: string; kind: string; title: string; snippet: string; url: string; external: boolean; course: string | null };

type Raw = { $client: { exec(sql: string): unknown; prepare(sql: string): { run(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] }; transaction<T>(fn: () => T): () => T } };
const raw = (db: Db) => (db as unknown as Raw).$client;

/** Rebuilds the index if content changed since the last build (or it has never been built). */
export function ensureSearchIndex(db: Db, force = false) {
  const sqlite = raw(db);
  sqlite.exec("CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(type UNINDEXED, ref UNINDEXED, kind UNINDEXED, url UNINDEXED, course UNINDEXED, title, body, tokenize = 'unicode61 remove_diacritics 2')");
  if (!force && getSetting(db, "search_dirty") === "0") return;
  const hidden = new Set(db.select({ id: courses.id, hidden: courses.hidden }).from(courses).all().filter((c) => c.hidden).map((c) => c.id));
  const courseName = new Map(db.select({ id: courses.id, name: courses.shortName }).from(courses).all().map((c) => [c.id, c.name]));
  const insert = sqlite.prepare("INSERT INTO search_index (type, ref, kind, url, course, title, body) VALUES (?, ?, ?, ?, ?, ?, ?)");
  sqlite.transaction(() => {
    sqlite.exec("DELETE FROM search_index");
    for (const d of db.select().from(docs).all()) insert.run("doc", String(d.id), d.databaseId ? "row" : "page", `/notes/${d.id}`, null, d.title, d.content);
    for (const t of db.select().from(tasks).all()) insert.run("task", String(t.id), "task", "/tasks", t.courseId ? courseName.get(t.courseId) ?? null : null, t.title, [t.notes, t.sourceQuote, t.tags.join(" ")].filter(Boolean).join("\n"));
    const pdfText = new Map(db.select({ id: fileTexts.itemId, text: fileTexts.text }).from(fileTexts).all().map((f) => [f.id, f.text]));
    for (const i of db.select().from(items).where(isNull(items.deletedAt)).all()) {
      if (i.kind === "planner_item" || i.kind === "group" || (i.courseId && hidden.has(i.courseId))) continue;
      insert.run("item", i.id, i.kind, i.htmlUrl ?? "", i.courseId ? courseName.get(i.courseId) ?? null : null, i.title, [i.bodyText, i.location, pdfText.get(i.id)].filter(Boolean).join("\n"));
    }
  })();
  setSetting(db, "search_dirty", "0");
}

/** Turns free text into a safe FTS5 query: every word must match, the last one as a prefix. */
export function toFtsQuery(q: string): string | null {
  const words = q.normalize("NFKC").match(/[\p{L}\p{N}]+/gu);
  if (!words?.length) return null;
  return words.slice(0, 8).map((w, i, all) => `"${w}"${i === all.length - 1 ? "*" : ""}`).join(" AND ");
}

export function search(db: Db, q: string, limit = 40): SearchHit[] {
  const query = toFtsQuery(q);
  if (!query) return [];
  ensureSearchIndex(db);
  // Titles weigh five times more than body text; my own pages and tasks come before mirrored content on ties.
  const rows = raw(db)
    .prepare(
      `SELECT type, ref, kind, url, course, title,
              snippet(search_index, 6, char(2), char(3), ' … ', 16) AS snip
       FROM search_index WHERE search_index MATCH ?
       ORDER BY bm25(search_index, 0, 0, 0, 0, 0, 5.0, 1.0) + CASE type WHEN 'item' THEN 0.5 ELSE 0 END
       LIMIT ?`,
    )
    .all(query, limit) as { type: SearchHit["type"]; ref: string; kind: string; url: string; course: string | null; title: string; snip: string }[];
  return rows.map((r) => ({ type: r.type, ref: r.ref, kind: r.kind, title: r.title, snippet: r.snip, url: r.url, external: r.type === "item", course: r.course }));
}
