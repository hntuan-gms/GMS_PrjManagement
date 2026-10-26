import { useEffect, useMemo, useRef, useState } from "react";
import { LINK_URL_RE, MAX_ATTACHMENT_BYTES, type PendingAttachments } from "../attachments";
import { Icon } from "./Icons";
import ImageLightbox from "./ImageLightbox";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function AttachmentPicker({
  value,
  onChange,
  hint,
}: {
  value: PendingAttachments;
  onChange: (next: PendingAttachments) => void;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  // The three-box link form is out of the way until someone wants to add a link.
  const [linkOpen, setLinkOpen] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Thumbnails for images; revoked when the list changes or the form closes.
  const previews = useMemo(
    () => value.files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)),
    [value.files]
  );
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  function addFiles(files: File[]) {
    const tooBig = files.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    setError(tooBig.length ? `Quá 20 MB, không thêm: ${tooBig.map((f) => f.name).join(", ")}` : null);
    const ok = files.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
    if (ok.length) onChange({ ...value, files: [...value.files, ...ok] });
  }

  function addLink() {
    const url = linkUrl.trim();
    if (!LINK_URL_RE.test(url)) {
      setError("Liên kết phải bắt đầu bằng http:// hoặc https://");
      return;
    }
    setError(null);
    onChange({ ...value, links: [...value.links, { url, title: linkTitle.trim() || url }] });
    setLinkUrl("");
    setLinkTitle("");
    setLinkOpen(false);
  }

  return (
    <div className="att-picker">
      <div
        className={`att-drop ${over ? "is-over" : ""}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          addFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <span>
          Kéo thả tệp / ảnh vào đây, dán ảnh bằng <kbd>Ctrl</kbd>+<kbd>V</kbd>, hoặc{" "}
          <button type="button" className="text-btn" onClick={() => inputRef.current?.click()}>
            chọn tệp
          </button>
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      {value.files.length > 0 && (
        <ul className="att-files">
          {value.files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              {previews[i] ? (
                <button type="button" className="att-thumb-btn" onClick={() => setViewing(i)} aria-label={`Xem ảnh ${f.name}`} title="Xem ảnh">
                  <img src={previews[i]!} alt="" />
                </button>
              ) : (
                <span className="att-ext">{f.name.split(".").pop()?.slice(0, 4) || "tệp"}</span>
              )}
              <span className="att-name" title={f.name}>{f.name}</span>
              <span className="att-size">{formatSize(f.size)}</span>
              <button
                type="button"
                className="att-remove"
                aria-label={`Bỏ ${f.name}`}
                onClick={() => onChange({ ...value, files: value.files.filter((_, j) => j !== i) })}
              >
                <Icon name="x" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {linkOpen ? (
        <div className="att-link-add">
          <input
            type="url"
            value={linkUrl}
            placeholder="https://… (tài liệu, Figma, ảnh)"
            aria-label="Địa chỉ liên kết"
            autoFocus
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLink();
              } else if (e.key === "Escape") {
                // Closes the form only, not the window it sits in.
                e.stopPropagation();
                setLinkOpen(false);
              }
            }}
          />
          <input
            value={linkTitle}
            placeholder="Tên hiển thị (không bắt buộc)"
            aria-label="Tên hiển thị của liên kết"
            onChange={(e) => setLinkTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLink();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setLinkOpen(false);
              }
            }}
          />
          <button type="button" onClick={addLink} disabled={!linkUrl.trim()}>
            Thêm
          </button>
          <button type="button" className="att-act" onClick={() => setLinkOpen(false)} aria-label="Đóng form liên kết" title="Đóng">
            <Icon name="x" size={14} />
          </button>
        </div>
      ) : (
        <button type="button" className="att-add-link" onClick={() => setLinkOpen(true)}>
          <Icon name="plus" size={14} />
          Thêm liên kết
        </button>
      )}

      {value.links.length > 0 && (
        <ul className="att-links">
          {value.links.map((l, i) => (
            <li key={`${l.url}-${i}`}>
              <Icon name="link" size={13} className="att-link-icon" />
              <span className="att-name" title={l.url}>{l.title}</span>
              <button
                type="button"
                className="att-remove"
                aria-label={`Bỏ liên kết ${l.title}`}
                onClick={() => onChange({ ...value, links: value.links.filter((_, j) => j !== i) })}
              >
                <Icon name="x" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <div className="att-error">{error}</div>}
      {hint && <div className="field-hint">{hint}</div>}
      {viewing !== null && previews[viewing] && value.files[viewing] && (
        <ImageLightbox src={previews[viewing]!} name={value.files[viewing].name} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}
