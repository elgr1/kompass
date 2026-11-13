/** Re-run the hidden-deadline detector over already mirrored content: `npm run detect`. No network. */
import { getDb } from "../src/lib/db/index";
import { runDetector } from "../src/lib/detect/run";

const r = runDetector(getDb());
console.log(`Scanned ${r.scanned} texts, ${r.added} new suggestion${r.added === 1 ? "" : "s"}.`);
