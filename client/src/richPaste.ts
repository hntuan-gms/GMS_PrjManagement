import { escapeInline, escapeLineStart } from "./richText";

/**
 * Text pasted from a page (Jira, Google Docs, Confluence, a web page) as the Markdown of richText.ts,
 * so headings, lists, bold and links survive the paste instead of arriving as loose lines. A paste
 * with none of that structure (a plain page, a code editor, a spreadsheet) returns null and the box
 * takes the plain text as before. Reads the DOM only through `Node`/`Element`, never through
 * innerHTML into the page.
 */

const STRUCTURE = "h1,h2,h3,h4,h5,h6,ul,ol,li,pre,blockquote,strong,b,em,i,s,del,strike,code,a[href]";

const BLOCKS = new Set(["P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "TABLE", "TR", "FIGURE", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "PRE", "BLOCKQUOTE", "HR"]);

type Marks = { strong?: boolean; em?: boolean; strike?: boolean; code?: boolean; href?: string };

function styleMarks(el: Element, m: Marks): Marks {
  const style = (el.getAttribute("style") ?? "").toLowerCase();
  const next = { ...m };
  const weight = /font-weight\s*:\s*(\w+)/.exec(style)?.[1];
  // Google Docs wraps a whole paste in <b style="font-weight:normal">; its bold is a span of 700.
  if (weight) next.strong = weight === "bold" || Number(weight) >= 600;
  if (/font-style\s*:\s*italic/.test(style)) next.em = true;
  if (/text-decoration[^;]*line-through/.test(style)) next.strike = true;
  return next;
}

function inline(node: Node, m: Marks): string {
  if (node.nodeType === 3) {
    const text = (node.textContent ?? "").replace(/[\s ]+/g, " ");
    if (!text.trim()) return text ? " " : "";
    if (m.code) return "`" + text.replace(/`/g, "'") + "`";
    let s = escapeInline(text.trim());
    if (m.strike) s = `~~${s}~~`;
    if (m.em) s = `_${s}_`;
    if (m.strong) s = `**${s}**`;
    if (m.href) s = `[${s.replace(/\]/g, "\\]")}](${m.href})`;
    const lead = /^\s/.test(text) ? " " : "";
    const trail = /\s$/.test(text) ? " " : "";
    return lead + s + trail;
  }
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const tag = el.tagName;
  if (tag === "BR") return "\n";
  if (tag === "IMG") return "";
  let next = styleMarks(el, m);
  if (tag === "STRONG" || (tag === "B" && next.strong !== false && !/font-weight\s*:\s*(normal|400)/i.test(el.getAttribute("style") ?? ""))) next = { ...next, strong: true };
  if (tag === "EM" || tag === "I") next = { ...next, em: true };
  if (tag === "S" || tag === "DEL" || tag === "STRIKE") next = { ...next, strike: true };
  if (tag === "CODE" || tag === "KBD" || tag === "SAMP") next = { ...next, code: true };
  if (tag === "A") {
    const href = el.getAttribute("href") ?? "";
    if (/^(https?:|mailto:)/.test(href) && !m.href) {
      // An address whose words are the address is pasted bare.
      if ((el.textContent ?? "").trim() === href) return href;
      next = { ...next, href: href.replace(/[\s)]/g, encodeURIComponent) };
    }
  }
  return [...el.childNodes].map((c) => inline(c, next)).join("");
}

const tidy = (s: string) => s.replace(/ *\n */g, "\n").trim();

const BLOCK_SELECTOR = [...BLOCKS].join(",").toLowerCase();

function blocks(node: Node): string[] {
  const out: string[] = [];
  let run = "";
  const end = () => {
    const t = tidy(run);
    if (t) out.push(t.split("\n").map(escapeLineStart).join("\n"));
    run = "";
  };
  for (const c of [...node.childNodes]) {
    if (c.nodeType !== 1 || !BLOCKS.has((c as Element).tagName)) {
      // An inline wrapper around blocks (Google Docs puts the whole paste in one <b>) is a container.
      if (c.nodeType === 1 && (c as Element).querySelector(BLOCK_SELECTOR)) {
        end();
        out.push(...blocks(c));
      } else run += inline(c, {});
      continue;
    }
    end();
    const el = c as Element;
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) {
      const t = tidy(inline(el, {})).replace(/\n/g, " ");
      if (t) out.push(`${"#".repeat(Number(tag[1]))} ${t}`);
    } else if (tag === "UL" || tag === "OL") {
      const start = Number(el.getAttribute("start")) || 1;
      const items = [...el.children].filter((x) => x.tagName === "LI");
      out.push(
        items
          .map((li, i) => {
            const marker = tag === "UL" ? "- " : `${start + i}. `;
            const body = blocks(li).join("\n");
            const [first, ...rest] = body.split("\n");
            const pad = " ".repeat(marker.length);
            return marker + (first ?? "") + (rest.length ? "\n" + rest.map((l) => (l ? pad + l : l)).join("\n") : "");
          })
          .join("\n")
      );
    } else if (tag === "PRE") {
      out.push("```\n" + (el.textContent ?? "").replace(/\n$/, "").replace(/^```/gm, "ʼʼʼ") + "\n```");
    } else if (tag === "BLOCKQUOTE") {
      const inner = blocks(el).join("\n\n");
      if (inner) out.push(inner.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n"));
    } else if (tag === "HR") {
      out.push("---");
    } else if (tag === "TR") {
      const cells = [...el.children].map((td) => tidy(inline(td, {})).replace(/\n/g, " "));
      out.push(cells.join(" | "));
    } else {
      out.push(...blocks(el));
    }
  }
  end();
  return out;
}

/** The pasted HTML as rich text, or null when it carries nothing the plain text would lose. */
export function htmlToRich(html: string): string | null {
  if (!html || typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  // A spreadsheet's cells are better as the tab-separated text the browser already offers.
  if (body.querySelector("table") && !body.querySelector("h1,h2,h3,ul,ol,pre")) return null;
  if (!body.querySelector(STRUCTURE)) return null;
  const text = blocks(body).join("\n\n").trim();
  return text || null;
}
