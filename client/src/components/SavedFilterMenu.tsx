import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api";
import { fromSavedSpec, matchesSaved, toSavedSpec } from "../savedFilters";
import { facetCount, type TaskFilter } from "../taskFilter";
import type { SavedFilter } from "../types";
import { Icon } from "./Icons";
import { useDialogs } from "./dialogContext";

interface Props {
  filter: TaskFilter;
  /** Replaces the whole shared filter — people included, even on the resource tab. */
  onApply: (f: TaskFilter) => void;
  myAccountId: string;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Có lỗi xảy ra.");

/**
 * Named filters, stored on the server so they follow a person across browsers
 * and can be shared with the project. Your own ones can be applied, refreshed
 * from the current facets, renamed, shared/unshared and deleted; a teammate's
 * shared one can only be applied — the server refuses anything else.
 */
export default function SavedFilterMenu({ filter, onApply, myAccountId }: Props) {
  const dialogs = useDialogs();
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<SavedFilter[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setFilters(await api.listSavedFilters());
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      setError(errorText(e));
    }
  }, []);

  // Loaded up front, not on first open: the button names the filter in effect.
  useEffect(() => {
    let cancelled = false;
    api.listSavedFilters().then(
      (list) => {
        if (!cancelled) setFilters(list);
      },
      (e: unknown) => {
        if (!cancelled && !(e instanceof ApiError && e.status === 401)) setError(errorText(e));
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

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

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const canSave = facetCount(filter) > 0;
  const active = filters?.find((f) => matchesSaved(filter, f.spec, myAccountId)) ?? null;
  const mine = filters?.filter((f) => f.mine) ?? [];
  const others = filters?.filter((f) => !f.mine) ?? [];

  function apply(f: SavedFilter) {
    onApply(fromSavedSpec(f.spec, myAccountId));
    setOpen(false);
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Cần đặt tên cho bộ lọc.");
      return;
    }
    void run(async () => {
      await api.createSavedFilter({ name: trimmed, shared, spec: toSavedSpec(filter, myAccountId) });
      setName("");
      setShared(false);
    });
  }

  async function rename(f: SavedFilter) {
    const next = await dialogs.prompt({ title: "Đổi tên bộ lọc", label: "Tên mới", initial: f.name });
    if (next && next !== f.name) void run(() => api.updateSavedFilter(f.id, { name: next }));
  }

  async function remove(f: SavedFilter) {
    const ok = await dialogs.confirm({
      title: "Xoá bộ lọc",
      message: `Xoá bộ lọc "${f.name}"?${f.shared ? " Người khác trong dự án cũng sẽ không còn thấy nó." : ""}`,
      tone: "danger",
    });
    if (ok) void run(() => api.deleteSavedFilter(f.id));
  }

  return (
    <div className="col-chooser tf-select sf-select" ref={ref}>
      <button
        type="button"
        className={`tf-btn${active ? " is-on" : ""}`}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void load();
        }}
        aria-expanded={open}
        title="Lưu bộ lọc đang chọn thành bộ lọc có tên, áp dụng lại hoặc chia sẻ với cả dự án"
      >
        <span className="sf-trigger-label">{active ? `Bộ lọc: ${active.name}` : "Bộ lọc đã lưu"}</span>
        <Icon name="chevronDown" size={12} className="caret" />
      </button>
      {open && (
        <div className="col-chooser-menu tf-menu sf-menu" role="menu">
          {error && <div className="sf-error">{error}</div>}
          {filters === null && !error && <div className="tf-empty">Đang tải…</div>}

          <div className="col-chooser-title">Của tôi</div>
          {filters !== null && mine.length === 0 && <div className="tf-empty">Chưa lưu bộ lọc nào.</div>}
          {mine.map((f) => (
            <div key={f.id} className={`sf-item${active?.id === f.id ? " is-active" : ""}`}>
              <button type="button" className="sf-apply" onClick={() => apply(f)} title="Áp dụng bộ lọc này">
                {f.name}
              </button>
              <span className="sf-actions">
                <button
                  type="button"
                  className="text-btn"
                  disabled={busy}
                  onClick={() => void run(() => api.updateSavedFilter(f.id, { shared: !f.shared }))}
                  title={f.shared ? "Đang chia sẻ với cả dự án — bấm để chỉ mình tôi thấy" : "Chỉ mình tôi thấy — bấm để chia sẻ với cả dự án"}
                >
                  <Icon name={f.shared ? "users" : "lock"} size={12} />
                  {f.shared ? "Chia sẻ" : "Riêng tư"}
                </button>
                <button
                  type="button"
                  className="text-btn"
                  disabled={busy || !canSave || active?.id === f.id}
                  onClick={() => void run(() => api.updateSavedFilter(f.id, { spec: toSavedSpec(filter, myAccountId) }))}
                  title="Thay nội dung bộ lọc này bằng các điều kiện đang chọn"
                >
                  Cập nhật
                </button>
                <button type="button" className="text-btn" disabled={busy} onClick={() => rename(f)} title="Đổi tên">
                  Đổi tên
                </button>
                <button type="button" className="text-btn sf-delete" disabled={busy} onClick={() => remove(f)} title="Xoá bộ lọc">
                  Xoá
                </button>
              </span>
            </div>
          ))}

          {others.length > 0 && (
            <>
              <div className="col-chooser-title">Chia sẻ trong dự án</div>
              {others.map((f) => (
                <div key={f.id} className={`sf-item${active?.id === f.id ? " is-active" : ""}`}>
                  <button type="button" className="sf-apply" onClick={() => apply(f)} title="Áp dụng bộ lọc này">
                    {f.name}
                  </button>
                  <span className="sf-owner">{f.ownerName ?? "người khác"}</span>
                </div>
              ))}
            </>
          )}

          <div className="col-chooser-foot sf-form">
            {canSave ? (
              <>
                <input
                  type="text"
                  value={name}
                  maxLength={80}
                  placeholder="Tên bộ lọc mới…"
                  aria-label="Tên bộ lọc mới"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") save();
                  }}
                />
                <label className="sf-share">
                  <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
                  Chia sẻ với cả dự án
                </label>
                <button type="button" className="text-btn" disabled={busy} onClick={save}>
                  Lưu bộ lọc hiện tại
                </button>
              </>
            ) : (
              <span className="tf-empty">Chọn ít nhất một điều kiện lọc để lưu thành bộ lọc.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
