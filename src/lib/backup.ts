import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Db } from "./db";
import * as schema from "./db/schema";
import { getSetting, setSetting } from "./settings";
import { dateKey, zonedParts } from "./time";

/**
 * Backup = a complete copy of the SQLite file (everything, restorable by copying it back).
 * Export  = my own content in open formats: one Markdown file per page plus one JSON file
 *           with tasks, projects, applications, degree courses and so on. Mirrored Studium
 *           content is left out of the export, since a sync brings it back.
 */

export const dataDir = () => path.join(process.cwd(), "data");
const KEEP = 14;

type Raw = { $client: { backup(dest: string): Promise<unknown> } };

export async function backupDatabase(db: Db, dir: string, now: Date = new Date()): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `kompass-${dateKey(now)}.sqlite`);
  await (db as unknown as Raw).$client.backup(file);
  // keep two weeks of nightly copies
  const old = readdirSync(dir).filter((f) => /^kompass-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort().reverse().slice(KEEP);
  for (const f of old) rmSync(path.join(dir, f), { force: true });
  setSetting(db, "backup_last", JSON.stringify({ at: now.getTime(), file }));
  return file;
}

/** Once a night (first chance after 02:00 Stockholm time), while the app is running. */
export async function maybeNightlyBackup(db: Db, dir: string, now: Date = new Date()): Promise<string | null> {
  const today = dateKey(now);
  let last: { at: number } | null = null;
  try { last = JSON.parse(getSetting(db, "backup_last") ?? "null"); } catch { /* treat as never */ }
  if (zonedParts(now).hour < 2 || (last && dateKey(new Date(last.at)) === today)) return null;
  return backupDatabase(db, dir, now);
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "sida";

export function exportAll(db: Db, dir: string, now: Date = new Date()): { dir: string; pages: number; records: number } {
  const p = zonedParts(now);
  const stamp = `${dateKey(now)}-${String(p.hour).padStart(2, "0")}${String(p.minute).padStart(2, "0")}${String(p.second).padStart(2, "0")}`;
  const out = path.join(dir, stamp);
  mkdirSync(path.join(out, "notes"), { recursive: true });

  const docs = db.select().from(schema.docs).all();
  const dbs = new Map(db.select().from(schema.databases).all().map((d) => [d.id, d]));
  for (const d of docs) {
    const database = d.databaseId ? dbs.get(d.databaseId) : undefined;
    // properties of a database row go into front matter, by property name
    const props = database ? Object.fromEntries(database.props.map((pr) => [pr.name, d.props[pr.id] ?? null])) : {};
    const front = ["---", `title: ${JSON.stringify(d.title)}`, `id: ${d.id}`, ...(database ? [`database: ${JSON.stringify(database.title)}`] : []), ...Object.entries(props).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`), `updated: ${d.updatedAt.toISOString()}`, "---", ""].join("\n");
    writeFileSync(path.join(out, "notes", `${slug(d.title)}-${d.id}.md`), `${front}${d.content}\n`);
  }

  const tables = {
    tasks: schema.tasks, projects: schema.projects, milestones: schema.milestones, applications: schema.applications, contacts: schema.contacts,
    careerEvents: schema.careerEvents, degreeCourses: schema.degreeCourses, exams: schema.exams, blocks: schema.blocks, timeEntries: schema.timeEntries,
    examPlans: schema.examPlans, workMeta: schema.workMeta, databases: schema.databases, courseAliases: schema.courseAliases,
  } as const;
  const data: Record<string, unknown> = { exportedAt: now.toISOString(), app: "kompass" };
  let records = 0;
  for (const [name, table] of Object.entries(tables)) {
    const rows = db.select().from(table).all();
    data[name] = rows;
    records += rows.length;
  }
  data.courses = db.select({ id: schema.courses.id, name: schema.courses.name, code: schema.courses.code, hidden: schema.courses.hidden, nicknames: schema.courses.nicknames }).from(schema.courses).all();
  // settings, minus the secret part of the calendar link
  data.settings = db.select().from(schema.settings).all().filter((s) => s.key !== "feed_token");
  writeFileSync(path.join(out, "data.json"), JSON.stringify(data, null, 2));
  setSetting(db, "export_last", JSON.stringify({ at: now.getTime(), dir: out, pages: docs.length, records }));
  return { dir: out, pages: docs.length, records };
}
