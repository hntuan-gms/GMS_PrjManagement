import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, ApiError } from "../api";
import type { WorkCalendarSettings } from "../types";
import {
  expandRange,
  formatRange,
  groupDated,
  makeUpDayWarning,
  mergeDated,
  WEEKDAY_LABELS,
  type DatedEntry,
} from "../workCalendarForm";
import DateField from "./DateField";
import TimeInput from "./TimeInput";
import { useDialogs } from "./dialogContext";
import { Icon } from "./Icons";

type Calendar = Required<WorkCalendarSettings>;

interface Props {
  /** What the workspace already holds (from the SLA row), shown at once while the fresh copy loads. */
  initial: WorkCalendarSettings | null;
  /** The workspace's answer to "may this user edit?" (same rule as SLA); confirmed by the GET. */
  canEdit: boolean;
  /** Dialog only: the page (embedded) has nothing to close. */
  onClose?: () => void;
  onSaved: (calendar: Calendar) => void;
  /** A section of the settings page: no overlay or dialog chrome, Save/Huỷ at the foot of the section. */
  embedded?: boolean;
  /** Embedded: tells the page whether there are unsaved edits, so it can ask before leaving the section. */
  onDirtyChange?: (dirty: boolean) => void;
}

const DEFAULT_PERIODS = [
  { start: "08:00", end: "12:00" },
  { start: "13:00", end: "17:00" },
];
const DEFAULT: Calendar = { workDays: [1, 2, 3, 4, 5], holidays: [], makeUpDays: [], periods: DEFAULT_PERIODS, tzOffsetMinutes: 420 };
const OFFSETS = Array.from({ length: 27 }, (_, i) => i - 12);

function normalize(c: WorkCalendarSettings | null): Calendar {
  if (!c) return DEFAULT;
  return {
    workDays: [...c.workDays].sort((a, b) => a - b),
    holidays: c.holidays ?? [],
    makeUpDays: c.makeUpDays ?? [],
    periods: c.periods ?? DEFAULT_PERIODS,
    tzOffsetMinutes: c.tzOffsetMinutes ?? 420,
  };
}

/**
 * The project's working calendar: which weekdays are worked, holidays, make-up days. One calendar per project,
 * read by the resource heatmap, the timesheet, sprint capacity and burndown, the assistant and the SLA clock
 * (workCalendar.ts). Anyone can open it; only a project admin can save (PUT /api/calendar checks again).
 * Holidays are entered as a range and stored one entry per date; the list shows them grouped back into ranges.
 */
export default function WorkCalendarModal({ initial, canEdit: canEditHint, onClose, onSaved, embedded = false, onDirtyChange }: Props) {
  const { confirm } = useDialogs();
  const [base, setBase] = useState<Calendar>(() => normalize(initial));
  const [draft, setDraft] = useState<Calendar>(() => normalize(initial));
  const [canEdit, setCanEdit] = useState(canEditHint);
  const [loading, setLoading] = useState(true);
  const [hFrom, setHFrom] = useState("");
  const [hTo, setHTo] = useState("");
  const [hName, setHName] = useState("");
  const [hError, setHError] = useState<string | null>(null);
  const [mDate, setMDate] = useState("");
  const [mName, setMName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  // Set by the first edit: from then on the fresh copy arriving late must not replace what was typed.
  const touched = useRef(false);
  const readOnly = !canEdit;

  // The workspace's copy may be minutes old; the dialog edits the stored one. Not swapped in once the user
  // has started typing, so a slow answer never wipes an edit.
  useEffect(() => {
    let alive = true;
    api.getWorkCalendar().then(
      (r) => {
        if (!alive) return;
        setCanEdit(r.canEdit);
        if (!touched.current) {
          setBase(normalize(r.calendar));
          setDraft(normalize(r.calendar));
        }
        setLoading(false);
      },
      () => alive && setLoading(false)
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (embedded) return;
    const opener = document.activeElement as HTMLElement | null;
    modalRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => opener?.focus?.();
  }, [embedded]);

  useEffect(() => {
    onDirtyChange?.(dirty && !readOnly);
  }, [dirty, readOnly, onDirtyChange]);
  // On the page, "Huỷ" puts the saved values back without asking (plan 2.6); the dialog asks before closing.
  const reset = () => {
    touched.current = false;
    setDraft(base);
    setError(null);
    setHError(null);
  };

  const patch = (p: Partial<Calendar>) => {
    touched.current = true;
    setDraft((d) => ({ ...d, ...p }));
  };
  const makeUpWarning = makeUpDayWarning(mDate, draft.workDays, draft.holidays);

  function toggleDay(d: number) {
    const has = draft.workDays.includes(d);
    patch({ workDays: (has ? draft.workDays.filter((x) => x !== d) : [...draft.workDays, d]).sort((a, b) => a - b) });
  }

  function addHolidays() {
    const added = expandRange(hFrom, hTo, hName);
    if ("error" in added) {
      setHError(added.error);
      return;
    }
    const dates = new Set(added.map((a) => a.date));
    // A make-up day turned into a holiday stops being one: a date cannot be both (the server refuses it too).
    patch({ holidays: mergeDated(draft.holidays, added), makeUpDays: draft.makeUpDays.filter((m) => !dates.has(m.date)) });
    setHFrom("");
    setHTo("");
    setHName("");
    setHError(null);
  }

  function addMakeUpDay() {
    if (!mDate || makeUpWarning) return;
    patch({ makeUpDays: mergeDated(draft.makeUpDays, [{ date: mDate, name: mName.trim() }]) });
    setMDate("");
    setMName("");
  }

  const removeDates = (list: DatedEntry[], dates: string[]) => list.filter((e) => !dates.includes(e.date));

  async function requestClose() {
    if (dirty && !readOnly && !(await confirm({ message: "Bỏ các thay đổi chưa lưu?", confirmLabel: "Bỏ thay đổi", cancelLabel: "Tiếp tục sửa", tone: "danger" }))) return;
    onClose?.();
  }

  async function save() {
    if (readOnly || saving || !dirty) return;
    if (draft.workDays.length === 0) {
      setError("Cần ít nhất một ngày làm việc trong tuần.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await api.saveWorkCalendar(draft);
      const saved = normalize(r.calendar);
      onSaved(saved);
      // On the page the form stays; what was just saved becomes the baseline it is compared against.
      setBase(saved);
      setDraft(saved);
      touched.current = false;
      onClose?.();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Không lưu được lịch làm việc.");
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (embedded) return;
      // Stopped here: the workspace clears the Gantt selection on a window-level Escape.
      e.stopPropagation();
      void requestClose();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void save();
    }
  }

  const holidayGroups = groupDated(draft.holidays);
  const makeUpGroups = groupDated(draft.makeUpDays);

  const note =
    readOnly && !loading ? (
      <div className="sla-note">
        {embedded ? "Chỉ quản trị dự án được sửa" : "Bạn chỉ xem được. Chỉ người có quyền Administer Projects trên dự án này mới sửa được lịch làm việc."}
      </div>
    ) : null;

  const form = (
        <fieldset className="sla-form" disabled={readOnly || saving}>
          <section className="sla-section cal-section-first">
            <h3>Ngày làm việc trong tuần</h3>
            <div className="sla-checks" role="group" aria-label="Ngày làm việc trong tuần">
              {WEEKDAY_LABELS.map(([d, label]) => (
                <label key={d} className="sla-check">
                  <input type="checkbox" checked={draft.workDays.includes(d)} onChange={() => toggleDay(d)} />
                  {label}
                </label>
              ))}
            </div>
          </section>

          <section className="sla-section">
            <h3 title="Các khung giờ làm việc trong một ngày làm việc; đồng hồ SLA và giờ kỳ vọng đếm theo đây">Giờ làm việc</h3>
            <div className="sla-periods">
              {draft.periods.map((p, i) => (
                <div key={i} className="sla-period">
                  <span>Khung {i + 1}</span>
                  <TimeInput
                    aria-label={`Khung ${i + 1} bắt đầu`}
                    value={p.start}
                    onChange={(v) => patch({ periods: draft.periods.map((x, j) => (j === i ? { ...x, start: v } : x)) })}
                  />
                  <span>–</span>
                  <TimeInput
                    aria-label={`Khung ${i + 1} kết thúc`}
                    value={p.end}
                    onChange={(v) => patch({ periods: draft.periods.map((x, j) => (j === i ? { ...x, end: v } : x)) })}
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
            <h3 title="Không ai làm việc: không tính công suất, không tính giờ kỳ vọng, đồng hồ SLA dừng">Ngày lễ{draft.holidays.length > 0 && ` · ${draft.holidays.length}`}</h3>
            <div className="cal-add cal-add-range">
              <label className="field">
                <span>Từ ngày</span>
                <DateField value={hFrom} ariaLabel="Từ ngày" onChange={setHFrom} />
              </label>
              <label className="field">
                <span>Đến ngày</span>
                <DateField value={hTo} ariaLabel="Đến ngày" base={hFrom || undefined} onChange={setHTo} />
              </label>
              <label className="field">
                <span>Tên ngày lễ</span>
                <input type="text" placeholder="vd: Tết Nguyên đán" value={hName} onChange={(e) => setHName(e.target.value)} />
              </label>
              <button type="button" onClick={addHolidays} disabled={!hFrom}>
                Thêm
              </button>
            </div>
            {hError && <div className="cal-error">{hError}</div>}
            {holidayGroups.length > 0 && (
              <ul className="sla-holidays cal-list" aria-label="Danh sách ngày lễ">
                {holidayGroups.map((g) => (
                  <li key={g.from}>
                    <span className="sla-holiday-date">{formatRange(g.from, g.to)}</span>
                    <span>
                      {g.name || <em className="sla-muted">không tên</em>}
                      {g.dates.length > 1 && <small className="sla-muted"> · {g.dates.length} ngày</small>}
                    </span>
                    <button
                      type="button"
                      className="sla-remove"
                      aria-label={`Xoá ngày lễ ${formatRange(g.from, g.to)}`}
                      title="Xoá"
                      onClick={() => patch({ holidays: removeDates(draft.holidays, g.dates) })}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="sla-section">
            <h3 title="Cuối tuần vẫn đi làm">Ngày làm bù{draft.makeUpDays.length > 0 && ` · ${draft.makeUpDays.length}`}</h3>
            <div className="cal-add cal-add-single">
              <label className="field">
                <span>Ngày</span>
                <DateField value={mDate} ariaLabel="Ngày làm bù" onChange={setMDate} />
              </label>
              <label className="field">
                <span>Ghi chú</span>
                <input type="text" placeholder="vd: Làm bù Tết" value={mName} onChange={(e) => setMName(e.target.value)} />
              </label>
              <button type="button" onClick={addMakeUpDay} disabled={!mDate || !!makeUpWarning}>
                Thêm
              </button>
            </div>
            {makeUpWarning && <div className="cal-error">{makeUpWarning}</div>}
            {makeUpGroups.length > 0 && (
              <ul className="sla-holidays cal-list" aria-label="Danh sách ngày làm bù">
                {makeUpGroups.map((g) => (
                  <li key={g.from}>
                    <span className="sla-holiday-date">{formatRange(g.from, g.to)}</span>
                    <span>{g.name || <em className="sla-muted">không ghi chú</em>}</span>
                    <button
                      type="button"
                      className="sla-remove"
                      aria-label={`Xoá ngày làm bù ${formatRange(g.from, g.to)}`}
                      title="Xoá"
                      onClick={() => patch({ makeUpDays: removeDates(draft.makeUpDays, g.dates) })}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </fieldset>
  );

  const errorEl = error ? <div className="modal-error">{error}</div> : null;

  if (embedded) {
    return (
      <div className="sla-modal cal-modal is-embedded" ref={modalRef} onKeyDown={onKeyDown}>
        {note}
        {form}
        {errorEl}
        {!readOnly && (
          <div className="settings-foot">
            {loading && <span className="sla-muted">Đang tải lịch mới nhất…</span>}
            <button onClick={reset} disabled={saving || !dirty}>
              Huỷ
            </button>
            <button className="primary" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? "Đang lưu…" : "Lưu lịch"}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={() => void requestClose()}>
      <div
        className="modal sla-modal cal-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cal-title"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="modal-id" id="cal-title">
              Lịch làm việc & ngày lễ
            </span>
            <p className="modal-subtitle">
              Dùng chung cho cả dự án.
            </p>
          </div>
          <button className="modal-close" onClick={() => void requestClose()} aria-label="Đóng" title="Đóng">
            <Icon name="x" />
          </button>
        </div>

        {note}
        {form}
        {errorEl}
        <div className="modal-footer">
          {loading && <span className="sla-muted">Đang tải lịch mới nhất…</span>}
          <div className="spacer" />
          <button onClick={() => void requestClose()}>{readOnly ? "Đóng" : "Huỷ"}</button>
          {!readOnly && (
            <button className="primary" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? "Đang lưu…" : "Lưu lịch"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
