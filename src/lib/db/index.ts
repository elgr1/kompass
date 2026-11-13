import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

export const isDemo = () => process.env.KOMPASS_DEMO === "1";

/** Demo data lives in its own file so it can never mix with real Studium data. */
export function defaultDbPath(): string {
  return path.join(process.cwd(), "data", isDemo() ? "demo.sqlite" : "kompass.sqlite");
}

export function createDb(file: string): Db {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

// One connection per process, surviving Next.js dev hot reloads.
const g = globalThis as unknown as { __kompassDb?: { file: string; db: Db } };

export function getDb(): Db {
  const file = defaultDbPath();
  if (!g.__kompassDb || g.__kompassDb.file !== file) {
    g.__kompassDb = { file, db: createDb(file) };
  }
  return g.__kompassDb.db;
}
