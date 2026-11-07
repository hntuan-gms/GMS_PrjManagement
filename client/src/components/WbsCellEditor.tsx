import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { parseDateInput } from "../dateInput";
import { todayIso } from "../resourceAllocation";
import type { CellKind } from "../wbsCells";
import DateField from "./DateField";
import NumberInput from "./NumberInput";

export type Move = "stay" | "next" | "prev" | "down";
export type EditValue = string | number | null;

/**
 * One WBS cell being edited where it is (plan C4): a small box laid exactly over the cell, so the table
 * underneath is neither rebuilt nor pushed. Enter saves and goes down, Tab / Shift Tab save and go to the
 * next cell, Esc drops the change, leaving the box saves. `onCommit` gets `null` when nothing changed and
 * may answer with a sentence to say why the value was refused; the box then stays open on it.
 */
export default function WbsCellEditor({
  kind,
  anchor,
  initial,
  base,
  onCommit,
  onCancel,
}: {
  kind: Exclude<CellKind, "assignee">;
  anchor: DOMRect;
  /** The cell's value now: text, an ISO date, or a number. */
  initial: string | number | null;
  /** What "+3n" counts from in an end-date box. */
  base?: string;
  onCommit: (value: EditValue, move: Move) => string | void;
  onCancel: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const [text, setText] = useState(typeof initial === "string" ? initial : "");
  const [num, setNum] = useState<number | null>(typeof initial === "number" ? initial : null);
  const [iso, setIso] = useState(typeof initial === "string" ? initial : "");
  const [error, setError] = useState<string | null>(null);

  const isDate = kind === "start" || kind === "due";
  const width = kind === "summary" ? Math.max(anchor.width, 240) : kind === "predecessors" ? 180 : Math.max(anchor.width, isDate ? 150 : 96);

  // Kept inside the window when the cell sits near the right edge.
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));

  useEffect(() => {
    const input = wrapRef.current?.querySelector<HTMLInputElement>("input[type=text]");
    input?.focus();
    input?.select();
  }, []);

  function currentValue(): { ok: true; value: EditValue } | { ok: false; error: string } {
    if (isDate) {
      const typed = wrapRef.current?.querySelector<HTMLInputElement>("input[type=text]")?.value ?? "";
      const parsed = parseDateInput(typed, todayIso(), base);
      if (parsed === null) return typed.trim() === "" ? { ok: true, value: null } : { ok: false, error: "Không đọc được ngày. Gõ 15/11, t6, mai hoặc +3n." };
      return { ok: true, value: parsed === initial ? null : parsed };
    }
    if (kind === "duration" || kind === "pct") return { ok: true, value: num === initial ? null : num };
    const t = text.trim();
    return { ok: true, value: t === (typeof initial === "string" ? initial.trim() : "") ? null : t };
  }

  function finish(move: Move) {
    if (done.current) return;
    const v = currentValue();
    if (!v.ok) {
      setError(v.error);
      return;
    }
    const refused = onCommit(v.value, move);
    if (typeof refused === "string") {
      setError(refused);
      return;
    }
    done.current = true;
  }

  function cancel() {
    if (done.current) return;
    done.current = true;
    onCancel();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      finish("down");
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      finish(e.shiftKey ? "prev" : "next");
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  }

  // DateField swallows Escape while it holds a draft and otherwise lets it through; Enter is its own commit,
  // and then this runs. Either way the wrapper's handler is what moves on.
  return createPortal(
    <div
      ref={wrapRef}
      className={`wbs-cell-editor is-${kind}${error ? " is-bad" : ""}`}
      style={{ top: anchor.top, left, width, height: anchor.height }}
      title={error ?? undefined}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) finish("stay");
      }}
    >
      {isDate ? (
        <DateField value={iso} base={base} ariaLabel={kind === "start" ? "Ngày bắt đầu" : "Ngày kết thúc"} onChange={setIso} />
      ) : kind === "duration" || kind === "pct" ? (
        <NumberInput
          value={num}
          onChange={setNum}
          min={kind === "pct" ? 0 : 1}
          max={kind === "pct" ? 100 : undefined}
          integer={kind === "pct"}
          aria-label={kind === "pct" ? "% hoàn thành" : "Thời lượng (ngày)"}
        />
      ) : (
        <input
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          placeholder={kind === "predecessors" ? "5, 7SS, 9FS+2" : undefined}
          aria-label={kind === "summary" ? "Tên việc" : "Phụ thuộc"}
          spellCheck={false}
        />
      )}
    </div>,
    document.body
  );
}
