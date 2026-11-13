import katex from "katex";
import MarkdownIt from "markdown-it";

/**
 * Page content is Markdown with a few additions:
 *   - [ ] task          checklist items, tickable in the rendered page
 *   > [!note] Title     callouts (note, tip, warning, important)
 *   $x^2$ and $$...$$   LaTeX maths, rendered with KaTeX
 *   [[Page title]]      links between pages ([[Title|shown text]])
 *   a URL on its own line becomes an embed (YouTube, image) or, for a mirrored Studium item, a card
 * Raw HTML in the source is NOT rendered, so pasted content cannot inject markup.
 */

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));
md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
  const href = String(tokens[idx].attrGet("href") ?? "");
  if (/^https?:\/\//i.test(href)) {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel", "noreferrer noopener");
  }
  return defaultLinkOpen(tokens, idx, opts, env, self);
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const CODE = /(^```[\s\S]*?^```[^\n]*$|^~~~[\s\S]*?^~~~[^\n]*$|`[^`\n]+`)/gm;

/** Applies `fn` to everything except fenced and inline code. */
function outsideCode(source: string, fn: (text: string) => string): string {
  return source.split(CODE).map((part, i) => (i % 2 === 1 ? part : fn(part))).join("");
}

const WIKI = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g;

/** Titles of all [[links]] in a page, in order, without duplicates. */
export function wikiLinks(source: string): string[] {
  const out: string[] = [];
  outsideCode(source, (text) => {
    for (const m of text.matchAll(WIKI)) {
      const title = m[1].trim();
      if (title && !out.some((t) => t.toLowerCase() === title.toLowerCase())) out.push(title);
    }
    return text;
  });
  return out;
}

const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/;

/** Flips the n-th checklist item (0-based, in document order) between [ ] and [x]. */
export function toggleTask(source: string, index: number): string {
  let n = -1;
  let fence: string | null = null;
  return source
    .split("\n")
    .map((line) => {
      const f = line.match(/^\s*(```|~~~)/);
      if (f) fence = fence === null ? f[1] : fence === f[1] ? null : fence;
      if (fence !== null || f) return line;
      const m = line.match(TASK_LINE);
      if (!m) return line;
      n++;
      return n === index ? line.replace(TASK_LINE, `$1[${m[2] === " " ? "x" : " "}]`) : line;
    })
    .join("\n");
}

export function taskProgress(source: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  outsideCode(source, (text) => {
    for (const line of text.split("\n")) {
      const m = line.match(TASK_LINE);
      if (m) {
        total++;
        if (m[2] !== " ") done++;
      }
    }
    return text;
  });
  return { done, total };
}

export type RenderContext = {
  /** page id for a [[title]], or null when no such page exists yet */
  resolvePage?: (title: string) => number | null;
  /** the mirrored item behind a Studium URL, if any */
  itemByUrl?: (url: string) => { title: string; meta: string } | null;
};

const CALLOUT_LABEL: Record<string, string> = { note: "Note", tip: "Tips", warning: "Varning", important: "Viktigt", info: "Info" };

function embed(url: string, ctx: RenderContext): string | null {
  const yt = url.match(/^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?(?:[^"]*&(?:amp;)?)?v=|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `<div class="embed-video"><iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}" loading="lazy" allowfullscreen title="Video"></iframe></div>`;
  if (/\.(?:png|jpe?g|gif|webp|svg)(?:\?[^"]*)?$/i.test(url)) return `<p><img src="${url}" alt="" loading="lazy"></p>`;
  const item = ctx.itemByUrl?.(url.replace(/&amp;/g, "&"));
  if (item) return `<a class="item-card" href="${url}" target="_blank" rel="noreferrer noopener"><span class="item-card-title">${esc(item.title)}</span><span class="item-card-meta">${esc(item.meta)}</span></a>`;
  return null;
}

export function renderMarkdown(source: string, ctx: RenderContext = {}): string {
  const held: string[] = [];
  // Private-use characters survive Markdown untouched, so they make safe placeholders.
  const hold = (html: string, block = false) => `${block ? "\n\n" : ""}${held.push(html) - 1}${block ? "\n\n" : ""}`;
  const tex = (code: string, displayMode: boolean) => {
    try {
      return katex.renderToString(code.trim(), { displayMode, throwOnError: false, output: "htmlAndMathml" });
    } catch {
      return `<code>${esc(code)}</code>`;
    }
  };

  const prepared = outsideCode(source, (text) =>
    text
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, code: string) => {
        // Inside a quote or callout every line starts with ">": that is Markdown, not part of the formula,
        // and the placeholder must not add blank lines there or it would end the quote.
        const quoted = /\n\s*>/.test(code);
        const clean = quoted ? code.replace(/^\s*>\s?/gm, "") : code;
        return hold(`<div class="math-block">${tex(clean, true)}</div>`, !quoted);
      })
      .replace(/(?<![\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\w$])/g, (_, code: string) => hold(tex(code, false)))
      .replace(WIKI, (_, rawTitle: string, label?: string) => {
        const title = rawTitle.trim();
        const id = ctx.resolvePage?.(title) ?? null;
        const text2 = esc((label ?? title).trim());
        return hold(id !== null ? `<a class="wikilink" href="/notes/${id}">${text2}</a>` : `<a class="wikilink wikilink-new" href="/notes/new?title=${encodeURIComponent(title)}">${text2}</a>`);
      }),
  );

  let task = -1;
  let html = md
    .render(prepared)
    .replace(/<li>(\s*(?:<p>)?)\[( |x|X)\]\s+/g, (_, lead: string, mark: string) => `<li class="task">${lead}<input type="checkbox" data-task="${++task}"${mark === " " ? "" : " checked"}> `)
    .replace(/<blockquote>\s*<p>\[!(note|tip|warning|important|info)\][ \t]*([^\n<]*)\n?/gi, (_, kind: string, title: string) =>
      `<blockquote class="callout callout-${kind.toLowerCase()}"><p class="callout-title">${title.trim() || CALLOUT_LABEL[kind.toLowerCase()]}</p><p>`)
    .replace(/<p>\s*<\/p>/g, "")
    .replace(/<p><a href="(https?:\/\/[^"]+)"[^>]*>[^<]*<\/a><\/p>/g, (whole, url: string) => embed(url, ctx) ?? whole)
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, "</table></div>");

  html = html.replace(/<p>(\d+)<\/p>/g, (_, i: string) => held[+i]).replace(/(\d+)/g, (_, i: string) => held[+i]);
  return html;
}

/** First readable line of a page, for cards and search results. */
export function excerpt(source: string, max = 160): string {
  const text = source
    .replace(CODE, " ")
    .replace(/\$\$[\s\S]+?\$\$/g, " ")
    .replace(/^[#>\-*+\s\d.)[\]xX!]+/gm, "")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a: string, b?: string) => b ?? a)
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
