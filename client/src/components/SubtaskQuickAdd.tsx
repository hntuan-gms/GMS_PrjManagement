import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { JiraUser, Task } from "../types";
import { NO_EXTRAS, type QuickExtras } from "../quickAddExtras";
import QuickAddExtrasFields from "./QuickAddExtras";

/**
 * "+" on a plan row: a small box under that row to type the title of a child. Enter creates it and keeps the
 * box open for the next one, Esc or a click outside closes it. The title takes quick-add words (@người, 3n,
 * !cao…) like every other quick-create; the parent is added by the caller. Bắt đầu, Kết thúc and Người are
 * always on the card, so a child is made with its dates and owner in one go.
 */
export default function SubtaskQuickAdd({
  parent,
  anchor,
  users,
  onCreate,
  onClose,
}: {
  parent: Task;
  /** The row's "+" button, in viewport pixels. */
  anchor: { left: number; bottom: number; top: number };
  /** Who the Người box offers; without it the box is left out. */
  users?: JiraUser[];
  onCreate: (text: string, extras: QuickExtras) => Promise<boolean | void>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [extras, setExtras] = useState<QuickExtras>(NO_EXTRAS);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 4 });

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    // Under the row, or above it when there is no room; never off the right edge.
    const top = anchor.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, anchor.top - h - 4) : anchor.bottom + 4;
    setPos({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - w - 8)), top });
  }, [anchor]);

  // On open, and again when a create finishes (the box is disabled while it runs, which drops focus), so Esc and
  // the next title go to the box.
  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (boxRef.current?.contains(t)) return;
      // The "+" that opened it toggles it; leave that click to the button.
      if (t instanceof Element && t.closest(".wbs-add-child")) return;
      onClose();
    }
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  return createPortal(
    <form
      ref={boxRef}
      className="subtask-add"
      style={{ left: pos.left, top: pos.top }}
      role="dialog"
      aria-label={`Thêm việc con cho ${parent.id}`}
      onSubmit={async (e) => {
        e.preventDefault();
        const t = text.trim();
        if (!t || busy) return;
        setBusy(true);
        try {
          // A refused create (false) keeps what was typed, so it can be fixed and sent again.
          if ((await onCreate(`${t} ^${parent.id}`, extras)) !== false) {
            setText("");
            setExtras(NO_EXTRAS);
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      <span className="subtask-add-parent" title={parent.summary}>
        Việc con của {parent.id}
      </span>
      <input
        ref={inputRef}
        value={text}
        disabled={busy}
        placeholder="Tên việc con, Enter để tạo"
        aria-label="Tên việc con"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // With more than one text box in the form the browser no longer submits on Enter by itself.
          // Not while an accent is still being composed (Telex/VNI end it with Enter).
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            boxRef.current?.requestSubmit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      {users && <QuickAddExtrasFields value={extras} onChange={setExtras} users={users} disabled={busy} />}
    </form>,
    document.body
  );
}
