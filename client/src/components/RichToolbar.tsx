import { useRef } from "react";
import type { RichAction } from "../richEdit";
import type { RichEditing } from "../useRichEditing";
import { Icon, type IconName } from "./Icons";

/** The formatting bar above a rich text box; what its buttons do is useRichEditing's. */

const BUTTONS: Array<{ action: RichAction; icon: IconName; label: string; keys?: string }> = [
  { action: "heading", icon: "heading", label: "Tiêu đề" },
  { action: "bold", icon: "bold", label: "Đậm", keys: "Ctrl B" },
  { action: "italic", icon: "italic", label: "Nghiêng", keys: "Ctrl I" },
  { action: "strike", icon: "strike", label: "Gạch ngang" },
  { action: "code", icon: "code", label: "Mã" },
  { action: "bullet", icon: "listBullet", label: "Danh sách" },
  { action: "numbered", icon: "listNumber", label: "Danh sách số" },
  { action: "quote", icon: "quote", label: "Trích dẫn" },
  { action: "codeblock", icon: "codeBlock", label: "Khối mã" },
  { action: "link", icon: "link", label: "Liên kết" },
];

export default function RichToolbar({
  editing,
  preview,
  onPreview,
}: {
  editing: RichEditing;
  /** Whether the box shows the result instead of the text; absent = no preview switch. */
  preview?: boolean;
  onPreview?: (on: boolean) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="rt-bar" role="toolbar" aria-label="Định dạng">
      {BUTTONS.map((b) => (
        <button
          key={b.action}
          type="button"
          className="rt-bar-btn"
          aria-label={b.label}
          title={b.keys ? `${b.label} (${b.keys})` : b.label}
          disabled={preview}
          // The text area keeps the focus (and its selection), or the action would have nothing to act on.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editing.run(b.action)}
        >
          <Icon name={b.icon} size={15} />
        </button>
      ))}
      {editing.pictures && (
        <>
          <button
            type="button"
            className="rt-bar-btn"
            aria-label="Chèn ảnh"
            title="Chèn ảnh (hoặc dán / kéo ảnh vào)"
            disabled={preview}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="image" size={15} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              editing.addImages(files);
            }}
          />
        </>
      )}
      {editing.uploading && <span className="rt-bar-note">Đang tải ảnh…</span>}
      {onPreview && (
        <button
          type="button"
          className={`rt-bar-preview${preview ? " is-on" : ""}`}
          aria-pressed={!!preview}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPreview(!preview)}
        >
          Xem trước
        </button>
      )}
    </div>
  );
}

