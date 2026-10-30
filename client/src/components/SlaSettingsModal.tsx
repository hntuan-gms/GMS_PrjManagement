import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api, ApiError } from "../api";
import { todayIso } from "../resourceAllocation";
import type { SlaSettings, SlaSettingsResponse } from "../types";
import { useDialogs } from "./dialogContext";
import NumberInput from "./NumberInput";

interface Props {
  /** The policy as last read; the dialog edits a copy. */
  current: SlaSettingsResponse;
  onClose: () => void;
  onSaved: (saved: SlaSettingsResponse) => void;
}

const WEEKDAYS: Array<[number, string]> = [
  [1, "T2"],
  [2, "T3"],
  [3, "T4"],
  [4, "T5"],
  [5, "T6"],
  [6, "T7"],
  [7, "CN"],
];

const OFFSETS = Array.from({ length: 27 }, (_, i) => i - 12);

/** Rows with no target carry no meaning, so they do not make the form "changed". */
function comparable(s: SlaSettings): string {
  return JSON.stringify({ ...s, targets: s.targets.filter((t) => t.hours != null) });
}

/**
 * The project's SLA policy: how many working hours each priority may stay open, which
 * issue types count, and the working calendar the clock runs on. Anyone can open it;
 * only a project admin can save (the server checks again). One "Lưu" writes all of it.
 */
export default function SlaSettingsModal({ current, onClose, onSaved }: Props) {
  const { confirm } = useDialogs();
  const [draft, setDraft] = useState<SlaSettings>(() => structuredClone(current.settings));
  const [priorities, setPriorities] = useState<string[]>([]);
  const [issueTypes, setIssueTypes] = useState<string[]>([]);
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const readOnly = !current.canEdit;

  useEffect(() => {
    let alive = true;
    api.listPriorities().then((p) => alive && setPriorities(p), () => undefined);
    api.listIssueTypes().then((t) => alive && setIssueTypes(t.map((x) => x.name)), () => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    modalRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => opener?.focus?.();
  }, []);

  // The site's priorities in Jira's order, then any the policy names that the site no longer has.
  const priorityRows = useMemo(() => {
    const names = [...priorities];
    for (const t of draft.targets) if (!names.some((n) => n.toLowerCase() === t.priority.toLowerCase())) names.push(t.priority);
    return names.map((name) => ({ name, hours: draft.targets.find((t) => t.priority.toLowerCase() === name.toLowerCase())?.hours ?? null }));
  }, [priorities, draft.targets]);

  const typeRows = useMemo(() => [...new Set([...issueTypes, ...draft.issueTypes])], [issueTypes, draft.issueTypes]);
  const dirty = comparable(draft) !== comparable(current.settings);
  const hoursPerDay = draft.periods.reduce((sum, p) => {
    const m = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
    return sum + Math.max(0, m(p.end) - m(p.start));
  }, 0) / 60;

  const patch = (p: Partial<SlaSettings>) => setDraft((d) => ({ ...d, ...p }));

  function setTarget(priority: string, hours: number | null) {
    setDraft((d) => {
      const rest = d.targets.filter((t) => t.priority.toLowerCase() !== priority.toLowerCase());
      return { ...d, targets: [...rest, { priority, hours }] };
    });
  }

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function addHoliday() {
    if (!holidayDate) return;
    patch({
      holidays: [...draft.holidays.filter((h) => h.date !== holidayDate), { date: holidayDate, name: holidayName.trim() }].sort((a, b) =>
        a.date.localeCompare(b.date)
      ),
    });
    setHolidayDate("");
    setHolidayName("");
  }

  async function requestClose() {
    if (dirty && !readOnly && !(await confirm({ message: "Bỏ các thay đổi chưa lưu?", confirmLabel: "Bỏ thay đổi", cancelLabel: "Tiếp tục sửa", tone: "danger" }))) return;
    onClose();
  }

  async function save() {
    if (readOnly || saving) return;
    setSaving(true);
    setError(null);
    try {
      // Switching SLA on for the first time starts it today, so earlier work is not judged by a rule it never had.
      const toSave = draft.enabled && !draft.appliesFrom ? { ...draft, appliesFrom: todayIso() } : draft;
      onSaved(await api.saveSlaSettings(toSave));
      onClose();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Không lưu được cài đặt SLA.");
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      // Stopped here: the workspace clears the Gantt selection on a window-level Escape.
      e.stopPropagation();
      void requestClose();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void save();
    }
  }

  return (
    <div className="modal-overlay" onClick={() => void requestClose()}>
      <div
        className="modal sla-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sla-title"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="modal-id" id="sla-title">
              Cài đặt SLA
            </span>
            <p className="modal-subtitle">
              Mỗi mức ưu tiên có một thời hạn xử lý. Đồng hồ chạy từ lúc việc được tạo, chỉ tính giờ làm việc (bỏ nghỉ trưa, ngày nghỉ, ngày lễ).
            </p>
          </div>
          <button className="modal-close" onClick={() => void requestClose()} aria-label="Đóng">
            ✕
          </button>
        </div>

        {readOnly && <div className="sla-note">Bạn chỉ xem được. Chỉ người có quyền Administer Projects trên dự án này mới sửa được cài đặt SLA.</div>}

        <fieldset className="sla-form" disabled={readOnly || saving}>
          <label className="sla-switch">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
            <span>Bật SLA cho dự án này</span>
          </label>

          <div className="field-row">
            <label className="field">
              <span>Áp dụng cho việc tạo từ ngày</span>
              <input type="date" value={draft.appliesFrom ?? ""} onChange={(e) => patch({ appliesFrom: e.target.value || null })} />
              <small className="field-hint">Để trống: tính từ hôm nay khi bật. Việc tạo trước ngày này không bị tính SLA.</small>
            </label>
            <label className="field">
              <span>Báo "Sắp trễ" khi còn ≤ (% thời hạn)</span>
              <NumberInput value={draft.warnPercent} min={0} max={90} integer onChange={(v) => v != null && patch({ warnPercent: v })} />
              <small className="field-hint">0 = không báo sắp trễ.</small>
            </label>
          </div>

          <section className="sla-section">
            <h3>Thời hạn theo mức ưu tiên (giờ làm việc)</h3>
            <p className="field-hint">
              Một ngày làm việc = {hoursPerDay} giờ theo khung giờ bên dưới. Để trống = mức đó không tính SLA.
            </p>
            <div className="sla-targets">
              {priorityRows.length === 0 && <em className="sla-muted">Đang tải danh sách mức ưu tiên…</em>}
              {priorityRows.map((row) => (
                <label key={row.name} className="sla-target">
                  <span>{row.name}</span>
                  <NumberInput
                    value={row.hours}
                    min={0.25}
                    max={10000}
                    allowEmpty
                    aria-label={`Số giờ cho mức ${row.name}`}
                    onChange={(v) => setTarget(row.name, v)}
                  />
                  <small>giờ</small>
                </label>
              ))}
            </div>
          </section>

          <section className="sla-section">
            <h3>Loại việc áp dụng</h3>
            <p className="field-hint">Không chọn loại nào = mọi loại việc trừ Epic.</p>
            <div className="sla-checks">
              {typeRows.map((t) => (
                <label key={t} className="sla-check">
                  <input type="checkbox" checked={draft.issueTypes.includes(t)} onChange={() => patch({ issueTypes: toggle(draft.issueTypes, t) })} />
                  {t}
                </label>
              ))}
            </div>
          </section>

          <section className="sla-section">
            <h3>Lịch làm việc</h3>
            <div className="sla-checks" role="group" aria-label="Ngày làm việc trong tuần">
              {WEEKDAYS.map(([d, label]) => (
                <label key={d} className="sla-check">
                  <input
                    type="checkbox"
                    checked={draft.workDays.includes(d)}
                    onChange={() => patch({ workDays: toggle(draft.workDays, d).sort((a, b) => a - b) })}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="sla-periods">
              {draft.periods.map((p, i) => (
                <div key={i} className="sla-period">
                  <span>Khung {i + 1}</span>
                  <input
                    type="time"
                    aria-label={`Khung ${i + 1} bắt đầu`}
                    value={p.start}
                    onChange={(e) => patch({ periods: draft.periods.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })}
                  />
                  <span>–</span>
                  <input
                    type="time"
                    aria-label={`Khung ${i + 1} kết thúc`}
                    value={p.end}
                    onChange={(e) => patch({ periods: draft.periods.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })}
                  />
                  {draft.periods.length > 1 && (
                    <button type="button" className="sla-remove" aria-label={`Xoá khung ${i + 1}`} onClick={() => patch({ periods: draft.periods.filter((_, j) => j !== i) })}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {draft.periods.length < 3 && (
                <button type="button" className="sla-add" onClick={() => patch({ periods: [...draft.periods, { start: "18:00", end: "20:00" }] })}>
                  + Thêm khung giờ
                </button>
              )}
            </div>
            <label className="field sla-tz">
              <span>Múi giờ của lịch</span>
              <select value={draft.tzOffsetMinutes} onChange={(e) => patch({ tzOffsetMinutes: Number(e.target.value) })}>
                {OFFSETS.map((h) => (
                  <option key={h} value={h * 60}>
                    UTC{h >= 0 ? "+" : "−"}
                    {Math.abs(h)}
                    {h === 7 ? " (Việt Nam)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="sla-section">
            <h3>Ngày lễ ({draft.holidays.length})</h3>
            <p className="field-hint">Đồng hồ SLA dừng trong những ngày này.</p>
            <div className="sla-holiday-add">
              <input type="date" aria-label="Ngày lễ" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
              <input type="text" aria-label="Tên ngày lễ" placeholder="Tên (vd: Quốc khánh)" value={holidayName} onChange={(e) => setHolidayName(e.target.value)} />
              <button type="button" onClick={addHoliday} disabled={!holidayDate}>
                Thêm
              </button>
            </div>
            {draft.holidays.length > 0 && (
              <ul className="sla-holidays">
                {draft.holidays.map((h) => (
                  <li key={h.date}>
                    <span className="sla-holiday-date">{h.date.split("-").reverse().join("/")}</span>
                    <span>{h.name || <em className="sla-muted">không tên</em>}</span>
                    <button type="button" className="sla-remove" aria-label={`Xoá ngày lễ ${h.date}`} onClick={() => patch({ holidays: draft.holidays.filter((x) => x.date !== h.date) })}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </fieldset>

        {error && <div className="modal-error">{error}</div>}
        <div className="modal-footer">
          <div className="spacer" />
          <button onClick={() => void requestClose()}>{readOnly ? "Đóng" : "Huỷ"}</button>
          {!readOnly && (
            <button className="primary" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? "Đang lưu…" : "Lưu cài đặt"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
