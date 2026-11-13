import { describe, expect, it } from "vitest";
import { createDb } from "../src/lib/db/index";
import { courses, items, type PropDef } from "../src/lib/db/schema";
import { applyView, coerce, groupRows, type Row } from "../src/lib/notes/dbview";
import { excerpt, renderMarkdown, taskProgress, toggleTask, wikiLinks } from "../src/lib/notes/markdown";
import { createDatabase, createDoc, createFromTemplate, deleteDoc, getBacklinks, getDocTree, renderDoc, saveDoc } from "../src/lib/notes/store";
import { DB_TEMPLATES, PAGE_TEMPLATES } from "../src/lib/notes/templates";
import { search, toFtsQuery } from "../src/lib/search";
import { createTask } from "../src/lib/tasks";

describe("markdown", () => {
  it("renders headings, lists, tables and code, and never raw HTML", () => {
    const html = renderMarkdown("# Titel\n\n- a\n- b\n\n| x | y |\n| - | - |\n| 1 | 2 |\n\n```py\nprint('<b>')\n```\n\n<script>alert(1)</script> <img src=x onerror=alert(1)>");
    expect(html).toContain("<h1>Titel</h1>");
    expect(html).toContain('<div class="table-wrap"><table>');
    expect(html).toContain("print('&lt;b&gt;')");
    expect(html).not.toContain("<script>");
    expect(html).not.toMatch(/<img[^>]+onerror/);
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders checklists with a running index, and toggles the right one in the source", () => {
    const src = "- [ ] ett\n- [x] två\n\n```\n- [ ] inte en uppgift\n```\n\n1. [ ] tre";
    const html = renderMarkdown(src);
    expect(html.match(/data-task="\d+"/g)).toEqual(['data-task="0"', 'data-task="1"', 'data-task="2"']);
    expect(html).toContain('data-task="1" checked');
    expect(taskProgress(src)).toEqual({ done: 1, total: 3 });
    expect(toggleTask(src, 0).split("\n")[0]).toBe("- [x] ett");
    expect(toggleTask(src, 1).split("\n")[1]).toBe("- [ ] två");
    expect(toggleTask(src, 2).split("\n").at(-1)).toBe("1. [x] tre");
    expect(toggleTask(src, 2)).toContain("- [ ] inte en uppgift"); // code is left alone
    expect(toggleTask(src, 9)).toBe(src);
  });

  it("renders callouts with and without a title", () => {
    const html = renderMarkdown("> [!warning] Sista dag fredag\n> Glöm inte.\n\n> [!tip]\n> Kort.\n\n> vanligt citat");
    expect(html).toContain('<blockquote class="callout callout-warning"><p class="callout-title">Sista dag fredag</p><p>Glöm inte.</p>');
    expect(html).toContain('<blockquote class="callout callout-tip"><p class="callout-title">Tips</p><p>Kort.</p>');
    expect(html).toContain("<blockquote>\n<p>vanligt citat</p>");
  });

  it("renders inline and block LaTeX with KaTeX, but leaves prices and code alone", () => {
    const html = renderMarkdown("Energin $E = h\\nu$ gäller.\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n\nDet kostar $5 och $10. Kod: `$x$`");
    expect(html.match(/class="katex"/g)?.length).toBe(2);
    expect(html).toContain('<div class="math-block"><span class="katex-display">');
    expect(html).toContain("Det kostar $5 och $10.");
    expect(html).toContain("<code>$x$</code>");
    expect(renderMarkdown("$\\frac{1}{$")).toContain("katex"); // malformed maths does not throw
    // a formula inside a callout keeps the callout intact and does not swallow the ">" markers
    const quoted = renderMarkdown("> [!note] Zeeman\n> Skiftet är\n>\n> $$\n> \\Delta E = \\mu_B B\n> $$\n>\n> Slut.");
    expect(quoted).toMatch(/<blockquote class="callout callout-note">[\s\S]*math-block[\s\S]*<p>Slut\.<\/p>\s*<\/blockquote>/);
    expect(quoted).not.toContain("&gt;");
  });

  it("links pages by title and marks missing ones", () => {
    const html = renderMarkdown("Se [[Kvantfysik]] och [[Finns inte|den här]]. `[[kod]]`", { resolvePage: (t) => (t === "Kvantfysik" ? 7 : null) });
    expect(html).toContain('<a class="wikilink" href="/notes/7">Kvantfysik</a>');
    expect(html).toContain('<a class="wikilink wikilink-new" href="/notes/new?title=Finns%20inte">den här</a>');
    expect(html).toContain("<code>[[kod]]</code>");
    expect(wikiLinks("[[A]] [[a]] [[B|b]] `[[C]]`\n```\n[[D]]\n```")).toEqual(["A", "B"]);
  });

  it("turns a bare URL line into an embed or a Studium card, and opens external links in a new tab", () => {
    const html = renderMarkdown(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ\n\nhttps://example.com/bild.png\n\nhttps://uppsala.instructure.com/courses/1/assignments/7\n\nText med https://example.com mitt i.",
      { itemByUrl: (u) => (u.endsWith("/assignments/7") ? { title: "Lab 3: rapport", meta: "Kvantfysik F · 18 nov 23:59" } : null) },
    );
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(html).toContain('<img src="https://example.com/bild.png"');
    expect(html).toContain('<span class="item-card-title">Lab 3: rapport</span>');
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noreferrer noopener">https://example.com</a> mitt i.');
  });

  it("makes a plain-text excerpt", () => {
    expect(excerpt("# Rubrik\n\n- [ ] Läs **kapitel 4** om [[Väteatomen|väte]] $x$\n\n```\nkod\n```")).toBe("Rubrik Läs kapitel 4 om väte $x$");
  });
});

describe("pages, links and backlinks", () => {
  it("resolves links both ways, including to pages created later, and cleans up on delete", () => {
    const db = createDb(":memory:");
    const a = createDoc(db, { title: "Väteatomen", content: "Se även [[Störningsräkning]]." });
    expect(getBacklinks(db, a.id)).toEqual([]);
    const b = createDoc(db, { title: "Störningsräkning", content: "Bygger på [[väteatomen]]." }); // case-insensitive
    expect(getBacklinks(db, a.id)).toEqual([{ id: b.id, title: "Störningsräkning" }]);
    expect(getBacklinks(db, b.id)).toEqual([{ id: a.id, title: "Väteatomen" }]); // a's link became real when b was created
    expect(renderDoc(db, a.content, "sv")).toContain(`href="/notes/${b.id}"`);

    saveDoc(db, b.id, { content: "Ingen länk längre." });
    expect(getBacklinks(db, a.id)).toEqual([]);
    const child = createDoc(db, { title: "Underkapitel", parentId: a.id });
    expect(getDocTree(db).find((n) => n.id === a.id)?.children.map((c) => c.title)).toEqual(["Underkapitel"]);
    deleteDoc(db, a.id);
    expect(getBacklinks(db, b.id)).toEqual([]);
    expect(getDocTree(db).map((n) => n.id).sort()).toEqual([b.id, child.id].sort()); // the sub-page moved up, not deleted
  });

  it("creates every page and database template in both languages", () => {
    const db = createDb(":memory:");
    for (const lang of ["sv", "en"] as const) {
      for (const t of PAGE_TEMPLATES) {
        const d = createFromTemplate(db, t.key, lang, {}, new Date("2026-11-12T09:00:00Z"));
        expect(d.title.length).toBeGreaterThan(0);
        expect(() => renderDoc(db, d.content, lang)).not.toThrow();
      }
      for (const t of DB_TEMPLATES) {
        const built = createDatabase(db, t.key, lang);
        const ids = new Set(built.props.map((p) => p.id));
        for (const v of built.views) for (const ref of [v.groupBy, v.dateProp, v.endProp, v.sortBy]) if (ref) expect(ids.has(ref), `${t.key}/${v.id} -> ${ref}`).toBe(true);
      }
    }
    const review = createFromTemplate(db, "weekly_review", "sv", {}, new Date("2026-11-12T09:00:00Z"));
    expect(review.title).toBe("Veckogenomgång v. 46");
    expect(taskProgress(review.content).total).toBe(7);
    expect(renderDoc(db, createFromTemplate(db, "lab_report", "sv").content, "sv")).toContain("katex");
  });
});

describe("database views", () => {
  const props: PropDef[] = [
    { id: "status", name: "Status", type: "select", options: ["Idé", "Pågår", "Klart"] },
    { id: "due", name: "Deadline", type: "date" },
    { id: "hours", name: "Timmar", type: "number" },
    { id: "done", name: "Gjord", type: "checkbox" },
  ];
  const row = (id: number, title: string, p: Record<string, unknown>): Row => ({ id, title, props: p, updatedAt: new Date(2026, 0, id) });
  const rows = [
    row(1, "Antenn", { status: "Pågår", due: "2026-11-20", hours: 12, done: false }),
    row(2, "Blogg", { status: "Idé", hours: 2 }),
    row(3, "CV", { status: "Klart", due: "2026-11-10", hours: 10, done: true }),
    row(4, "Drönare", { status: "Pågår", due: "2026-12-01", hours: 3 }),
  ];
  const titles = (rs: Row[]) => rs.map((r) => r.title);
  const view = (v: Parameters<typeof applyView>[2]) => titles(applyView(rows, props, v, "2026-11-12"));

  it("sorts by type, keeps empty values last in both directions, and orders selects like a pipeline", () => {
    expect(view({ sortBy: "due", sortDir: "asc" })).toEqual(["CV", "Antenn", "Drönare", "Blogg"]);
    expect(view({ sortBy: "due", sortDir: "desc" })).toEqual(["Drönare", "Antenn", "CV", "Blogg"]);
    expect(view({ sortBy: "hours", sortDir: "asc" })).toEqual(["Blogg", "Drönare", "CV", "Antenn"]); // numeric, not "10" < "2"
    expect(view({ sortBy: "status" })).toEqual(["Blogg", "Antenn", "Drönare", "CV"]); // Idé, Pågår, Klart
    expect(view({ sortBy: "title", sortDir: "desc" })[0]).toBe("Drönare");
  });

  it("filters with every operator and combines filters with AND", () => {
    expect(view({ filters: [{ prop: "status", op: "is", value: "pågår" }] })).toEqual(["Antenn", "Drönare"]);
    expect(view({ filters: [{ prop: "status", op: "is_not", value: "Klart" }] })).toEqual(["Antenn", "Blogg", "Drönare"]);
    expect(view({ filters: [{ prop: "title", op: "contains", value: "r" }] })).toEqual(["Drönare"]);
    expect(view({ filters: [{ prop: "due", op: "empty" }] })).toEqual(["Blogg"]);
    expect(view({ filters: [{ prop: "due", op: "after", value: "today" }] })).toEqual(["Antenn", "Drönare"]);
    expect(view({ filters: [{ prop: "due", op: "before", value: "2026-11-15" }] })).toEqual(["CV"]);
    expect(view({ filters: [{ prop: "done", op: "is", value: "false" }] })).toEqual(["Antenn"]);
    expect(view({ filters: [{ prop: "done", op: "empty" }] })).toEqual(["Antenn", "Blogg", "Drönare"]); // unticked counts as empty
    expect(view({ filters: [{ prop: "status", op: "is", value: "Pågår" }, { prop: "due", op: "after", value: "2026-11-25" }] })).toEqual(["Drönare"]);
    expect(view({ filters: [{ prop: "deleted-prop", op: "is", value: "x" }] })).toHaveLength(4); // a filter on a removed property is ignored
  });

  it("groups into board columns in option order, keeping empty columns", () => {
    const g = groupRows([...rows, row(5, "Extra", { status: "Okänd" })], props[0]);
    expect(g.map((x) => [x.key, titles(x.rows)])).toEqual([["Idé", ["Blogg"]], ["Pågår", ["Antenn", "Drönare"]], ["Klart", ["CV"]], ["Okänd", ["Extra"]]]);
    expect(groupRows([row(1, "A", {})], props[0]).map((x) => [x.key, x.rows.length])).toEqual([["Idé", 0], ["Pågår", 0], ["Klart", 0], ["", 1]]);
  });

  it("coerces submitted values by property type", () => {
    expect(coerce(props[2], "2,5")).toBe(2.5);
    expect(coerce(props[2], "abc")).toBeNull();
    expect(coerce(props[1], "2026-11-20")).toBe("2026-11-20");
    expect(coerce(props[1], "20/11")).toBeNull();
    expect(coerce(props[3], "on")).toBe(true);
    expect(coerce(props[3], "")).toBe(false);
    expect(coerce({ id: "l", name: "Länk", type: "url" }, "github.com/x")).toBe("https://github.com/x");
    expect(coerce(props[0], "  ")).toBeNull();
  });
});

describe("full-text search", () => {
  function seed() {
    const db = createDb(":memory:");
    const now = new Date("2026-11-12T09:00:00Z");
    const course = (id: string, shortName: string, hidden = false) => db.insert(courses).values({ id, provider: "canvas", externalId: id, name: shortName, shortName, color: "#000", hidden, firstSeenAt: now, lastSeenAt: now }).run();
    course("c1", "Kvantfysik F");
    course("c2", "Gammal kurs", true);
    const item = (id: string, kind: string, courseId: string, title: string, bodyText: string) =>
      db.insert(items).values({ id, provider: "canvas", kind, externalId: id, scope: "s", courseId, title, htmlUrl: `https://uppsala.instructure.com/${id}`, bodyText, fields: {}, comparable: {}, hash: "h", firstSeenAt: now, lastSeenAt: now, changedAt: now }).run();
    item("a1", "announcement", "c1", "Labbgrupper", "Anmälan till laboration om Zeemaneffekten stänger fredag.");
    item("p1", "page", "c1", "Kursinformation", "Kursen behandlar väteatomen och störningsräkning.");
    item("h1", "announcement", "c2", "Zeemaneffekten förr", "Från en dold kurs.");
    createDoc(db, { title: "Zeemaneffekten", content: "Uppsplittring av spektrallinjer i magnetfält. $\\Delta E = \\mu_B g m_j B$" }, now);
    createDoc(db, { title: "Föreläsning 7", content: "Väteatomen: radiella vågfunktioner och övningsuppgifter." }, now);
    createTask(db, { title: "Boka labbtid för Zeeman", source: "manual" }, now);
    return db;
  }

  it("builds safe prefix queries", () => {
    expect(toFtsQuery("zeeman eff")).toBe('"zeeman" AND "eff"*');
    expect(toFtsQuery('  "; DROP TABLE x; --')).toBe('"DROP" AND "TABLE" AND "x"*');
    expect(toFtsQuery("?!")).toBeNull();
  });

  it("finds my pages, tasks and mirrored content, with my own pages first", () => {
    const db = seed();
    const hits = search(db, "zeeman");
    // my own page and task (in either order) come before mirrored content
    expect(hits.slice(0, 2).map((h) => `${h.type}:${h.title}`).sort()).toEqual(["doc:Zeemaneffekten", "task:Boka labbtid för Zeeman"]);
    expect(hits.map((h) => h.type)[2]).toBe("item");
    expect(hits).toHaveLength(3);
    expect(hits.find((h) => h.type === "doc")?.url).toMatch(/^\/notes\/\d+$/);
    expect(hits[2]).toMatchObject({ external: true, course: "Kvantfysik F", url: "https://uppsala.instructure.com/a1" });
    expect(hits[2].snippet).toContain("\u0002Zeemaneffekten\u0003");
  });

  it("ignores accents and case, requires all words, and skips hidden courses", () => {
    const db = seed();
    expect(search(db, "VATEATOMEN").map((h) => h.title).sort()).toEqual(["Föreläsning 7", "Kursinformation"]);
    expect(search(db, "ovningsuppg").map((h) => h.title)).toEqual(["Föreläsning 7"]);
    expect(search(db, "väteatomen störningsräkning").map((h) => h.title)).toEqual(["Kursinformation"]);
    expect(search(db, "dold")).toEqual([]);
    expect(search(db, "")).toEqual([]);
  });

  it("picks up new and edited pages without a manual reindex", () => {
    const db = seed();
    expect(search(db, "hamilton")).toEqual([]);
    const d = createDoc(db, { title: "Mekanik", content: "Hamiltons ekvationer." });
    expect(search(db, "hamilton").map((h) => h.title)).toEqual(["Mekanik"]);
    saveDoc(db, d.id, { content: "Lagrange i stället." });
    expect(search(db, "hamilton")).toEqual([]);
    expect(search(db, "lagrange").map((h) => h.title)).toEqual(["Mekanik"]);
    deleteDoc(db, d.id);
    expect(search(db, "lagrange")).toEqual([]);
  });
});
