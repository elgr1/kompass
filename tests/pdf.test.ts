import { describe, expect, it } from "vitest";
import { CanvasClient } from "../src/lib/canvas/client";
import { createDb } from "../src/lib/db/index";
import { courses, fileTexts, items, suggestions } from "../src/lib/db/schema";
import { runDetector } from "../src/lib/detect/run";
import { extractPdfText, pendingPdfs, readPendingPdfs } from "../src/lib/files/pdf";
import { search } from "../src/lib/search";

/** Builds a tiny, valid one-page PDF with the given lines (WinAnsi, so \344 = ä). */
function makePdf(lines: string[]): Uint8Array {
  const content = `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
}

const BASE = "https://uppsala.instructure.com";
const now = new Date("2026-11-13T09:00:00Z");
const pdf = makePdf(["Kurs-PM Reglerteknik I", "Anm\\344l dig till en labbgrupp senast 20 november kl. 17.00.", "Tentamen: se schemat."]);

function seed() {
  const db = createDb(":memory:");
  db.insert(courses).values({ id: "canvas:1", provider: "canvas", externalId: "1", name: "Reglerteknik I", shortName: "Reglerteknik I", color: "#000", firstSeenAt: now, lastSeenAt: now }).run();
  const file = (id: string, title: string, fields: Record<string, unknown>, raw: unknown = {}) =>
    db.insert(items).values({ id: `canvas:file:${id}`, provider: "canvas", kind: "file", externalId: id, scope: "s", courseId: "canvas:1", title, htmlUrl: `${BASE}/courses/1/files/${id}`, fields, comparable: {}, raw, hash: "h", firstSeenAt: now, lastSeenAt: now, changedAt: now }).run();
  file("10", "Kurs-PM.pdf", { size: pdf.length, content_type: "application/pdf", modified_at: "2026-11-10T08:00:00Z" }, { url: `${BASE}/files/10/download?verifier=abc` });
  file("11", "Bilder.zip", { size: 10, content_type: "application/zip" });
  file("12", "Stor.pdf", { size: 99_000_000, content_type: "application/pdf" });
  return db;
}

describe("reading PDFs", () => {
  it("extracts text from a PDF, including å/ä/ö, and rejects other files", async () => {
    const { text, pages } = await extractPdfText(pdf);
    expect(pages).toBe(1);
    expect(text).toContain("Anmäl dig till en labbgrupp senast 20 november kl. 17.00.");
    await expect(extractPdfText(new TextEncoder().encode("<html>login</html>"))).rejects.toThrow("Not a PDF");
  });

  it("downloads without leaking the token to the storage host, then feeds the detector and search", async () => {
    const db = seed();
    const calls: { url: string; auth: boolean }[] = [];
    const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
      const u = String(url);
      calls.push({ url: u, auth: Boolean((init.headers as Record<string, string> | undefined)?.Authorization) });
      if (u.startsWith(BASE)) return new Response(null, { status: 302, headers: { location: "https://inst-fs.example-storage.net/files/abc?token=signed" } });
      return new Response(pdf as unknown as BodyInit, { status: 200, headers: { "content-type": "application/pdf", "content-length": String(pdf.length) } });
    }) as typeof fetch;
    const client = new CanvasClient({ baseUrl: BASE, token: "secret", fetchImpl, sleepImpl: async () => {} });

    expect(pendingPdfs(db).map((i) => i.title).sort()).toEqual(["Kurs-PM.pdf", "Stor.pdf"]); // the zip is not a PDF
    const r = await readPendingPdfs(db, client, { limit: 10, now });
    expect(r).toEqual({ read: 1, failed: 1, left: 0 });
    expect(calls).toEqual([
      { url: `${BASE}/files/10/download?verifier=abc`, auth: true },
      { url: "https://inst-fs.example-storage.net/files/abc?token=signed", auth: false }, // no token outside Studium
    ]);
    const rows = db.select().from(fileTexts).all();
    expect(rows.find((x) => x.itemId === "canvas:file:12")?.error).toContain("Larger than");
    expect(pendingPdfs(db)).toEqual([]); // neither is retried until the file changes

    expect(runDetector(db, now).added).toBe(1);
    expect(db.select().from(suggestions).all()).toMatchObject([{ itemId: "canvas:file:10", kind: "signup", sourceLabel: "file", title: "Kurs-PM.pdf", hasTime: true }]);
    expect(search(db, "labbgrupp").map((h) => h.title)).toEqual(["Kurs-PM.pdf"]);
  });

  it("reads a file again when the teacher replaces it", async () => {
    const db = seed();
    const client = new CanvasClient({ baseUrl: BASE, token: "secret", sleepImpl: async () => {}, fetchImpl: (async () => new Response(pdf as unknown as BodyInit, { status: 200 })) as typeof fetch });
    await readPendingPdfs(db, client, { limit: 10, now });
    db.update(items).set({ fields: { size: pdf.length + 5, content_type: "application/pdf", modified_at: "2026-11-12T08:00:00Z" } }).run();
    expect(pendingPdfs(db).map((i) => i.title)).toContain("Kurs-PM.pdf");
  });
});
