import { asc, eq } from "drizzle-orm";
import { getDb, isDemo } from "../db";
import { syncRuns } from "../db/schema";
import { CanvasApiProvider } from "../providers/canvas-api";
import { DemoProvider } from "../providers/demo";
import { CanvasIcsProvider, TimeEditIcsProvider } from "../providers/ics";
import type { SyncProvider } from "../providers/types";
import { CanvasClient } from "../canvas/client";
import { runDetector } from "../detect/run";
import { readPendingPdfs } from "../files/pdf";
import { setSetting } from "../settings";
import { runSync, type SyncSummary } from "./engine";

export const SYNC_INTERVAL_MIN = 20;

/** Which sources are active, decided purely by what is configured in `.env`. */
export function getProviders(): SyncProvider[] {
  if (isDemo()) {
    // Keep the demo world fixed to when it was seeded (first run = "two days before"), so re-syncing is a no-op.
    const first = getDb().select().from(syncRuns).where(eq(syncRuns.provider, "demo")).orderBy(asc(syncRuns.id)).limit(1).get();
    return [new DemoProvider(1, first ? new Date(first.startedAt.getTime() + 2 * 86_400_000) : null)];
  }
  const out: SyncProvider[] = [];
  // The API is preferred; the calendar feed is only a fallback when there is no token.
  const canvas = CanvasApiProvider.fromEnv() ?? CanvasIcsProvider.fromEnv();
  if (canvas) out.push(canvas);
  const timeedit = TimeEditIcsProvider.fromEnv();
  if (timeedit) out.push(timeedit); // after Canvas, so schedule events can be matched to courses
  return out;
}

const g = globalThis as unknown as { __kompassSync?: Promise<SyncSummary[]> | null; __kompassTimer?: NodeJS.Timeout };

/** Runs every configured provider once. Concurrent callers share the same run. */
export function syncAll(): Promise<SyncSummary[]> {
  if (!g.__kompassSync) {
    g.__kompassSync = (async () => {
      const db = getDb();
      const out: SyncSummary[] = [];
      for (const p of getProviders()) out.push(await runSync(db, p));
      setSetting(db, "search_dirty", "1"); // mirrored content may have changed
      // Read a batch of new or replaced PDFs each sync; `npm run pdf` works through a backlog in one go.
      const client = isDemo() || process.env.KOMPASS_PDF === "0" ? null : CanvasClient.fromEnv();
      if (client) {
        try {
          await readPendingPdfs(db, client, { limit: 20 });
        } catch (err) {
          console.error("[kompass] reading PDFs failed:", err instanceof Error ? err.message : err);
        }
      }
      try {
        runDetector(db); // look for hidden deadlines in whatever just came in
      } catch (err) {
        console.error("[kompass] detector failed:", err instanceof Error ? err.message : err);
      }
      return out;
    })().finally(() => {
      g.__kompassSync = null;
    });
  }
  return g.__kompassSync;
}

export const isSyncing = () => Boolean(g.__kompassSync);

/** Background worker: one sync shortly after start, then every SYNC_INTERVAL_MIN minutes. */
export function startScheduler() {
  if (g.__kompassTimer || process.env.KOMPASS_NO_SCHEDULER === "1") return;
  const tick = () => {
    syncAll().catch((err) => console.error("[kompass] sync failed:", err instanceof Error ? err.message : err));
    // nightly copy of the database (real data only)
    if (!isDemo()) {
      import("../backup")
        .then((m) => m.maybeNightlyBackup(getDb(), `${m.dataDir()}/backups`))
        .catch((err) => console.error("[kompass] backup failed:", err instanceof Error ? err.message : err));
    }
  };
  g.__kompassTimer = setInterval(tick, SYNC_INTERVAL_MIN * 60_000);
  g.__kompassTimer.unref?.();
  setTimeout(tick, 5_000).unref?.();
  // Reminders need finer timing than the sync ("3 hours before close"), so they have their own 5-minute tick.
  const notify = () => {
    import("../notify/run").then((m) => m.notifyTick()).catch((err) => console.error("[kompass] notify failed:", err instanceof Error ? err.message : err));
  };
  setInterval(notify, 5 * 60_000).unref?.();
  setTimeout(notify, 45_000).unref?.();
}
