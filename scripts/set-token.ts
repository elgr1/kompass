/**
 * Take the Canvas token straight from the clipboard into .env (macOS), so no
 * editor, retyping or partial selection is involved. Never prints the token.
 *
 *   npm run token:paste     (then runs the API check)
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ENV = ".env";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const clip = execFileSync("pbpaste", { encoding: "utf8" }).trim();
if (!/^\d+~[A-Za-z0-9]{64}$/.test(clip)) {
  console.error(
    `✗ The clipboard does not hold a Canvas token (expected digits~64 characters; got ${clip.length} characters).\n` +
      "  Create the token in Studium and copy it from the dialog that appears right after creation.",
  );
  process.exit(2);
}

const lines = existsSync(ENV) ? readFileSync(ENV, "utf8").split("\n") : ["CANVAS_BASE_URL=https://uppsala.instructure.com"];
const i = lines.findIndex((l) => l.startsWith("CANVAS_TOKEN="));
const previous = i >= 0 ? lines[i].slice("CANVAS_TOKEN=".length).trim() : "";

if (previous && sha(previous) === sha(clip)) {
  console.log("• Clipboard token is IDENTICAL to the one already in .env (nothing new to test).");
} else {
  console.log(`• Clipboard token is ${previous ? "different from the previous one" : "new"}; written to .env.`);
}
if (i >= 0) lines[i] = `CANVAS_TOKEN=${clip}`;
else lines.push(`CANVAS_TOKEN=${clip}`);
writeFileSync(ENV, lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
