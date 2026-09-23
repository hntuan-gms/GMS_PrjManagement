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
