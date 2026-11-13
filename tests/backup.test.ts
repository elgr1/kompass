import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { backupDatabase, exportAll, maybeNightlyBackup } from "../src/lib/backup";
import { createDb } from "../src/lib/db/index";
import { createDatabase, createDoc } from "../src/lib/notes/store";
import { getFeedToken } from "../src/lib/settings";
import { createTask } from "../src/lib/tasks";

const tmp = mkdtempSync(path.join(tmpdir(), "kompass-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("backup and export", () => {
  it("writes a restorable copy of the database and keeps only the newest fourteen", async () => {
    const db = createDb(":memory:");
    createTask(db, { title: "Finns kvar efter återställning", source: "manual" });
    const dir = path.join(tmp, "backups");
    const file = await backupDatabase(db, dir, new Date("2026-11-13T09:00:00Z"));
    const copy = new Database(file, { readonly: true });
    expect(copy.prepare("select title from tasks").all()).toEqual([{ title: "Finns kvar efter återställning" }]);
    copy.close();
    for (let d = 1; d <= 20; d++) writeFileSync(path.join(dir, `kompass-2026-10-${String(d).padStart(2, "0")}.sqlite`), "");
    await backupDatabase(db, dir, new Date("2026-11-14T09:00:00Z"));
    const kept = readdirSync(dir).sort();
    expect(kept).toHaveLength(14);
    expect(kept.at(-1)).toBe("kompass-2026-11-14.sqlite");
    expect(kept).toContain("kompass-2026-11-13.sqlite");
    expect(kept).not.toContain("kompass-2026-10-01.sqlite");
  });

  it("backs up once a night, not before 02:00 and not twice the same day", async () => {
    const db = createDb(":memory:");
    const dir = path.join(tmp, "nightly");
    expect(await maybeNightlyBackup(db, dir, new Date("2026-11-13T00:30:00Z"))).toBeNull(); // 01:30 local
    expect(await maybeNightlyBackup(db, dir, new Date("2026-11-13T01:10:00Z"))).toContain("kompass-2026-11-13.sqlite"); // 02:10 local
    expect(await maybeNightlyBackup(db, dir, new Date("2026-11-13T15:00:00Z"))).toBeNull();
    expect(await maybeNightlyBackup(db, dir, new Date("2026-11-14T06:00:00Z"))).toContain("kompass-2026-11-14.sqlite");
  });

  it("exports pages as Markdown with their properties, and records as JSON without the secret feed token", () => {
    const db = createDb(":memory:");
    getFeedToken(db);
    createDoc(db, { title: "Zeemaneffekten & mätdata", content: "$\\Delta E = \\mu_B B$\n\n- [ ] Räkna" });
    const projects = createDatabase(db, "projects", "sv");
    createDoc(db, { title: "Antenn", databaseId: projects.id, props: { status: "Pågår", due: "2026-11-20" }, content: "Mål: 2,4 GHz" });
    createTask(db, { title: "Boka labbtid", source: "manual" });
    const r = exportAll(db, path.join(tmp, "exports"), new Date("2026-11-13T09:00:00Z"));
    expect(r).toMatchObject({ pages: 2 });
    const files = readdirSync(path.join(r.dir, "notes")).sort();
    expect(files).toEqual(["antenn-2.md", "zeemaneffekten-matdata-1.md"]);
    const row = readFileSync(path.join(r.dir, "notes", "antenn-2.md"), "utf8");
    expect(row).toContain('title: "Antenn"');
    expect(row).toContain('database: "Projekt"');
    expect(row).toContain('"Status": "Pågår"');
    expect(row).toContain('"Deadline": "2026-11-20"');
    expect(row.endsWith("Mål: 2,4 GHz\n")).toBe(true);
    expect(readFileSync(path.join(r.dir, "notes", files[1]), "utf8")).toContain("$\\Delta E = \\mu_B B$");
    const data = JSON.parse(readFileSync(path.join(r.dir, "data.json"), "utf8"));
    expect(data.tasks.map((t: { title: string }) => t.title)).toEqual(["Boka labbtid"]);
    expect(data.databases).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain("feed_token");
  });
});
