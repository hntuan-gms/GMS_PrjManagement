/**
 * What the formatting bar and the keys do to the text of a comment or description box. The box is a
 * plain text area holding the Markdown of richText.ts; each action takes the text and the selection
 * and gives back both, so the box can put the caret where a person expects it. Pure, no DOM.
 */

export interface TextEdit {
  value: string;
  start: number;
  end: number;
}

export type RichAction = "bold" | "italic" | "strike" | "code" | "link" | "heading" | "bullet" | "numbered" | "quote" | "codeblock";

const WRAP: Partial<Record<RichAction, string>> = { bold: "**", italic: "_", strike: "~~", code: "`" };

/** The first and last line touched by the selection, as offsets. */
function lineSpan(value: string, start: number, end: number): { from: number; to: number } {
  const from = value.lastIndexOf("\n", start - 1) + 1;
  // A selection ending right after a newline does not take the next line with it.
  const stop = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const nl = value.indexOf("\n", stop);
  return { from, to: nl === -1 ? value.length : nl };
}

function wrapInline(e: TextEdit, delim: string): TextEdit {
  const { value, start, end } = e;
  const before = value.slice(Math.max(0, start - delim.length), start);
  const after = value.slice(end, end + delim.length);
  // Already wrapped: the same press takes it off.
  if (before === delim && after === delim) {
    return {
      value: value.slice(0, start - delim.length) + value.slice(start, end) + value.slice(end + delim.length),
      start: start - delim.length,
      end: end - delim.length,
    };
  }
  const sel = value.slice(start, end);
  // Spaces at the edges of the selection stay outside the marks ("** a**" is not bold).
  const lead = /^\s*/.exec(sel)![0];
  const trail = sel.length > lead.length ? /\s*$/.exec(sel)![0] : "";
  const core = sel.slice(lead.length, sel.length - trail.length);
  const s = start + lead.length;
  return {
    value: value.slice(0, s) + delim + core + delim + value.slice(s + core.length),
    start: s + delim.length,
    end: s + delim.length + core.length,
  };
}

const PREFIX: Partial<Record<RichAction, RegExp>> = {
  heading: /^#{1,6}\s+/,
  bullet: /^\s*[-*+•]\s+/,
  numbered: /^\s*\d{1,9}[.)]\s+/,
  quote: /^>\s?/,
};

function prefixLines(e: TextEdit, action: RichAction): TextEdit {
  const { value, start, end } = e;
  const { from, to } = lineSpan(value, start, end);
  const lines = value.slice(from, to).split("\n");
  const re = PREFIX[action]!;
  const filled = lines.filter((l) => l.trim() !== "");
  const all = filled.length > 0 && filled.every((l) => re.test(l));
  let n = 0;
  const next = lines.map((l) => {
    if (all) return l.replace(re, "");
    if (l.trim() === "" && lines.length > 1) return l;
    // Another kind of marker on the line is replaced, not stacked ("- 1. x").
    const bare = l.replace(PREFIX.bullet!, "").replace(PREFIX.numbered!, "").replace(PREFIX.heading!, "").replace(PREFIX.quote!, "");
    const marker = action === "heading" ? "## " : action === "bullet" ? "- " : action === "numbered" ? `${++n}. ` : "> ";
    return marker + bare;
  });
  const text = next.join("\n");
  const single = lines.length === 1;
  return {
    value: value.slice(0, from) + text + value.slice(to),
    // One line: the caret keeps its place in the words; several: the whole block stays selected.
    start: single ? Math.max(from, start + (text.length - (to - from))) : from,
    end: single ? Math.max(from, end + (text.length - (to - from))) : from + text.length,
  };
}

function codeBlock(e: TextEdit): TextEdit {
  const { value, start, end } = e;
  const { from, to } = lineSpan(value, start, end);
  const body = value.slice(from, to);
  const opened = value.slice(0, from);
  const pre = opened && !opened.endsWith("\n") ? "\n" : "";
  const text = `${pre}\`\`\`\n${body}\n\`\`\``;
  const caret = from + pre.length + 4;
  return { value: opened + text + value.slice(to), start: caret, end: caret + body.length };
}

function link(e: TextEdit): TextEdit {
  const { value, start, end } = e;
  const sel = value.slice(start, end).trim();
  if (/^https?:\/\/\S+$/.test(sel)) {
    // A pasted address selected: the words go between the brackets.
    const text = `[](${sel})`;
    return { value: value.slice(0, start) + text + value.slice(end), start: start + 1, end: start + 1 };
  }
  const words = sel || "liên kết";
  const text = `[${words}](https://)`;
  const urlAt = start + words.length + 3;
  return { value: value.slice(0, start) + text + value.slice(end), start: urlAt, end: urlAt + 8 };
}

export function applyAction(e: TextEdit, action: RichAction): TextEdit {
  const delim = WRAP[action];
  if (delim) return wrapInline(e, delim);
  if (action === "link") return link(e);
  if (action === "codeblock") return codeBlock(e);
  return prefixLines(e, action);
}

const ITEM = /^(\s*)([-*+•]|(\d{1,9})([.)]))(\s+)(.*)$/;
const QUOTE_LINE = /^(>\s?)(.*)$/;

/**
 * Enter at the end of a list item or a quoted line carries the marker on; Enter on an empty item ends
 * the list instead. Null = an ordinary Enter.
 */
export function continueBlock(e: TextEdit): TextEdit | null {
  const { value, start, end } = e;
  if (start !== end) return null;
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const nl = value.indexOf("\n", start);
  const to = nl === -1 ? value.length : nl;
  const line = value.slice(from, to);
  // Inside a code block Enter is only Enter.
  const fences = (value.slice(0, from).match(/^\s*```/gm) ?? []).length;
  if (fences % 2 === 1) return null;
  const item = ITEM.exec(line);
  const quote = item ? null : QUOTE_LINE.exec(line);
  if (!item && !quote) return null;
  const content = item ? item[6] : quote![2];
  if (content.trim() === "" && start === to) {
    // An empty item: the marker goes, the list ends here.
    return { value: value.slice(0, from) + value.slice(to), start: from, end: from };
  }
  const marker = item ? `${item[1]}${item[3] ? `${Number(item[3]) + 1}${item[4]}` : item[2]}${item[5]}` : quote![1];
  const insert = "\n" + marker;
  return { value: value.slice(0, start) + insert + value.slice(end), start: start + insert.length, end: start + insert.length };
}

/** Tab / Shift+Tab on list lines nests or un-nests them by two spaces. Null = not a list line. */
export function indentItems(e: TextEdit, outdent: boolean): TextEdit | null {
  const { value, start, end } = e;
  const { from, to } = lineSpan(value, start, end);
  const lines = value.slice(from, to).split("\n");
  if (!lines.some((l) => ITEM.test(l))) return null;
  let delta0 = 0;
  const next = lines.map((l, i) => {
    if (!ITEM.test(l)) return l;
    const cut = outdent ? Math.min(2, /^ */.exec(l)![0].length) : -2;
    if (i === 0) delta0 = -cut;
    return cut > 0 ? l.slice(cut) : cut < 0 ? "  " + l : l;
  });
  const text = next.join("\n");
  const total = text.length - (to - from);
  return { value: value.slice(0, from) + text + value.slice(to), start: Math.max(from, start + delta0), end: Math.max(from, end + total) };
}

/** `text` on lines of its own at the caret (a picture, a block), with the caret after it. */
export function insertBlock(e: TextEdit, text: string): TextEdit {
  const { value, start, end } = e;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const pre = before === "" || before.endsWith("\n") ? "" : "\n";
  const post = after.startsWith("\n") ? "" : "\n";
  const out = before + pre + text + post + after;
  const caret = before.length + pre.length + text.length + post.length;
  return { value: out, start: caret, end: caret };
}

/** The picture-in-progress line a pasted file holds until it is uploaded. */
export const uploadingToken = (n: number, name: string) => `![Đang tải ${name.replace(/[[\]\\\n]/g, " ")}…](uploading:${n})`;

/** Swaps the in-progress line `n` for `replacement` (a picture, or nothing when the upload failed). */
export function settleUpload(value: string, n: number, replacement: string): string {
  const re = new RegExp(`!\\[[^\\]\\n]*\\]\\(uploading:${n}\\)\\n?`);
  return replacement ? value.replace(new RegExp(`!\\[[^\\]\\n]*\\]\\(uploading:${n}\\)`), replacement) : value.replace(re, "");
}

export const hasUploading = (value: string) => /\]\(uploading:\d+\)/.test(value);

/** A picture line for an attachment of the issue. */
export const attachmentImage = (id: string, filename: string) => `![${filename.replace(/[[\]\\\n]/g, " ")}](attachment:${id})`;
