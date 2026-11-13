/** Run one sync from the terminal: `npm run sync` (or `npm run sync:demo`). */
import { getProviders, syncAll } from "../src/lib/sync/run";

const providers = getProviders();
if (providers.length === 0) {
  console.error("No data source configured. Set CANVAS_TOKEN (and optionally TIMEEDIT_ICS_URLS) in .env.");
  process.exit(2);
}
console.log(`Syncing: ${providers.map((p) => p.label).join(", ")}`);
const results = await syncAll();
for (const r of results) {
  const s = r.stats;
  console.log(
    `${r.status === "ok" ? "✓" : r.status === "partial" ? "~" : "✗"} ${r.provider}: ${r.status} · ${s.items} items · ` +
      `+${s.added} new, ${s.updated} changed, ${s.removed} removed · scopes ${s.scopesOk} ok / ${s.scopesUnavailable} unavailable / ${s.scopesError} failed` +
      (s.requests !== undefined ? ` · ${s.requests} requests` : ""),
  );
  if (r.error) console.log(`   ${r.error}`);
}
process.exit(results.some((r) => r.status === "error") ? 1 : 0);
