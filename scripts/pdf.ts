/** Read the text of every mirrored PDF that has not been read yet: `npm run pdf`. Read-only downloads. */
import { CanvasClient } from "../src/lib/canvas/client";
import { getDb } from "../src/lib/db/index";
import { runDetector } from "../src/lib/detect/run";
import { pendingPdfs, readPendingPdfs } from "../src/lib/files/pdf";

const client = CanvasClient.fromEnv();
if (!client) {
  console.error("CANVAS_TOKEN is not set in .env.");
  process.exit(2);
}
const db = getDb();
const total = pendingPdfs(db).length;
console.log(`${total} PDF file(s) to read.`);
let n = 0;
const r = await readPendingPdfs(db, client, { limit: Number(process.argv[2] ?? 1000), onProgress: (title, result) => console.log(`  ${String(++n).padStart(3)}/${total}  ${title.slice(0, 60).padEnd(60)}  ${result}`) });
const found = runDetector(db);
console.log(`Read ${r.read}, failed ${r.failed}, left ${r.left}. Detector: ${found.added} new suggestion(s).`);
