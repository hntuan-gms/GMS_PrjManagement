import type { ReactNode } from "react";

/**
 * The assistant's replies, rendered instead of shown raw.
 *
 * Gemini writes Markdown whether asked to or not, and a bubble full of
 * "**Thời gian:**" and "* " reads as broken. This renders the small subset
 * models actually use — bold, italic, inline code, links, bullet and numbered
 * lists, headings, and the occasional table — straight to React elements.
 * Never through innerHTML: the text is model output that can quote issue
 * titles and descriptions anyone on the project wrote.
 *
 * Issue keys become buttons that open the task, when the key is one of this
 * project's — "GPM-12 đã dời sang 05/10" is then one click from the task itself.
 */

interface Props {
  text: string;
  /** Keys that exist in the current project; others stay plain text. */
  knownKeys?: Set<string>;
  onOpenIssue?: (key: string) => void;
}

const INLINE =
  /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|(?<![\w*])\*[^*\s][^*\n]*\*(?!\w)|(?<![\w_])_[^_\s][^_\n]*_(?![\w_])|\b[A-Z][A-Z0-9]{1,9}-\d+\b)/g;

function inline(text: string, props: Props, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const tok = m[0];
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push(<strong key={k}>{inline(tok.slice(2, -2), props, k)}</strong>);
    } else if (tok.startsWith("`")) {
      out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("[")) {
      const [, label, href] = tok.match(/^\[([^\]]+)\]\((.+)\)$/) ?? [];
      out.push(
        <a key={k} href={href} target="_blank" rel="noreferrer noopener">
          {label}
        </a>
      );
    } else if (tok.startsWith("*") || tok.startsWith("_")) {
      out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    } else if (props.knownKeys?.has(tok) && props.onOpenIssue) {
      out.push(
        <button key={k} className="chat-issue" onClick={() => props.onOpenIssue!(tok)} title="Mở công việc">
          {tok}
        </button>
      );
    } else {
      out.push(tok);
    }
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export default function ChatMarkdown(props: Props) {
  const lines = props.text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let n = 0;

  while (i < lines.length) {
    const line = lines[i];
    const key = `b${n++}`;

    if (!line.trim()) {
      i++;
      continue;
    }

    if (BULLET.test(line)) {
      const items: string[] = [];
      while (i < lines.length && BULLET.test(lines[i])) items.push(lines[i++].match(BULLET)![1]);
      blocks.push(
        <ul key={key}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, props, `${key}-${j}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (NUMBERED.test(line)) {
      const items: string[] = [];
      const start = Number(line.match(NUMBERED)![1]);
      while (i < lines.length && NUMBERED.test(lines[i])) items.push(lines[i++].match(NUMBERED)![2]);
      blocks.push(
        <ol key={key} start={start}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, props, `${key}-${j}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={key} className="chat-table-wrap">
          <table className="chat-table">
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j}>{inline(c, props, `${key}-h${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j}>{inline(c, props, `${key}-${ri}-${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (HEADING.test(line)) {
      blocks.push(
        <p key={key} className="chat-md-heading">
          {inline(line.match(HEADING)![1].replace(/\*\*/g, ""), props, key)}
        </p>
      );
      i++;
      continue;
    }

    // A paragraph: consecutive plain lines, kept as line breaks.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !BULLET.test(lines[i]) &&
      !NUMBERED.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !TABLE_ROW.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    if (para.length === 0) {
      // A lone table-looking row with no rule under it: show it as text.
      para.push(lines[i++]);
    }
    blocks.push(
      <p key={key}>
        {para.map((l, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {inline(l, props, `${key}-${j}`)}
          </span>
        ))}
      </p>
    );
  }

  return <div className="chat-md">{blocks}</div>;
}
