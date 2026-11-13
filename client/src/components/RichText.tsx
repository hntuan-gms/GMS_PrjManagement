import { Fragment, type ReactNode } from "react";
import { parseBlocks, type RichBlock, type RichInline } from "../richText";
import RichImage from "./RichImage";

/**
 * A comment or description as a page: headings, lists, code, quotes, marks, mentions and the pictures
 * pasted into it. Built as React elements from richText.ts, never through innerHTML — anyone on the
 * project may have written the text.
 */

interface Props {
  text: string;
  /** The issue the pictures belong to; without it a picture shows as its name. */
  taskId?: string;
  /** The signed-in account, so a mention of you can be marked. */
  myAccountId?: string;
  className?: string;
}

/* ------------------------------------------------------------------ inline */

function renderInline(nodes: RichInline[], myAccountId: string | undefined, key: string): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}.${i}`;
    if (n.t === "br") return <br key={k} />;
    if (n.t === "mention") {
      return (
        <span key={k} className={`td-mention${n.id === myAccountId ? " is-me" : ""}`}>
          @{n.name}
        </span>
      );
    }
    let el: ReactNode = n.text;
    // Innermost first, so a link carries its bold inside it.
    for (const m of [...n.marks].reverse()) {
      if (m.type === "code") el = <code>{el}</code>;
      else if (m.type === "strong") el = <strong>{el}</strong>;
      else if (m.type === "em") el = <em>{el}</em>;
      else if (m.type === "strike") el = <s>{el}</s>;
      else
        el = (
          <a href={m.href} target="_blank" rel="noreferrer noopener">
            {el}
          </a>
        );
    }
    return <Fragment key={k}>{el}</Fragment>;
  });
}

/* ------------------------------------------------------------------ blocks */

function renderBlocks(blocks: RichBlock[], props: Props, key: string): ReactNode[] {
  return blocks.map((b, i) => {
    const k = `${key}.${i}`;
    switch (b.t) {
      case "p":
        return <p key={k}>{renderInline(b.content, props.myAccountId, k)}</p>;
      case "h": {
        // h1/h2 in a comment would outrank the panel's own headings: everything is drawn a step down.
        const Tag = (`h${Math.min(6, b.level + 2)}` as "h3");
        return (
          <Tag key={k} className={`rt-h rt-h${b.level}`}>
            {renderInline(b.content, props.myAccountId, k)}
          </Tag>
        );
      }
      case "ul":
        return (
          <ul key={k}>
            {b.items.map((item, j) => (
              <li key={j}>{renderBlocks(item, props, `${k}.${j}`)}</li>
            ))}
          </ul>
        );
      case "ol":
        return (
          <ol key={k} start={b.start === 1 ? undefined : b.start}>
            {b.items.map((item, j) => (
              <li key={j}>{renderBlocks(item, props, `${k}.${j}`)}</li>
            ))}
          </ol>
        );
      case "code":
        return (
          <pre key={k} className="rt-code" data-lang={b.lang || undefined}>
            <code>{b.text}</code>
          </pre>
        );
      case "quote":
        return <blockquote key={k}>{renderBlocks(b.content, props, k)}</blockquote>;
      case "rule":
        return <hr key={k} />;
      case "image":
        return (
          <div key={k} className="rt-figure">
            <RichImage src={b.src} alt={b.alt} taskId={props.taskId} />
          </div>
        );
    }
  });
}

export default function RichText(props: Props) {
  return <div className={props.className ? `rt ${props.className}` : "rt"}>{renderBlocks(parseBlocks(props.text), props, "b")}</div>;
}
