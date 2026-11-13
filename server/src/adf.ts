/**
 * Atlassian Document Format (ADF) — Jira Cloud v3's only form for rich-text fields — and the text
 * this app speaks.
 *
 * Two conversions live here:
 * - `textToAdf`/`adfToText`: plain text (paragraphs, line breaks, bare URLs as links). Still used
 *   where the text is plain by nature: worklog notes, transition boxes, the KBKT import.
 * - `richToAdf`/`adfToRich`: comments and descriptions, as the small Markdown of richText.ts —
 *   headings, lists, code, quotes, marks, mentions and pictures — so what was written in Jira's
 *   own editor reads the same here and survives an edit made here.
 */

import { escapeInline, escapeLineStart, imageSources, parseBlocks, type RichBlock, type RichInline } from "./richText.js";

interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface AdfNode {
  type: string;
  content?: AdfNode[];
  text?: string;
  marks?: AdfMark[];
  attrs?: Record<string, unknown>;
}

// Bare http(s) URLs, the shape a link takes when pasted from an import file or
// typed straight into the description box — Jira's own editor auto-links these
// too, but a plain "text" node from this app's own conversion did not, so a
// pasted image/asset link rendered as inert text instead of something clickable.
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')\]]+/g;

/** One line of plain text, split into text/link nodes wherever a bare URL appears. */
function lineToInline(line: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  let lastIndex = 0;
  for (const match of line.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) nodes.push({ type: "text", text: line.slice(lastIndex, start) });

    // Trailing punctuation right after a pasted URL ("...see https://x.com/y.")
    // almost always belongs to the sentence, not the link.
    const raw = match[0];
    const url = raw.replace(/[).,;:!?]+$/, "");
    const trailingPunctuation = raw.slice(url.length);
    nodes.push({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] });
    if (trailingPunctuation) nodes.push({ type: "text", text: trailingPunctuation });

    lastIndex = start + raw.length;
  }
  if (lastIndex < line.length) nodes.push({ type: "text", text: line.slice(lastIndex) });
  return nodes;
}

export function textToAdf(text: string): { type: "doc"; version: 1; content: AdfNode[] } {
  const blocks = text.split(/\n{2,}/);
  const content: AdfNode[] = blocks.map((block) => {
    const lines = block.split("\n");
    const inline: AdfNode[] = [];
    lines.forEach((line, i) => {
      if (line) inline.push(...lineToInline(line));
      if (i < lines.length - 1) inline.push({ type: "hardBreak" });
    });
    return { type: "paragraph", content: inline };
  });
  return { type: "doc", version: 1, content: content.length > 0 ? content : [{ type: "paragraph", content: [] }] };
}

export function adfToText(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  const walk = (node: AdfNode): string => {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "hardBreak") return "\n";
    if (Array.isArray(node.content)) return node.content.map(walk).join("");
    return "";
  };
  const root = doc as AdfNode;
  const paragraphs = (root.content ?? []).map(walk);
  return paragraphs.join("\n\n").trim();
}

/* -------------------------------------------------------------------------- */
/* Rich text — comments and descriptions as the Markdown of richText.ts        */
/* -------------------------------------------------------------------------- */

/** How a picture is written into ADF: a file Jira's media service holds, or a public URL. */
export type MediaRef = { kind: "file"; id: string; collection?: string } | { kind: "external"; url: string };

export interface RichToAdfOptions {
  /** A picture's `src` → what to write. Unresolved (`undefined`) pictures become a line naming the file. */
  media?: (src: string) => MediaRef | undefined;
}

type AnyNode = AdfNode & { attrs?: Record<string, unknown> };

function inlineToAdf(nodes: RichInline[]): AnyNode[] {
  const out: AnyNode[] = [];
  for (const n of nodes) {
    if (n.t === "br") out.push({ type: "hardBreak" });
    else if (n.t === "mention") out.push({ type: "mention", attrs: { id: n.id, text: `@${n.name}` } });
    else if (n.text) {
      // ADF lets `code` share a text node with a link only.
      const code = n.marks.some((m) => m.type === "code");
      const marks = n.marks
        .filter((m) => !code || m.type === "code" || m.type === "link")
        .map((m): AdfMark => (m.type === "link" ? { type: "link", attrs: { href: m.href } } : { type: m.type }));
      out.push(marks.length ? { type: "text", text: n.text, marks } : { type: "text", text: n.text });
    }
  }
  return out;
}

function blocksToAdf(blocks: RichBlock[], opts: RichToAdfOptions, inQuote = false): AnyNode[] {
  const out: AnyNode[] = [];
  for (const b of blocks) {
    switch (b.t) {
      case "p":
        out.push({ type: "paragraph", content: inlineToAdf(b.content) });
        break;
      case "h":
        // A heading may not sit inside a quote: there it is a bold line.
        out.push(
          inQuote
            ? { type: "paragraph", content: inlineToAdf(b.content.map((n) => (n.t === "text" ? { ...n, marks: [...n.marks, { type: "strong" as const }] } : n))) }
            : { type: "heading", attrs: { level: Math.min(6, Math.max(1, b.level)) }, content: inlineToAdf(b.content) }
        );
        break;
      case "ul":
      case "ol": {
        const items = b.items.map((item): AnyNode => {
          const content = blocksToAdf(item, opts, inQuote).filter((n) => n.type !== "rule" && n.type !== "heading" && n.type !== "blockquote");
          // A list item starts with a paragraph.
          if (content[0]?.type !== "paragraph") content.unshift({ type: "paragraph", content: [] });
          return { type: "listItem", content };
        });
        out.push(b.t === "ul" ? { type: "bulletList", content: items } : { type: "orderedList", attrs: { order: b.start }, content: items });
        break;
      }
      case "code":
        out.push({
          type: "codeBlock",
          ...(b.lang ? { attrs: { language: b.lang } } : {}),
          ...(b.text ? { content: [{ type: "text", text: b.text }] } : {}),
        });
        break;
      case "quote":
        if (inQuote) out.push(...blocksToAdf(b.content, opts, true));
        else out.push({ type: "blockquote", content: blocksToAdf(b.content, opts, true).filter((n) => n.type !== "rule") });
        break;
      case "rule":
        out.push({ type: "rule" });
        break;
      case "image": {
        const ref = opts.media?.(b.src) ?? (/^https:\/\//.test(b.src) ? ({ kind: "external", url: b.src } as MediaRef) : undefined);
        if (!ref) {
          // Not resolvable (a file that is gone): its name stays, so nothing is silently dropped.
          out.push({ type: "paragraph", content: [{ type: "text", text: `[${b.alt || "Ảnh"}]` }] });
          break;
        }
        const media: AnyNode =
          ref.kind === "file"
            ? { type: "media", attrs: { type: "file", id: ref.id, collection: ref.collection ?? "", ...(b.alt ? { alt: b.alt } : {}) } }
            : { type: "media", attrs: { type: "external", url: ref.url, ...(b.alt ? { alt: b.alt } : {}) } };
        out.push({ type: "mediaSingle", attrs: { layout: "center" }, content: [media] });
        break;
      }
    }
  }
  return out;
}

/** The text people type (richText.ts) as the ADF Jira stores. */
export function richToAdf(text: string, opts: RichToAdfOptions = {}): { type: "doc"; version: 1; content: AdfNode[] } {
  const content = blocksToAdf(parseBlocks(text), opts);
  return { type: "doc", version: 1, content: content.length > 0 ? content : [{ type: "paragraph", content: [] }] };
}

export interface AdfToRichOptions {
  /** A media file's id → the attachment it is, so the panel can draw it. */
  attachmentOf?: (mediaId: string) => { id: string; filename: string } | undefined;
}

/** The marks that nest, outermost first. `code` is not among them: it is written per node, inside them. */
const STACKED = ["link", "strong", "em", "strike"];
const markKey = (m: AdfMark) => (m.type === "link" ? `link ${String(m.attrs?.href ?? "")}` : m.type);
const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

/** Everything inline that is not a text node. */
function otherInline(n: AnyNode, opts: AdfToRichOptions): string {
  const attrs = n.attrs ?? {};
  switch (n.type) {
    case "hardBreak":
      return "\n";
    case "mention": {
      const id = String(attrs.id ?? "");
      const name = String(attrs.text ?? "").replace(/^@/, "").replace(/[\[\]()\n]/g, "");
      return id ? `@[${name || "?"}](${id})` : escapeInline(name);
    }
    case "emoji":
      return String(attrs.text ?? attrs.shortName ?? "");
    case "inlineCard":
    case "blockCard":
      return String(attrs.url ?? "");
    case "date": {
      const d = new Date(Number(attrs.timestamp));
      return Number.isNaN(d.getTime()) ? "" : `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
    }
    case "status":
      return escapeInline(String(attrs.text ?? ""));
    case "mediaInline":
      return escapeInline(`[${String(attrs.alt ?? "tệp")}]`);
    default:
      return inlineToRich(n.content, opts);
  }
}

/**
 * Text nodes with their marks, written as one run: a mark shared by neighbouring nodes is opened
 * once ("**a *b***" would read two ways), spaces at a mark's edges go outside its delimiters, and
 * italic is `_x_` unless it touches a word (only `*x*` works inside one).
 */
function inlineToRich(nodes: AnyNode[] | undefined, opts: AdfToRichOptions): string {
  const list = nodes ?? [];
  const usable = (n: AnyNode | undefined) =>
    n?.type === "text"
      ? (n.marks ?? []).filter((m) => STACKED.includes(m.type) && (m.type !== "link" || /^(https?:|mailto:)/.test(String(m.attrs?.href ?? ""))))
      : [];
  let out = "";
  let pending = "";
  const stack: Array<{ key: string; close: string }> = [];
  const closeTo = (keep: number) => {
    while (stack.length > keep) out += stack.pop()!.close;
  };
  const flush = () => {
    out += pending;
    pending = "";
  };
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    if (n.type !== "text") {
      closeTo(0);
      flush();
      out += otherInline(n, opts);
      continue;
    }
    const text = n.text ?? "";
    const lead = /^\s*/.exec(text)![0];
    const core = text.slice(lead.length).trimEnd();
    if (!core) {
      // Spaces alone: inside the marks if the next node carries them on, outside if not.
      pending += text;
      continue;
    }
    const trail = text.slice(lead.length + core.length);
    const marks = usable(n);
    const keys = marks.map(markKey);
    const code = (n.marks ?? []).some((m) => m.type === "code");
    let keep = 0;
    while (keep < stack.length && keys.includes(stack[keep].key)) keep++;
    closeTo(keep);
    flush();
    out += lead;

    const href = marks.find((m) => m.type === "link")?.attrs?.href;
    // A link whose words are its address is written bare, as it was typed.
    if (
      typeof href === "string" &&
      marks.length === 1 &&
      !code &&
      stack.length === 0 &&
      core === href &&
      escapeInline(core) === core &&
      !isWordChar(out.slice(-1)) &&
      markKey(marks[0]) !== usable(list[i + 1]).map(markKey).find((k) => k.startsWith("link"))
    ) {
      out += href;
      pending = trail;
      continue;
    }

    for (const m of [...marks].sort((a, b) => STACKED.indexOf(a.type) - STACKED.indexOf(b.type))) {
      const key = markKey(m);
      if (stack.some((o) => o.key === key)) continue;
      if (m.type === "link") {
        out += "[";
        stack.push({ key, close: `](${String(m.attrs?.href ?? "").replace(/[\s)]/g, encodeURIComponent)})` });
      } else if (m.type === "strong") {
        out += "**";
        stack.push({ key, close: "**" });
      } else if (m.type === "strike") {
        out += "~~";
        stack.push({ key, close: "~~" });
      } else {
        // Where this italic run ends decides what follows its closing mark.
        let j = i;
        while (j + 1 < list.length && (usable(list[j + 1]).some((x) => x.type === "em") || (list[j + 1].type === "text" && !(list[j + 1].text ?? "").trim()))) j++;
        while (j > i && !(list[j].text ?? "").trim()) j--;
        const endText = list[j].text ?? "";
        const after = /\s$/.test(endText) ? " " : list[j + 1]?.type === "text" ? (list[j + 1].text ?? "").slice(0, 1) : "";
        const delim = isWordChar(out.slice(-1)) || isWordChar(after) ? "*" : "_";
        out += delim;
        stack.push({ key, close: delim });
      }
    }
    const inLink = stack.some((o) => o.key.startsWith("link"));
    if (code) out += "`" + core.replace(/`/g, "'") + "`";
    else out += inLink ? escapeInline(core).replace(/\]/g, "\]") : escapeInline(core);
    pending = trail;
  }
  closeTo(0);
  flush();
  return out;
}

/** A paragraph's text with any line that would start a block escaped. */
const paragraphLines = (s: string) => s.split("\n").map(escapeLineStart).join("\n");

const indentLines = (s: string, by: string) =>
  s
    .split("\n")
    .map((l) => (l ? by + l : l))
    .join("\n");

function mediaToRich(node: AnyNode, opts: AdfToRichOptions): string | null {
  const a = node.attrs ?? {};
  const alt = String(a.alt ?? "").replace(/[\]\n]/g, " ").trim();
  if (a.type === "external" && typeof a.url === "string") return `![${alt}](${a.url.replace(/[\s)]/g, encodeURIComponent)})`;
  const id = typeof a.id === "string" ? a.id : "";
  if (!id) return null;
  const att = opts.attachmentOf?.(id);
  if (att) return `![${alt || att.filename.replace(/[\]\n]/g, " ")}](attachment:${att.id})`;
  return /^[\w-]{8,64}$/.test(id) ? `![${alt}](media:${id})` : null;
}

function blockToRich(node: AnyNode, opts: AdfToRichOptions): string {
  const attrs = node.attrs ?? {};
  const kids = node.content ?? [];
  switch (node.type) {
    case "paragraph":
      return paragraphLines(inlineToRich(kids, opts));
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(attrs.level) || 1));
      return `${"#".repeat(level)} ${inlineToRich(kids, opts).replace(/\n/g, " ")}`;
    }
    case "bulletList":
    case "orderedList": {
      const start = Number(attrs.order) || 1;
      return kids
        .map((item, i) => {
          const marker = node.type === "bulletList" ? "- " : `${start + i}. `;
          const body = (item.type === "listItem" ? item.content ?? [] : [item]).map((b) => blockToRich(b, opts)).filter((s) => s !== "");
          const text = body.join("\n");
          // The first line follows the marker; every other line is indented under it.
          const [first, ...rest] = text.split("\n");
          return marker + (first ?? "") + (rest.length ? "\n" + indentLines(rest.join("\n"), " ".repeat(marker.length)) : "");
        })
        .join("\n");
    }
    case "taskList":
    case "decisionList":
      return kids
        .map((item) => {
          const done = item.attrs?.state === "DONE" || item.attrs?.state === "DECIDED";
          const mark = node.type === "taskList" ? (done ? "[x] " : "[ ] ") : "";
          return `- ${escapeInline(mark)}${inlineToRich(item.content, opts).replace(/\n/g, " ")}`;
        })
        .join("\n");
    case "codeBlock": {
      const lang = typeof attrs.language === "string" && /^[\w+#.-]+$/.test(attrs.language) ? attrs.language : "";
      const text = kids.map((k) => k.text ?? "").join("").replace(/^```/gm, "ʼʼʼ");
      return "```" + lang + "\n" + text + "\n```";
    }
    case "blockquote":
    case "panel": {
      const inner = kids.map((b) => blockToRich(b, opts)).filter((s) => s !== "").join("\n\n");
      return inner
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n");
    }
    case "rule":
      return "---";
    case "mediaSingle":
    case "mediaGroup":
      return kids
        .map((m) => (m.type === "media" ? mediaToRich(m, opts) : null))
        .filter((s): s is string => !!s)
        .join("\n");
    case "media":
      return mediaToRich(node, opts) ?? "";
    case "table":
      // No table in the text: each row is one line, cells divided by a bar.
      return kids
        .map((row) =>
          (row.content ?? [])
            .map((cell) => (cell.content ?? []).map((b) => blockToRich(b, opts).replace(/\n+/g, " ")).join(" "))
            .join(" | ")
        )
        .map(escapeLineStart)
        .join("\n");
    case "expand":
    case "nestedExpand": {
      const title = typeof attrs.title === "string" && attrs.title ? `**${escapeInline(attrs.title)}**\n\n` : "";
      return title + kids.map((b) => blockToRich(b, opts)).filter((s) => s !== "").join("\n\n");
    }
    case "blockCard":
    case "embedCard":
      return String(attrs.url ?? "");
    default:
      if (kids.length === 0) return "";
      // Unknown containers keep their children; unknown inline runs keep their text.
      return kids.every((k) => k.type === "text" || k.type === "hardBreak" || k.type === "mention")
        ? paragraphLines(inlineToRich(kids, opts))
        : kids.map((b) => blockToRich(b, opts)).filter((s) => s !== "").join("\n\n");
  }
}

/** Jira's ADF as the text people type (richText.ts): what it shows reads back the same way. */
export function adfToRich(doc: unknown, opts: AdfToRichOptions = {}): string {
  if (!doc || typeof doc !== "object") return "";
  const root = doc as AnyNode;
  return (root.content ?? [])
    .map((b) => blockToRich(b, opts))
    .filter((s) => s.trim() !== "")
    .join("\n\n")
    .trim();
}

/** Every media file id the document shows — what has to be matched to attachments. */
export function adfMediaIds(doc: unknown): string[] {
  const out: string[] = [];
  const walk = (n: AnyNode | null | undefined) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "media" && n.attrs?.type === "file" && typeof n.attrs.id === "string") out.push(n.attrs.id);
    (n.content ?? []).forEach(walk);
  };
  walk(doc as AnyNode);
  return out;
}

/** Every picture `src` a rich text shows. */
export function richImageSources(text: string): string[] {
  return imageSources(parseBlocks(text));
}

/* -------------------------------------------------------------------------- */
/* Sectioned descriptions — the KBKT import's layout                          */
/* -------------------------------------------------------------------------- */

/**
 * "### Heading" + body pairs, empty bodies skipped — byte-for-byte the layout
 * jira_sync.py writes, so a re-sync from the site compares equal to what the
 * script created and does not rewrite every description it finds.
 */
export function sectionsToAdf(sections: Array<[string, string]>): { type: "doc"; version: 1; content: AdfNode[] } {
  const content: AdfNode[] = [];
  for (const [head, body] of sections) {
    if (!body) continue;
    content.push({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: head }] } as AdfNode);
    const para: AdfNode[] = [];
    body.split("\n").forEach((line, i) => {
      if (i) para.push({ type: "hardBreak" });
      if (line) para.push({ type: "text", text: line });
    });
    content.push({ type: "paragraph", content: para });
  }
  return { type: "doc", version: 1, content };
}

/**
 * A description reduced to its non-blank lines, for "did it change?" — the
 * script's `norm(adf_text(...))`. Formatting Jira adds or drops on a round
 * trip (marks, blank paragraphs, trailing spaces) does not count as a change.
 */
export function adfComparable(doc: unknown): string {
  const walk = (node: AdfNode | null | undefined): string => {
    if (!node) return "";
    if (node.type === "text") return node.text ?? "";
    if (node.type === "hardBreak") return "\n";
    const sep = node.type === "paragraph" || node.type === "heading" ? "" : "\n";
    return (node.content ?? []).map(walk).join(sep);
  };
  const flat = doc && typeof doc === "object" ? walk(doc as AdfNode) : "";
  return flat
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim())
    .join("\n");
}
