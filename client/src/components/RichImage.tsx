import { useEffect, useState } from "react";
import { api } from "../api";
import { attachmentIdOf, mediaIdOf } from "../richText";
import ImageLightbox from "./ImageLightbox";

/**
 * A picture of a comment or description: an attachment of the issue (drawn from its bytes through our
 * own route), a Jira picture not matched to a file, one still uploading, or one on another site (a
 * link — it is not loaded into the page). Used by the page (RichText) and the editor (RichEditor).
 */


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

export default function RichImage({ src, alt, taskId }: { src: string; alt: string; taskId?: string }) {
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

