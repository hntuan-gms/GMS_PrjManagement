import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { fold } from "../csvImport";

export interface PickItem {
  id: string;
  label: string;
  /** Shown before the label (an avatar letter, a status glyph). */
  lead?: ReactNode;
  /** Muted text after the label ("hiện tại", "gợi ý"). */
  hint?: string;
  /** "risk" colours the hint as a warning (a conflict), "ok" as a calm positive. */
  tone?: "risk" | "ok";
}

/**
 * Edit a cell where it is (plan §6.1.4): a small list that opens on the cell itself, with a search
 * box, ↑↓ Enter Esc. Portalled and fixed-positioned from the cell's rectangle so the Gantt's scroll
 * containers cannot clip it. Picking calls onPick and closes; the change is saved at once by the
 * caller and reported with a toast.
 */
export default function CellPicker({
  anchor,
  items,
  loading,
  placeholder,
  onPick,
  onClose,
  search,
  onQuery,
  className,
}: {
  anchor: DOMRect;
  items: PickItem[] | null;
  loading?: boolean;
  placeholder: string;
  onPick: (item: PickItem) => void;
  onClose: () => void;
  /** Replaces the built-in filter (label + hint contain the folded query): ranking, limits. Gets every item and the raw query. */
  search?: (items: PickItem[], query: string) => PickItem[];
  /** Told every time the typed text changes (a picker that also asks a server). */
  onQuery?: (query: string) => void;
  /** Added to the panel, e.g. "is-wide". */
  className?: string;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: anchor.bottom + 4, left: anchor.left });

  const shown = useMemo(() => {
    const f = fold(q);
    const list = items ?? [];
    if (search) return search(list, q);
    return f ? list.filter((i) => fold(`${i.label} ${i.hint ?? ""}`).includes(f)) : list;
  }, [items, q, search]);

  // Keep the panel inside the window: flip above the cell when there is no room below.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    const top = anchor.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, anchor.top - 4 - h) : anchor.bottom + 4;
    const left = Math.min(anchor.left, window.innerWidth - w - 8);
    setPos((p) => (p.top === top && p.left === left ? p : { top, left }));
  }, [anchor, shown.length, loading]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    }
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  return createPortal(
    <div
      ref={panelRef}
      className={`cell-picker${className ? ` ${className}` : ""}`}
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label={placeholder}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((a) => Math.min(shown.length - 1, a + 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((a) => Math.max(0, a - 1));
        } else if (e.key === "Enter") {
          e.preventDefault();
          const it = shown[active];
          if (it) onPick(it);
        }
      }}
    >
      <input
        autoFocus
        value={q}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          onQuery?.(e.target.value);
        }}
      />
      <div className="cell-picker-list" role="listbox">
        {loading && !items ? (
          <div className="cell-picker-empty">Đang hỏi Jira…</div>
        ) : shown.length === 0 ? (
          <div className="cell-picker-empty">Không có gì khớp.</div>
        ) : (
          shown.map((it, i) => (
            <div
              key={it.id}
              role="option"
              aria-selected={i === active}
              className={`cell-picker-item${i === active ? " is-active" : ""}`}
              onMouseMove={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(it);
              }}
            >
              {it.lead}
              <span className="cell-picker-label">{it.label}</span>
              {it.hint && <span className={`cell-picker-hint${it.tone ? ` is-${it.tone}` : ""}`}>{it.hint}</span>}
            </div>
          ))
        )}
      </div>
    </div>,
    document.body
  );
}
