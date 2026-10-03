import { useEffect, useMemo, useRef, useState } from "react";
import { LINK_URL_RE, MAX_ATTACHMENT_BYTES, type PendingAttachments } from "../attachments";

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
              {previews[i] ? <img src={previews[i]!} alt="" /> : <span className="att-ext">{f.name.split(".").pop()?.slice(0, 4) || "tệp"}</span>}
              <span className="att-name" title={f.name}>{f.name}</span>
              <span className="att-size">{formatSize(f.size)}</span>
              <button
                type="button"
                className="att-remove"
                aria-label={`Bỏ ${f.name}`}
                onClick={() => onChange({ ...value, files: value.files.filter((_, j) => j !== i) })}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="att-link-add">
        <input
          type="url"
          value={linkUrl}
          placeholder="https://… (tài liệu, Figma, ảnh)"
          onChange={(e) => setLinkUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addLink();
            }
          }}
        />
        <input
          value={linkTitle}
          placeholder="Tên hiển thị (không bắt buộc)"
          onChange={(e) => setLinkTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addLink();
            }
          }}
        />
        <button type="button" onClick={addLink} disabled={!linkUrl.trim()}>
          + Liên kết
        </button>
      </div>

      {value.links.length > 0 && (
        <ul className="att-links">
          {value.links.map((l, i) => (
            <li key={`${l.url}-${i}`}>
              <span className="att-link-icon" aria-hidden="true">🔗</span>
              <span className="att-name" title={l.url}>{l.title}</span>
              <button
                type="button"
                className="att-remove"
                aria-label={`Bỏ liên kết ${l.title}`}
                onClick={() => onChange({ ...value, links: value.links.filter((_, j) => j !== i) })}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <div className="att-error">{error}</div>}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}
