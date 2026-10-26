import { useEffect, useRef, useState } from "react";
import { fromSavedSpec, hasContent, toSavedSpec } from "../savedFilter";
import type { TaskFilter } from "../taskFilter";
import type { SavedFilter } from "../types";

interface Props {
  /** null while loading. */
  saved: SavedFilter[] | null;
  filter: TaskFilter;
  myAccountId: string;
  onApply: (f: TaskFilter) => void;
  onSave: (name: string, shared: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleShared: (id: string, shared: boolean) => Promise<void>;
}

/**
 * Named filters: apply one, save the current one under a name, share or delete your
 * own. A shared filter is visible to everyone who can open the project; an unshared
 * one only to its author. Applying replaces the whole filter, then the usual "Xoá lọc"
 * undoes it — a saved filter is just a filter someone took the trouble to name.
 */
export default function SavedFilterMenu({ saved, filter, myAccountId, onApply, onSave, onDelete, onToggleShared }: Props) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const canSave = hasContent(toSavedSpec(filter, myAccountId));

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thực hiện được.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col-chooser tf-select" ref={ref}>
      <button type="button" className="tf-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open} title="Bộ lọc đã đặt tên — lưu và chia sẻ cho cả dự án">
        Bộ lọc đã lưu{saved && saved.length > 0 ? ` (${saved.length})` : ""} ▾
      </button>
      {open && (
        <div className="col-chooser-menu tf-menu saved-filters" role="menu">
          {saved === null ? (
            <div className="tf-empty">Đang tải…</div>
          ) : saved.length === 0 ? (
            <div className="tf-empty">Chưa có bộ lọc nào được lưu.</div>
          ) : (
            saved.map((s) => (
              <div key={s.id} className="saved-filter-row">
                <button
                  type="button"
                  className="saved-filter-apply"
                  onClick={() => {
                    onApply(fromSavedSpec(s.spec, myAccountId));
                    setOpen(false);
                  }}
                  title={s.mine ? "Của bạn" : `Chia sẻ bởi ${s.ownerName || "đồng nghiệp"}`}
                >
                  {s.name}
                  <small>{s.mine ? (s.shared ? " · chia sẻ" : " · riêng tư") : ` · ${s.ownerName || "đồng nghiệp"}`}</small>
                </button>
                {s.mine && (
                  <>
                    <button
                      type="button"
                      className="chat-icon-btn"
                      disabled={busy}
                      onClick={() => run(() => onToggleShared(s.id, !s.shared))}
                      title={s.shared ? "Thôi chia sẻ (chỉ mình bạn thấy)" : "Chia sẻ cho cả dự án"}
                      aria-label={s.shared ? "Thôi chia sẻ" : "Chia sẻ"}
                    >
                      {s.shared ? "👥" : "🔒"}
                    </button>
                    <button type="button" className="chat-icon-btn" disabled={busy} onClick={() => run(() => onDelete(s.id))} title="Xoá bộ lọc này" aria-label={`Xoá ${s.name}`}>
                      ✕
                    </button>
                  </>
                )}
              </div>
            ))
          )}
          <div className="col-chooser-foot">
            {naming ? (
              <form
                className="saved-filter-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!name.trim()) return;
                  void run(async () => {
                    await onSave(name, shared);
                    setNaming(false);
                    setName("");
                  });
                }}
              >
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên bộ lọc" maxLength={80} />
                <label>
                  <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Chia sẻ cho cả dự án
                </label>
                <button type="submit" className="primary" disabled={busy || !name.trim()}>
                  Lưu
                </button>
                <button type="button" onClick={() => setNaming(false)}>
                  Huỷ
                </button>
              </form>
            ) : (
              <button type="button" className="text-btn" onClick={() => setNaming(true)} disabled={!canSave} title={canSave ? undefined : "Chọn điều kiện lọc trước"}>
                ＋ Lưu bộ lọc hiện tại…
              </button>
            )}
            {error && <div className="tf-empty is-error">{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
