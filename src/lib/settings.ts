import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "./db";
import { settings } from "./db/schema";

export function getSetting(db: Db, key: string): string | null {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;
}

export function setSetting(db: Db, key: string, value: string) {
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

/** Secret part of the private calendar feed URL. Created on first use. */
export function getFeedToken(db: Db, regenerate = false): string {
  const existing = regenerate ? null : getSetting(db, "feed_token");
  if (existing) return existing;
  const token = randomBytes(24).toString("base64url");
  setSetting(db, "feed_token", token);
  return token;
}
