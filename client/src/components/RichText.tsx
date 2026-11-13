import { Fragment, useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { attachmentIdOf, mediaIdOf, parseBlocks, type RichBlock, type RichInline } from "../richText";
import ImageLightbox from "./ImageLightbox";

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

/* ---------------------------------------------------------------- pictures */

/** One object URL per attachment for the life of the page: a picture is drawn by every comment that shows it. */
const blobs = new Map<string, Promise<string>>();

function blobUrl(taskId: string, attId: string): Promise<string> {
  const key = `${taskId}|${attId}`;
  let p = blobs.get(key);
  if (!p) {
    p = api.getAttachmentBlob(taskId, attId, true).then((b) => URL.createObjectURL(b));
    // A failure is not remembered: the next draw asks again.
    p.catch(() => blobs.delete(key));
    blobs.set(key, p);
  }
  return p;
}

function RichImage({ src, alt, taskId }: { src: string; alt: string; taskId?: string }) {
  const attId = attachmentIdOf(src);
  const [state, setState] = useState<{ src: string; url?: string; failed?: boolean }>({ src });
  const [open, setOpen] = useState(false);
  const url = state.src === src ? state.url : undefined;
  const failed = state.src === src && state.failed;

  useEffect(() => {
    if (!attId || !taskId) return;
    let alive = true;
    blobUrl(taskId, attId).then(
      (u) => alive && setState({ src, url: u }),
      () => alive && setState({ src, failed: true })
    );
    return () => {
      alive = false;
    };
  }, [src, attId, taskId]);

  const name = alt || "Ảnh";
  if (src.startsWith("uploading:")) return <span className="rt-img is-wait">{name}</span>;
  if (/^https:\/\//.test(src)) {
    // A picture from another site is not loaded into the page (it would tell that site who read it).
    return (
      <a className="rt-img is-link" href={src} target="_blank" rel="noreferrer noopener">
        {name}
      </a>
    );
  }
  if (!attId || !taskId || failed) {
    return (
      <span className="rt-img is-missing" title={mediaIdOf(src) ? "Ảnh trong Jira, chưa khớp được với tệp đính kèm" : undefined}>
        {name}
      </span>
    );
  }
  if (!url) return <span className="rt-img is-wait">{name}</span>;
  return (
    <>
      <button type="button" className="rt-img-btn" onClick={() => setOpen(true)} title={name}>
        <img src={url} alt={name} loading="lazy" />
      </button>
      {open && <ImageLightbox src={url} name={name} onClose={() => setOpen(false)} />}
    </>
  );
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
