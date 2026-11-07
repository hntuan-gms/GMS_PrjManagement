/**
 * A description read as a page, not as the box it is typed in: paragraphs, bullet and numbered lists,
 * and links that can be opened. Jira hands the description over as plain text with newlines (adf.ts on
 * the server flattens it), so this only recognises what a person types: "- ", "* ", "• " and "1. ".
 * Pure; the panel turns the result into React elements, never innerHTML, since anyone on the project
 * may have written the text.
 */

export type DescBlock =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

const BULLET = /^\s*(?:[-*•]|–)\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;

export function describeBlocks(text: string): DescBlock[] {
  const blocks: DescBlock[] = [];
  let cur: DescBlock | null = null;
  const close = () => {
    cur = null;
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      close();
      continue;
    }
    const bullet = BULLET.exec(line);
    const number = bullet ? null : NUMBER.exec(line);
    if (bullet) {
      if (cur?.kind !== "ul") blocks.push((cur = { kind: "ul", items: [] }));
      cur.items.push(bullet[1]);
    } else if (number) {
      if (cur?.kind !== "ol") blocks.push((cur = { kind: "ol", items: [] }));
      cur.items.push(number[1]);
    } else {
      // A line after a list that is not an item continues the paragraph below it, not the list.
      if (cur?.kind !== "p") blocks.push((cur = { kind: "p", lines: [] }));
      cur.lines.push(line);
    }
  }
  return blocks;
}

export type TextPiece = string | { url: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/g;

/** The text cut into plain runs and links; trailing punctuation stays outside the link. */
export function linkPieces(text: string): TextPiece[] {
  const out: TextPiece[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const at = m.index ?? 0;
    const url = m[0].replace(/[.,;:!?]+$/, "");
    if (at > last) out.push(text.slice(last, at));
    out.push({ url });
    last = at + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
