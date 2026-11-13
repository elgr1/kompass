import { and, eq, isNull } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import type { CanvasClient } from "../canvas/client";
import type { Db } from "../db";
import { courses, fileTexts, items, type Item } from "../db/schema";
import { setSetting } from "../settings";

/**
 * Reads the text out of mirrored PDF files (kurs-PM, lab instructions, old exams), so the
 * hidden-deadline detector and search can use it. Only the extracted text is stored;
 * the PDF itself is not kept on disk. Downloads are read-only GETs, a few per sync.
 */

export const MAX_PDF_BYTES = 25 * 1_048_576;
const MAX_TEXT = 400_000;

export const isPdf = (i: Pick<Item, "title" | "fields">) => /pdf/i.test(String(i.fields.content_type ?? "")) || /\.pdf$/i.test(i.title);
/** Changes when the teacher replaces the file. */
export const fileVersion = (i: Pick<Item, "fields">) => `${String(i.fields.size ?? "")}|${String(i.fields.modified_at ?? "")}`;

export async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) throw new Error("Not a PDF file");
  // The PDF library takes ownership of the buffer it is given, so hand it a copy.
  const pdf = await getDocumentProxy(bytes.slice());
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const joined = (Array.isArray(text) ? text : [text]).map((p) => p.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()).filter(Boolean).join("\n\n");
  return { text: joined.slice(0, MAX_TEXT), pages: totalPages };
}

/** Candidate download URLs for a mirrored file, best first. */
function downloadUrls(item: Item, baseUrl: string): string[] {
  const raw = (item.raw ?? {}) as { url?: unknown; content_details?: { url?: unknown } };
  const cid = item.courseId?.split(":")[1];
  const urls = [raw.content_details?.url, /\/api\/v1\//.test(String(raw.url ?? "")) ? null : raw.url, cid ? `${baseUrl}/courses/${cid}/files/${item.externalId}/download?download_frd=1` : null];
  return [...new Set(urls.filter((u): u is string => typeof u === "string" && u.startsWith(`${baseUrl}/`)))];
}

export function pendingPdfs(db: Db): Item[] {
  const hidden = new Set(db.select({ id: courses.id }).from(courses).where(eq(courses.hidden, true)).all().map((c) => c.id));
  const done = new Map(db.select({ id: fileTexts.itemId, version: fileTexts.version }).from(fileTexts).all().map((r) => [r.id, r.version]));
  return db
    .select()
    .from(items)
    .where(and(eq(items.kind, "file"), eq(items.provider, "canvas"), isNull(items.deletedAt)))
    .all()
    .filter((i) => isPdf(i) && !(i.courseId && hidden.has(i.courseId)) && done.get(i.id) !== fileVersion(i))
    // newest material first: that is where upcoming deadlines are
    .sort((a, b) => String(b.fields.modified_at ?? "").localeCompare(String(a.fields.modified_at ?? "")));
}

export async function readPendingPdfs(db: Db, client: CanvasClient, opts: { limit: number; now?: Date; onProgress?: (title: string, result: string) => void }): Promise<{ read: number; failed: number; left: number }> {
  const queue = pendingPdfs(db);
  let read = 0;
  let failed = 0;
  for (const item of queue.slice(0, opts.limit)) {
    const now = opts.now ?? new Date();
    const size = Number(item.fields.size ?? 0);
    let row: typeof fileTexts.$inferInsert;
    try {
      if (size > MAX_PDF_BYTES) throw new Error(`Larger than ${MAX_PDF_BYTES / 1_048_576} MB`);
      let got: { text: string; pages: number } | null = null;
      let lastError: unknown = new Error("No download link");
      for (const url of downloadUrls(item, client.baseUrl)) {
        try {
          const { bytes } = await client.download(url, MAX_PDF_BYTES);
          got = await extractPdfText(bytes);
          break;
        } catch (err) {
          lastError = err;
        }
      }
      if (!got) throw lastError;
      row = { itemId: item.id, version: fileVersion(item), text: got.text, pages: got.pages, error: got.text.trim() ? null : "No text layer (scanned document?)", extractedAt: now };
      read++;
      opts.onProgress?.(item.title, `${got.pages} p, ${got.text.length} chars`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      row = { itemId: item.id, version: fileVersion(item), text: "", pages: 0, error: message.slice(0, 300), extractedAt: now };
      failed++;
      opts.onProgress?.(item.title, `failed: ${message}`);
    }
    db.insert(fileTexts).values(row).onConflictDoUpdate({ target: fileTexts.itemId, set: row }).run();
  }
  if (read) setSetting(db, "search_dirty", "1");
  return { read, failed, left: Math.max(0, queue.length - opts.limit) };
}
