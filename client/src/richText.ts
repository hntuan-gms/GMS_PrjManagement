/**
 * The rich text this app speaks for comments and descriptions: a small Markdown, read into blocks.
 *
 * MIRRORED, byte for byte, in client/src/richText.ts (the panel draws what the server will send to
 * Jira); client/test/richText.test.ts runs the same cases over both and checks the two files are equal.
 *
 * Why Markdown and not Jira's ADF on the wire: the box people type in is a text area, Jira's own editor
 * takes the same shortcuts ("- ", "1. ", "# ", "```", "**"), and a comment must survive an edit in this
 * app without losing what was written in Jira. adf.ts turns these blocks into ADF and ADF back into
 * this text (`adfToRich`), escaping whatever would otherwise be read as formatting.
 *
 *   # .. ######        heading            - / * / + / •   bullet list (indent 2+ to nest)
 *   1. / 1)            numbered list      > ...           quote
 *   ```lang ... ```    code block         ---             rule
 *   ![name](src)       a picture on its own line: src is attachment:<id>, media:<uuid> or https://…
 *   **bold** *italic* _italic_ ~~struck~~ `code` [words](https://…) bare https://… @[Name](accountId)
 *   \x                 x as it is (any punctuation)
 *
 * Pure, no DOM, no React.
 */

export type RichMark =
  | { type: "strong" }
  | { type: "em" }
  | { type: "strike" }
  | { type: "code" }
  | { type: "link"; href: string };

export type RichInline =
  | { t: "text"; text: string; marks: RichMark[] }
  | { t: "mention"; id: string; name: string }
  | { t: "br" };

export type RichBlock =
  | { t: "p"; content: RichInline[] }
  | { t: "h"; level: number; content: RichInline[] }
  | { t: "ul"; items: RichBlock[][] }
  | { t: "ol"; start: number; items: RichBlock[][] }
  | { t: "code"; lang: string; text: string }
  | { t: "quote"; content: RichBlock[] }
  | { t: "rule" }
  | { t: "image"; alt: string; src: string };

/* ------------------------------------------------------------------ inline */

/** A bare address ends at a space, a bracket, or what would be formatting ("**https://x**"). */
const URL_AT = /^https?:\/\/[^\s<>"'\])\\`*]+/;
const MENTION_AT = /^@\[([^\]\n]+)\]\(([^)\s]+)\)/;
const LINK_AT = /^\[((?:\\.|[^\]\\\n])+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/;
/** What a backslash may make literal: anything that is not a letter, digit or space. */
const ESCAPABLE = /[^\p{L}\p{N}\s]/u;

/** The index of the next unescaped `delim` at or after `from`, or -1. */
function closing(s: string, delim: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      i++;
      continue;
    }
    if (s.startsWith(delim, i)) return i;
  }
  return -1;
}

const isWord = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

const sameMarks =(a: RichMark[], b: RichMark[]) => JSON.stringify(a) === JSON.stringify(b);

export function parseInline(s: string, marks: RichMark[] = []): RichInline[] {
  const out: RichInline[] = [];
  let buf = "";
  const flush = () => {
    if (!buf) return;
    const last = out[out.length - 1];
    if (last?.t === "text" && sameMarks(last.marks, marks)) last.text += buf;
    else out.push({ t: "text", text: buf, marks });
    buf = "";
  };
  const push = (nodes: RichInline[]) => {
    flush();
    for (const n of nodes) {
      const last = out[out.length - 1];
      if (n.t === "text" && last?.t === "text" && sameMarks(last.marks, n.marks)) last.text += n.text;
      else out.push(n);
    }
  };
  const has = (type: RichMark["type"]) => marks.some((m) => m.type === type);
  const prevChar = (i: number) => (i > 0 ? s[i - 1] : " ");

  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const rest = s.slice(i);
    if (c === "\\" && i + 1 < s.length && ESCAPABLE.test(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === "\n") {
      flush();
      out.push({ t: "br" });
      i++;
      continue;
    }
    if (c === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i + 1) {
        push([{ t: "text", text: s.slice(i + 1, end), marks: [...marks.filter((m) => m.type === "link"), { type: "code" }] }]);
        i = end + 1;
        continue;
      }
    }
    if (c === "@") {
      const m = MENTION_AT.exec(rest);
      if (m) {
        push([{ t: "mention", id: m[2], name: m[1] }]);
        i += m[0].length;
        continue;
      }
    }
    if (c === "[" && !has("link")) {
      const m = LINK_AT.exec(rest);
      if (m) {
        push(parseInline(m[1], [...marks, { type: "link", href: m[2] }]));
        i += m[0].length;
        continue;
      }
    }
    if (c === "h" && !has("link") && !/[\p{L}\p{N}]/u.test(prevChar(i))) {
      const m = URL_AT.exec(rest);
      if (m) {
        // Trailing punctuation after a pasted URL belongs to the sentence, not the link.
        const url = m[0].replace(/[.,;:!?]+$/, "");
        push([{ t: "text", text: url, marks: [...marks, { type: "link", href: url }] }]);
        i += url.length;
        continue;
      }
    }
    if (rest.startsWith("**") && !has("strong")) {
      let end = closing(s, "**", i + 2);
      // In "***", bold closes on the last two stars: the first belongs to an italic inside it.
      while (end > 0 && s[end + 2] === "*") end++;
      if (end > i + 2) {
        push(parseInline(s.slice(i + 2, end), [...marks, { type: "strong" }]));
        i = end + 2;
        continue;
      }
    }
    if (rest.startsWith("~~") && !has("strike")) {
      const end = closing(s, "~~", i + 2);
      if (end > i + 2) {
        push(parseInline(s.slice(i + 2, end), [...marks, { type: "strike" }]));
        i = end + 2;
        continue;
      }
    }
    // *italic*: the opening star is followed by a letter-ish character and the closing one follows one,
    // so "5 * 3 * 2" and a lone star stay what they are.
    if (c === "*" && !has("em") && i + 1 < s.length && !/[\s*]/.test(s[i + 1])) {
      let end = closing(s, "*", i + 1);
      while (end > 0 && (/\s/.test(s[end - 1]) || s[end + 1] === "*")) end = closing(s, "*", end + (s[end + 1] === "*" ? 2 : 1));
      if (end > i + 1) {
        push(parseInline(s.slice(i + 1, end), [...marks, { type: "em" }]));
        i = end + 1;
        continue;
      }
    }
    // _italic_: only at a word's edges, so snake_case and tc_code_1 stay text.
    if (c === "_" && !has("em") && !isWord(prevChar(i)) && i + 1 < s.length && !/\s/.test(s[i + 1])) {
      let end = closing(s, "_", i + 1);
      while (end > 0 && (/\s/.test(s[end - 1]) || isWord(s[end + 1] ?? " "))) end = closing(s, "_", end + 1);
      if (end > i + 1) {
        push(parseInline(s.slice(i + 1, end), [...marks, { type: "em" }]));
        i = end + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------ blocks */

const FENCE = /^\s*```\s*([\w+#.-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const IMAGE = /^\s*!\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)\)\s*$/;
const ITEM = /^(\s*)([-*+•]|(\d{1,9})[.)])\s+(.*)$/;

const indentOf = (line: string) => {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n++;
    else if (ch === "\t") n += 4;
    else break;
  }
  return n;
};
const isBlank = (line: string) => line.trim() === "";
const unescapeAlt = (s: string) => s.replace(/\\(.)/g, "$1");

/** Starts a block of its own, so it ends the paragraph above it. */
function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || IMAGE.test(line) || ITEM.test(line);
}

/** Lines taken back by `by` spaces (tabs count 4), never past their first character. */
function dedent(lines: string[], by: number): string[] {
  return lines.map((l) => {
    let cut = 0;
    let n = 0;
    while (cut < l.length && n < by && (l[cut] === " " || l[cut] === "\t")) {
      n += l[cut] === "\t" ? 4 : 1;
      cut++;
    }
    return l.slice(cut);
  });
}

function parseList(lines: string[], start: number): { block: RichBlock; next: number } {
  const first = ITEM.exec(lines[start])!;
  const indent = indentOf(first[1]);
  const ordered = first[3] !== undefined;
  const items: RichBlock[][] = [];
  let i = start;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || indentOf(m[1]) !== indent || (m[3] !== undefined) !== ordered) break;
    // The item's own text, then every following line indented deeper than its marker (nested lists,
    // continued lines, code), read as blocks of their own.
    const body: string[] = [m[4]];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && indentOf(lines[i]) > indent) body.push(lines[i++]);
    const childIndent = Math.min(...body.slice(1).map(indentOf), Infinity);
    const children = body.length > 1 ? parseBlocks(dedent(body.slice(1), childIndent).join("\n")) : [];
    const head = parseInline(m[4]);
    // Lines continuing the item's own text join it with a line break, as Jira's editor does.
    if (children[0]?.t === "p") {
      const cont = children.shift() as { t: "p"; content: RichInline[] };
      head.push({ t: "br" }, ...cont.content);
    }
    items.push([{ t: "p", content: head }, ...children]);
  }
  const block: RichBlock = ordered ? { t: "ol", start: Number(first[3]) || 1, items } : { t: "ul", items };
  return { block, next: i };
}

export function parseBlocks(text: string): RichBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: RichBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // the closing fence (or the end of the text)
      blocks.push({ t: "code", lang: fence[1] ?? "", text: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ t: "h", level: heading[1].length, content: parseInline(heading[2]) });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ t: "rule" });
      i++;
      continue;
    }
    const image = IMAGE.exec(line);
    if (image) {
      blocks.push({ t: "image", alt: unescapeAlt(image[1]), src: image[2] });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(QUOTE.exec(lines[i++])![1]);
      blocks.push({ t: "quote", content: parseBlocks(body.join("\n")) });
      continue;
    }
    if (ITEM.test(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }
    const para: string[] = [line];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i])) para.push(lines[i++]);
    blocks.push({ t: "p", content: parseInline(para.map((l) => l.trimEnd()).join("\n")) });
  }
  return blocks;
}

/** Every picture the text shows, in order — what has to be resolved before it can go to Jira. */
export function imageSources(blocks: RichBlock[]): string[] {
  const out: string[] = [];
  const walk = (list: RichBlock[]) => {
    for (const b of list) {
      if (b.t === "image") out.push(b.src);
      else if (b.t === "quote") walk(b.content);
      else if (b.t === "ul" || b.t === "ol") b.items.forEach(walk);
    }
  };
  walk(blocks);
  return out;
}

/** `attachment:<id>` — a file of this issue — or null. */
export function attachmentIdOf(src: string): string | null {
  const m = /^attachment:(\d{1,12})$/.exec(src);
  return m ? m[1] : null;
}

/** `media:<uuid>` — a picture Jira holds that is not matched to an attachment — or null. */
export function mediaIdOf(src: string): string | null {
  const m = /^media:([\w-]{8,64})$/.exec(src);
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ writing */

/** Text that must read back as itself: every character the parser would take as formatting is escaped. */
export function escapeInline(text: string): string {
  const word = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
  const space = (ch: string | undefined) => ch !== undefined && /\s/.test(ch);
  return text
    .replace(/\\(?=[^\p{L}\p{N}\s]|$)/gu, "\\\\")
    .replace(/`/g, "\\`")
    // A star with space on both sides can neither open nor close anything: "5 * 3" stays as typed.
    .replace(/\*/g, (star, at: number, all: string) => (space(all[at - 1]) && space(all[at + 1]) ? star : "\\*"))
    // An underscore inside a word (snake_case) is never a mark, so it is left alone.
    .replace(/_/g, (u, at: number, all: string) => (word(all[at - 1]) && word(all[at + 1]) ? u : "\\_"))
    .replace(/~(?=~)|(?<=~)~|^~|~$/g, "\\~")
    .replace(/@\[/g, "@\\[")
    .replace(/\[(?=(?:\\.|[^\]\\\n])+\]\()/g, "\\[");
}

/** A line that would start a block when it is meant as text gets its marker escaped. */
export function escapeLineStart(line: string): string {
  const num = /^(\s*\d{1,9})([.)])(\s)/.exec(line);
  if (num) return `${num[1]}\\${num[2]}${line.slice(num[0].length - 1)}`;
  if (/^\s*(?:#{1,6}\s|[-*+•]\s|>|```|!\[|(?:-{3,}|\*{3,}|_{3,})\s*$)/.test(line)) {
    const at = line.length - line.trimStart().length;
    return `${line.slice(0, at)}\\${line.slice(at)}`;
  }
  return line;
}
