import { useEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icons";

interface Props {
  src: string;
  name: string;
  onClose: () => void;
  /** Offered beside the close button when the caller can hand the file over. */
  onDownload?: () => void;
}

/**
 * An attached image at a readable size, over whatever window it was opened from. Portalled to
 * the body so no scrolling column clips it, and its Escape stops here: the detail window under it
 * also closes on Escape (and asks about unsaved changes), which must not happen to a picture.
 */
export default function ImageLightbox({ src, name, onClose, onDownload }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => before?.focus?.();
  }, []);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab") {
      // Two buttons and nothing else: keep the focus on them rather than the window behind.
      e.preventDefault();
      const buttons = [...(ref.current?.querySelectorAll<HTMLElement>("button") ?? [])];
      if (buttons.length === 0) return;
      const i = buttons.indexOf(document.activeElement as HTMLElement);
      buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    } else {
      // Anything else typed must not reach the form beneath (Ctrl+Enter would save it).
      e.stopPropagation();
    }
  }

  return createPortal(
    <div
      className="lightbox"
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={`Xem ảnh ${name}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <figure className="lightbox-figure">
        <img src={src} alt={name} />
        <figcaption>
          <span className="lightbox-name" title={name}>
            {name}
          </span>
          {onDownload && (
            <button type="button" className="lightbox-btn" onClick={onDownload} aria-label="Tải về" title="Tải về">
              <Icon name="download" size={16} />
            </button>
          )}
          <button type="button" className="lightbox-btn" onClick={onClose} aria-label="Đóng ảnh" title="Đóng (Esc)">
            <Icon name="x" size={16} />
          </button>
        </figcaption>
      </figure>
    </div>,
    document.body
  );
}
