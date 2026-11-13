import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { TaskAttachments } from "../types";
import { dismissToast, toast } from "../toast";
import { Icon } from "./Icons";
import ImageLightbox from "./ImageLightbox";

type FileInfo = TaskAttachments["files"][number];

/** What the server will show inline (routes/api.ts INLINE_IMAGE). */
const RASTER = /^image\/(png|jpe?g|gif|webp)$/i;
/** How long a removed file can still be put back: Jira is told only after this. */
const UNDO_MS = 5000;
/** A bigger picture is fetched only when someone opens it, not for a thumbnail. */
const THUMB_MAX_BYTES = 3 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

interface Props {
  taskId: string;
  files: TaskAttachments["files"];
  links: TaskAttachments["links"];
  /** A file was removed (on screen at once; Jira is told a few seconds later). */
  onRemoved: (fileId: string) => void;
  /** A removal was undone, or Jira refused it: the file is back. */
  onRestored: (file: FileInfo) => void;
}

/**
 * What the issue already has, one row each. A picture shows as a thumbnail and opens at a readable
 * size on click; any file can be downloaded or removed from the icons that appear when the row is
 * hovered or focused (always present for keyboard and touch — only their weight changes).
 */
export default function TaskAttachmentList({ taskId, files, links, onRemoved, onRestored }: Props) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [viewing, setViewing] = useState<{ file: FileInfo; url: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef<Record<string, string>>({});
  // Removed here, not yet (or just) deleted in Jira. Kept hidden even if a re-read still lists them.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const waiting = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; send: () => void }>());
  const live = useRef({ onRestored });
  useEffect(() => {
    live.current = { onRestored };
  });

  // Thumbnails of the small pictures; revoked when the window closes.
  useEffect(() => {
    let alive = true;
    for (const f of files) {
      if (!RASTER.test(f.mimeType) || f.size > THUMB_MAX_BYTES || urls.current[f.id]) continue;
      api
        .getAttachmentBlob(taskId, f.id, true)
        .then((blob) => {
          if (!alive) return;
          urls.current[f.id] = URL.createObjectURL(blob);
          setThumbs({ ...urls.current });
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [taskId, files]);
  useEffect(() => {
    const held = urls.current;
    const pending = waiting.current;
    return () => {
      Object.values(held).forEach((u) => URL.revokeObjectURL(u));
      // Closing the panel does not cancel a removal: what is waiting goes to Jira now.
      for (const w of [...pending.values()]) {
        clearTimeout(w.timer);
        w.send();
      }
    };
  }, []);

  async function open(f: FileInfo) {
    setError(null);
    if (!RASTER.test(f.mimeType)) return void download(f);
    if (thumbs[f.id]) return setViewing({ file: f, url: thumbs[f.id] });
    setBusy(f.id);
    try {
      const url = URL.createObjectURL(await api.getAttachmentBlob(taskId, f.id, true));
      urls.current[f.id] = url;
      setThumbs({ ...urls.current });
      setViewing({ file: f, url });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không mở được tệp.");
    } finally {
      setBusy(null);
    }
  }

  async function download(f: FileInfo) {
    setError(null);
    setBusy(f.id);
    try {
      saveBlob(await api.getAttachmentBlob(taskId, f.id, false), f.filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được tệp.");
    } finally {
      setBusy(null);
    }
  }

  const hide = (id: string, hidden: boolean) =>
    setGone((g) => {
      const next = new Set(g);
      if (hidden) next.add(id);
      else next.delete(id);
      return next;
    });

  /**
   * Gone from the list at once, no question asked; Jira, which cannot give a file back, is told only
   * when the "Hoàn tác" toast has run out (or the panel closes). A refusal puts the row back.
   */
  function remove(f: FileInfo) {
    setError(null);
    hide(f.id, true);
    onRemoved(f.id);
    let toastId = 0;
    const send = () => {
      waiting.current.delete(f.id);
      dismissToast(toastId);
      api.deleteAttachment(taskId, f.id).catch((e) => {
        hide(f.id, false);
        live.current.onRestored(f);
        toast(`Không xoá được ${f.filename}: ${e instanceof Error ? e.message : "lỗi không rõ"}`, { tone: "error" });
      });
    };
    const timer = setTimeout(send, UNDO_MS);
    waiting.current.set(f.id, { timer, send });
    toastId = toast(`Đã xoá ${f.filename}`, {
      ms: UNDO_MS,
      action: {
        label: "Hoàn tác",
        run: () => {
          const w = waiting.current.get(f.id);
          if (!w) return;
          clearTimeout(w.timer);
          waiting.current.delete(f.id);
          hide(f.id, false);
          live.current.onRestored(f);
        },
      },
    });
  }

  const shown = files.filter((f) => !gone.has(f.id));
  if (shown.length === 0 && links.length === 0) return null;
  return (
    <>
      <ul className="att-existing">
        {shown.map((f) => {
          const image = RASTER.test(f.mimeType);
          return (
            <li key={f.id} className="att-row">
              <button
                type="button"
                className="att-open"
                onClick={() => void open(f)}
                disabled={busy === f.id}
                title={image ? "Xem ảnh" : "Tải về"}
                aria-label={`${image ? "Xem" : "Tải về"} ${f.filename}`}
              >
                {thumbs[f.id] ? (
                  <img className="att-thumb" src={thumbs[f.id]} alt="" />
                ) : (
                  <span className="att-ext">{f.filename.split(".").pop()?.slice(0, 4)}</span>
                )}
                <span className="att-name" title={f.filename}>
                  {f.filename}
                </span>
              </button>
              <span className="att-size">{[formatSize(f.size), f.author].filter(Boolean).join(" · ")}</span>
              <span className="att-actions">
                {image && (
                  <button type="button" className="att-act" onClick={() => void open(f)} disabled={busy === f.id} aria-label={`Xem ${f.filename}`} title="Xem">
                    <Icon name="eye" size={14} />
                  </button>
                )}
                <button type="button" className="att-act" onClick={() => void download(f)} disabled={busy === f.id} aria-label={`Tải về ${f.filename}`} title="Tải về">
                  <Icon name="download" size={14} />
                </button>
                <button type="button" className="att-act is-danger" onClick={() => remove(f)} disabled={busy === f.id} aria-label={`Xoá ${f.filename}`} title="Xoá">
                  <Icon name="trash" size={14} />
                </button>
              </span>
            </li>
          );
        })}
        {links.map((l) => (
          <li key={l.id} className="att-row">
            <a className="att-open" href={l.url} target="_blank" rel="noreferrer" title={l.url}>
              <Icon name="external" size={13} className="att-link-icon" />
              <span className="att-name">{l.title}</span>
            </a>
          </li>
        ))}
      </ul>
      {error && <div className="att-error">{error}</div>}
      {viewing && (
        <ImageLightbox src={viewing.url} name={viewing.file.filename} onClose={() => setViewing(null)} onDownload={() => void download(viewing.file)} />
      )}
    </>
  );
}
