/**
 * Minimal Atlassian Document Format (ADF) <-> plain text conversion for the
 * `description` field. Jira Cloud v3 always returns/expects ADF for rich-text
 * fields — there is no plain-text mode. This is a deliberately lossy best-effort
 * round trip (paragraphs + line breaks only, like the hard-coded STATUS_OPTIONS
 * and IssueTypeName elsewhere in this codebase): good enough to read back what
 * this app itself wrote, not a full ADF renderer for content authored in Jira
 * (bullet lists, mentions, code blocks collapse to their bare text).
 */

interface AdfNode {
  type: string;
  content?: AdfNode[];
  text?: string;
}

export function textToAdf(text: string): { type: "doc"; version: 1; content: AdfNode[] } {
  const blocks = text.split(/\n{2,}/);
  const content: AdfNode[] = blocks.map((block) => {
    const lines = block.split("\n");
    const inline: AdfNode[] = [];
    lines.forEach((line, i) => {
      if (line) inline.push({ type: "text", text: line });
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
