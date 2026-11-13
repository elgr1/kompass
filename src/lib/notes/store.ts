import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db";
import { databases, docLinks, docs, items, type Doc } from "../db/schema";
import { getCourses } from "../queries";
import { setSetting } from "../settings";
import { dateKey, fmtDateTime, isoWeek, type Lang } from "../time";
import { renderMarkdown, wikiLinks, type RenderContext } from "./markdown";
import { DB_TEMPLATES, PAGE_TEMPLATES } from "./templates";

const norm = (s: string) => s.trim().toLowerCase();
const markSearchDirty = (db: Db) => setSetting(db, "search_dirty", "1");

function titleIndex(db: Db): Map<string, number> {
  const m = new Map<string, number>();
  // On duplicate titles the oldest page wins, so links stay stable.
  for (const d of db.select({ id: docs.id, title: docs.title }).from(docs).orderBy(desc(docs.id)).all()) m.set(norm(d.title), d.id);
  return m;
}

/** Re-resolves the [[links]] of one page. */
function relink(db: Db, id: number, content: string, index = titleIndex(db)) {
  db.delete(docLinks).where(eq(docLinks.fromId, id)).run();
  const targets = new Set(wikiLinks(content).map((t) => index.get(norm(t))).filter((x): x is number => x !== undefined && x !== id));
  for (const toId of targets) db.insert(docLinks).values({ fromId: id, toId }).run();
}

export function createDoc(db: Db, input: { title: string; content?: string; parentId?: number | null; databaseId?: number | null; props?: Record<string, unknown>; courseId?: string | null }, now = new Date()): Doc {
  const doc = db.insert(docs).values({
    title: input.title.trim() || "Untitled", content: input.content ?? "", parentId: input.parentId ?? null, databaseId: input.databaseId ?? null,
    props: input.props ?? {}, courseId: input.courseId ?? null, createdAt: now, updatedAt: now,
  }).returning().get();
  relink(db, doc.id, doc.content);
  // A page that did not exist when others linked to it by name becomes their target now.
  for (const other of db.select({ id: docs.id, content: docs.content }).from(docs).where(sql`${docs.content} like ${`%[[${doc.title.replace(/[%_]/g, "")}%`}`).all()) {
    if (other.id !== doc.id) relink(db, other.id, other.content);
  }
  markSearchDirty(db);
  return doc;
}

export function createFromTemplate(db: Db, key: string, lang: Lang, opts: { title?: string; parentId?: number | null } = {}, now = new Date()): Doc {
  const tpl = PAGE_TEMPLATES.find((t) => t.key === key) ?? PAGE_TEMPLATES[0];
  const ctx = { date: dateKey(now), week: isoWeek(dateKey(now)).week };
  return createDoc(db, { title: opts.title?.trim() || tpl.title(lang, ctx), content: tpl.content(lang, ctx), parentId: opts.parentId }, now);
}

export function saveDoc(db: Db, id: number, patch: { title?: string; content?: string }, now = new Date()): Doc | null {
  const prev = db.select().from(docs).where(eq(docs.id, id)).get();
  if (!prev) return null;
  const title = patch.title !== undefined ? patch.title.trim() || prev.title : prev.title;
  const content = patch.content ?? prev.content;
  if (title === prev.title && content === prev.content) return prev;
  db.update(docs).set({ title, content, updatedAt: now }).where(eq(docs.id, id)).run();
  relink(db, id, content);
  markSearchDirty(db);
  return { ...prev, title, content, updatedAt: now };
}

export function deleteDoc(db: Db, id: number) {
  db.transaction((tx) => {
    const t = tx as unknown as Db;
    // Sub-pages move up one level rather than disappearing with their parent.
    const self = t.select().from(docs).where(eq(docs.id, id)).get();
    t.update(docs).set({ parentId: self?.parentId ?? null }).where(eq(docs.parentId, id)).run();
    t.delete(docLinks).where(eq(docLinks.fromId, id)).run();
    t.delete(docLinks).where(eq(docLinks.toId, id)).run();
    t.delete(docs).where(eq(docs.id, id)).run();
  });
  markSearchDirty(db);
}

export const getDoc = (db: Db, id: number) => db.select().from(docs).where(eq(docs.id, id)).get() ?? null;

export function getBacklinks(db: Db, id: number) {
  const from = db.select({ id: docLinks.fromId }).from(docLinks).where(eq(docLinks.toId, id)).all().map((r) => r.id);
  return from.length ? db.select({ id: docs.id, title: docs.title }).from(docs).where(inArray(docs.id, from)).orderBy(asc(docs.title)).all() : [];
}

/** Standalone pages (not database rows) as a tree. */
export type DocNode = { id: number; title: string; updatedAt: Date; children: DocNode[] };
export function getDocTree(db: Db): DocNode[] {
  const rows = db.select({ id: docs.id, title: docs.title, parentId: docs.parentId, updatedAt: docs.updatedAt }).from(docs).where(isNull(docs.databaseId)).orderBy(asc(docs.title)).all();
  const nodes = new Map(rows.map((r) => [r.id, { id: r.id, title: r.title, updatedAt: r.updatedAt, children: [] as DocNode[] }]));
  const roots: DocNode[] = [];
  for (const r of rows) {
    const parent = r.parentId !== null ? nodes.get(r.parentId) : undefined;
    (parent ? parent.children : roots).push(nodes.get(r.id)!);
  }
  return roots;
}

/** Rendering context backed by the database: resolves [[links]] and turns Studium URLs into cards. */
export function renderContext(db: Db, lang: Lang): RenderContext {
  const index = titleIndex(db);
  const cs = getCourses(db);
  return {
    resolvePage: (title) => index.get(norm(title)) ?? null,
    itemByUrl: (url) => {
      if (!/^https:\/\/uppsala\.instructure\.com\//.test(url)) return null;
      const it = db.select().from(items).where(and(eq(items.htmlUrl, url), isNull(items.deletedAt))).get();
      if (!it) return null;
      const course = it.courseId ? cs.get(it.courseId)?.shortName : null;
      const when = it.dueAt ?? it.startAt;
      return { title: it.title, meta: [course, when ? fmtDateTime(when, lang) : null, "Studium"].filter(Boolean).join(" · ") };
    },
  };
}

export const renderDoc = (db: Db, content: string, lang: Lang) => renderMarkdown(content, renderContext(db, lang));

export function createDatabase(db: Db, templateKey: string, lang: Lang, now = new Date()) {
  const tpl = DB_TEMPLATES.find((t) => t.key === templateKey) ?? DB_TEMPLATES[0];
  const built = tpl.build(lang);
  return db.insert(databases).values({ ...built, createdAt: now }).returning().get();
}

export const getDatabase = (db: Db, id: number) => db.select().from(databases).where(eq(databases.id, id)).get() ?? null;
export const getDatabases = (db: Db) => db.select().from(databases).orderBy(asc(databases.title)).all();
export const getRows = (db: Db, databaseId: number) => db.select().from(docs).where(eq(docs.databaseId, databaseId)).orderBy(asc(docs.id)).all();
