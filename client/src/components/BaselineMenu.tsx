import { useEffect, useRef, useState } from "react";

interface Props {
  show: boolean;
  onToggleShow: () => void;
  /** Tasks ticked on the Gantt. */
  selectedCount: number;
  /** Tasks in the project. */
  totalCount: number;
  /** null ids = every task. */
  onSet: (ids: "all" | "selected") => void;
  onClear: (ids: "all" | "selected") => void;
  busy: boolean;
}

/**
 * The baseline is the plan as committed: each task's dates, saved so later drift shows
 * against it (the thin strip under a bar, and the report's "planned %"). It lives in
 * this app only — nothing is written to Jira — and setting it overwrites the old one,
 * so the project-wide action asks first.
 */
export default function BaselineMenu({ show, onToggleShow, selectedCount, totalCount, onSet, onClear, busy }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function act(kind: "set" | "clear", scope: "all" | "selected") {
    const count = scope === "all" ? totalCount : selectedCount;
    const text =
      kind === "set"
        ? `Lưu lịch hiện tại làm baseline cho ${count} công việc? Baseline cũ của chúng sẽ bị ghi đè.`
        : `Xoá baseline của ${count} công việc?`;
    // Only the wide action is worth a prompt: a selection is something you just picked.
    if (scope === "all" && !window.confirm(text)) return;
    setOpen(false);
    (kind === "set" ? onSet : onClear)(scope);
  }

  return (
    <div className="col-chooser" ref={ref}>
      <button
        className={show ? "active" : ""}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={busy}
        title="Baseline: lịch đã chốt để so với lịch thực tế"
      >
        Baseline ▾
      </button>
      {open && (
        <div className="col-chooser-menu tf-menu" role="menu">
          <label className="col-chooser-item">
            <input type="checkbox" checked={show} onChange={onToggleShow} />
            <span className="tf-item-label">Hiện baseline dưới mỗi thanh</span>
          </label>
          <div className="col-chooser-title">Lưu lịch hiện tại làm baseline</div>
          <button type="button" className="menu-action" onClick={() => act("set", "selected")} disabled={selectedCount === 0}>
            Cho {selectedCount} việc đã chọn
          </button>
          <button type="button" className="menu-action" onClick={() => act("set", "all")} disabled={totalCount === 0}>
            Cho cả dự án ({totalCount} việc)
          </button>
          <div className="col-chooser-title">Xoá baseline</div>
          <button type="button" className="menu-action" onClick={() => act("clear", "selected")} disabled={selectedCount === 0}>
            Của {selectedCount} việc đã chọn
          </button>
          <button type="button" className="menu-action" onClick={() => act("clear", "all")} disabled={totalCount === 0}>
            Của cả dự án
          </button>
          <div className="tf-empty">Baseline chỉ lưu trong ứng dụng, không ghi lên Jira.</div>
        </div>
      )}
    </div>
  );
}
