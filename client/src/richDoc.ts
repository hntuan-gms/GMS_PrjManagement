import { escapeInline, escapeLineStart, parseBlocks, type RichBlock, type RichInline } from "./richText";

/**
 * The text of richText.ts as the document the WYSIWYG box edits (TipTap's JSON: StarterKit's node and
 * mark names, plus `mention` and `richImage`) and back. The box shows what the page shows; this is
 * what keeps the stored text — what goes to Jira — the same as before. The writer is server/src/adf.ts's
 * `adfToRich` over TipTap's names (change both): marks shared by neighbours are one run, spaces sit
 * outside the delimiters, italic is `_x_` unless it touches a word.
 *
 * Pure, no DOM; the JSON shape is declared here so the tests need no editor.
 */

export interface DocMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: DocMark[];
}

/* ------------------------------------------------------------------ text → doc */

const MARK_NAME = { strong: "bold", em: "italic", strike: "strike", code: "code" } as const;

function inlineToDoc(nodes: RichInline[]): DocNode[] {
  const out: DocNode[] = [];
  for (const n of nodes) {
    if (n.t === "br") out.push({ type: "hardBreak" });
    else if (n.t === "mention") out.push({ type: "mention", attrs: { id: n.id, label: n.name } });
    else if (n.text) {
      const marks = n.marks.map((m): DocMark => (m.type === "link" ? { type: "link", attrs: { href: m.href } } : { type: MARK_NAME[m.type] }));
      out.push(marks.length ? { type: "text", text: n.text, marks } : { type: "text", text: n.text });
    }
  }
  return out;
}

const withContent = (type: string, content: DocNode[], attrs?: Record<string, unknown>): DocNode => ({
  type,
  ...(attrs ? { attrs } : {}),
  ...(content.length ? { content } : {}),
});

function blocksToDoc(blocks: RichBlock[]): DocNode[] {
  return blocks.map((b): DocNode => {
    switch (b.t) {
      case "p":
        return withContent("paragraph", inlineToDoc(b.content));
      case "h":
        return withContent("heading", inlineToDoc(b.content), { level: Math.min(6, Math.max(1, b.level)) });
      case "ul":
      case "ol": {
        const items = b.items.map((item) => {
          const content = blocksToDoc(item);
          // A list item starts with a paragraph.
          if (content[0]?.type !== "paragraph") content.unshift({ type: "paragraph" });
          return { type: "listItem", content };
        });
        return b.t === "ul" ? { type: "bulletList", content: items } : { type: "orderedList", attrs: { start: b.start }, content: items };
      }
      case "code":
        return withContent("codeBlock", b.text ? [{ type: "text", text: b.text }] : [], { language: b.lang || null });
      case "quote": {
        const content = blocksToDoc(b.content);
        return { type: "blockquote", content: content.length ? content : [{ type: "paragraph" }] };
      }
      case "rule":
        return { type: "horizontalRule" };
      case "image":
        return { type: "richImage", attrs: { src: b.src, alt: b.alt } };
    }
  });
}

export function richToDoc(text: string): DocNode {
  const content = blocksToDoc(parseBlocks(text));
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/* ------------------------------------------------------------------ doc → text */

/** The marks that nest, outermost first. `code` is written per node, inside them. */
const STACKED = ["link", "bold", "italic", "strike"];
const markKey = (m: DocMark) => (m.type === "link" ? `link ${String(m.attrs?.href ?? "")}` : m.type);
const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);
const usable = (n: DocNode | undefined) =>
  n?.type === "text" ? (n.marks ?? []).filter((m) => STACKED.includes(m.type) && (m.type !== "link" || /^(https?:|mailto:)/.test(String(m.attrs?.href ?? "")))) : [];

function otherInline(n: DocNode): string {
  const attrs = n.attrs ?? {};
  if (n.type === "hardBreak") return "\n";
  if (n.type === "mention") {
    const id = String(attrs.id ?? "");
    const name = String(attrs.label ?? "").replace(/[[\]()\n]/g, "");
    return id ? `@[${name || "?"}](${id})` : escapeInline(name);
  }
  return inlineToRich(n.content);
}

function inlineToRich(nodes: DocNode[] | undefined): string {
  const list = nodes ?? [];
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
      out += otherInline(n);
      continue;
    }
    const text = n.text ?? "";
    const lead = /^\s*/.exec(text)![0];
    const core = text.slice(lead.length).trimEnd();
    if (!core) {
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
      } else if (m.type === "bold") {
        out += "**";
        stack.push({ key, close: "**" });
      } else if (m.type === "strike") {
        out += "~~";
        stack.push({ key, close: "~~" });
      } else {
        let j = i;
        while (j + 1 < list.length && (usable(list[j + 1]).some((x) => x.type === "italic") || (list[j + 1].type === "text" && !(list[j + 1].text ?? "").trim()))) j++;
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
    else out += inLink ? escapeInline(core).replace(/\]/g, "\\]") : escapeInline(core);
    pending = trail;
  }
  closeTo(0);
  flush();
  return out;
}

const paragraphLines = (s: string) => s.split("\n").map(escapeLineStart).join("\n");
const indentLines = (s: string, by: string) =>
  s
    .split("\n")
    .map((l) => (l ? by + l : l))
    .join("\n");

function blockToRich(node: DocNode): string {
  const attrs = node.attrs ?? {};
  const kids = node.content ?? [];
  switch (node.type) {
    case "paragraph":
      return paragraphLines(inlineToRich(kids));
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(attrs.level) || 1));
      const text = inlineToRich(kids).replace(/\n/g, " ");
      return text.trim() ? `${"#".repeat(level)} ${text}` : "";
    }
    case "bulletList":
    case "orderedList": {
      const start = Number(attrs.start) || 1;
      return kids
        .map((item, i) => {
          const marker = node.type === "bulletList" ? "- " : `${start + i}. `;
          const body = (item.content ?? []).map(blockToRich).filter((s) => s !== "");
          const [first, ...rest] = body.join("\n").split("\n");
          return marker + (first ?? "") + (rest.length ? "\n" + indentLines(rest.join("\n"), " ".repeat(marker.length)) : "");
        })
        .join("\n");
    }
    case "codeBlock": {
      const lang = typeof attrs.language === "string" && /^[\w+#.-]+$/.test(attrs.language) ? attrs.language : "";
      const text = kids.map((k) => k.text ?? "").join("").replace(/^```/gm, "ʼʼʼ");
      return "```" + lang + "\n" + text + "\n```";
    }
    case "blockquote": {
      const inner = kids.map(blockToRich).filter((s) => s !== "").join("\n\n");
      return inner
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n");
    }
    case "horizontalRule":
      return "---";
    case "richImage": {
      const src = String(attrs.src ?? "");
      if (!src) return "";
      return `![${String(attrs.alt ?? "").replace(/[[\]\\\n]/g, " ")}](${src.replace(/[\s)]/g, encodeURIComponent)})`;
    }
    default:
      return kids.map(blockToRich).filter((s) => s !== "").join("\n\n");
  }
}

/** The document as the stored text; empty paragraphs (what the box keeps between blocks) are dropped. */
export function docToRich(doc: DocNode | null | undefined): string {
  if (!doc) return "";
  return (doc.content ?? [])
    .map(blockToRich)
    .filter((s) => s.trim() !== "")
    .join("\n\n")
    .trim();
}

/** A picture still uploading (`uploading:n`): the text is not ready to send. */
export const hasUploading = (text: string) => /\]\(uploading:\d+\)/.test(text);
