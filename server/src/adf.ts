/**
 * Minimal Atlassian Document Format (ADF) <-> plain text conversion for the
 * `description` field. Jira Cloud v3 always returns/expects ADF for rich-text
 * fields — there is no plain-text mode. This is a deliberately lossy best-effort
 * round trip (paragraphs + line breaks only, like the hard-coded STATUS_OPTIONS
 * and IssueTypeName elsewhere in this codebase): good enough to read back what
 * this app itself wrote, not a full ADF renderer for content authored in Jira
 * (bullet lists, mentions, code blocks collapse to their bare text).
 *
 * One exception to "plain text": a bare http(s) URL is wrapped in ADF's `link`
 * mark, so a link pasted in from an import file (or typed straight into the
 * description box) — an image URL, a shared doc — lands in Jira as something
 * clickable rather than inert text. The link itself always lives on the Jira
 * issue's description field, never in this app's own overlay/database.
 */

interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface AdfNode {
  type: string;
  content?: AdfNode[];
  text?: string;
  marks?: AdfMark[];
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
/* Comments — the same plain text, plus @mentions                             */
/* -------------------------------------------------------------------------- */

/** `@[Display Name](accountId)` — how a mention travels in the text this API speaks. */
const MENTION_PATTERN = /@\[([^\]]+)\]\(([^)\s]+)\)/g;

function lineToCommentInline(line: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  let lastIndex = 0;
  for (const match of line.matchAll(MENTION_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) nodes.push(...lineToInline(line.slice(lastIndex, start)));
    nodes.push({ type: "mention", attrs: { id: match[2], text: `@${match[1]}` } } as AdfNode);
    lastIndex = start + match[0].length;
  }
  if (lastIndex < line.length) nodes.push(...lineToInline(line.slice(lastIndex)));
  return nodes;
}

/** Like textToAdf, but `@[Name](accountId)` becomes a real mention node, which is what makes Jira notify them. */
export function commentToAdf(text: string): { type: "doc"; version: 1; content: AdfNode[] } {
  const paragraphs = text.split(/\n{2,}/).map((block) => {
    const lines = block.split("\n");
    const inline: AdfNode[] = [];
    lines.forEach((line, i) => {
      if (line) inline.push(...lineToCommentInline(line));
      if (i < lines.length - 1) inline.push({ type: "hardBreak" });
    });
    return { type: "paragraph", content: inline } as AdfNode;
  });
  return { type: "doc", version: 1, content: paragraphs.length > 0 ? paragraphs : [{ type: "paragraph", content: [] }] };
}

/** Nodes whose children run together on one line; every other container stacks its children. */
const INLINE_CONTAINERS = new Set(["paragraph", "heading", "codeBlock"]);

/**
 * A comment as plain text, mentions kept as `@[Name](accountId)`. Comments are
 * often written in Jira's own editor, so lists, quotes and the like are flattened
 * to lines rather than dropped — lossy, but nothing someone wrote goes missing.
 */
export function adfToCommentText(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  const walk = (node: AdfNode): string => {
    const attrs = (node as { attrs?: Record<string, unknown> }).attrs ?? {};
    switch (node.type) {
      case "text": {
        const text = node.text ?? "";
        // A link's target would vanish on the next edit (the comment is rewritten
        // from this text), so keep it beside the words when it isn't the words.
        const href = node.marks?.find((m) => m.type === "link")?.attrs?.href;
        return typeof href === "string" && href !== text ? `${text} (${href})` : text;
      }
      case "hardBreak":
        return "\n";
      case "mention": {
        const id = String(attrs.id ?? "");
        // Brackets in a display name would break the token the client parses back out.
        const name = String(attrs.text ?? "").replace(/^@/, "").replace(/[\[\]()]/g, "");
        return id ? `@[${name || "?"}](${id})` : name;
      }
      case "emoji":
        return String(attrs.text ?? "");
      case "inlineCard":
        return String(attrs.url ?? "");
      case "listItem":
        return "• " + (node.content ?? []).map(walk).join("\n");
      default: {
        const kids = node.content ?? [];
        // Top-level blocks are paragraphs: keep the blank line textToAdf split them on.
        const glue = INLINE_CONTAINERS.has(node.type) ? "" : node.type === "doc" ? "\n\n" : "\n";
        return kids.map(walk).join(glue);
      }
    }
  };
  return walk(doc as AdfNode).trim();
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
