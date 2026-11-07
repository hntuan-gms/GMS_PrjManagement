import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api, ApiError } from "../api";
import { todayIso } from "../resourceAllocation";
import type { SlaSettings, SlaSettingsResponse } from "../types";
import { useDialogs } from "./dialogContext";
import DateField from "./DateField";
import NumberInput from "./NumberInput";
import { describeWorkDays } from "../workCalendarForm";

interface Props {
  /** The policy as last read; the dialog edits a copy. */
  current: SlaSettingsResponse;
  /** Dialog only: the page (embedded) has nothing to close. */
  onClose?: () => void;
  onSaved: (saved: SlaSettingsResponse) => void;
  /** Dialog: closes it (asking first if something changed) and opens "Lịch làm việc & ngày lễ…". Page: switches section. */
  onOpenCalendar: () => void;
  /** A section of the settings page: no overlay or dialog chrome, Save/Huỷ at the foot of the section. */
  embedded?: boolean;
  /** Embedded: tells the page whether there are unsaved edits, so it can ask before leaving the section. */
  onDirtyChange?: (dirty: boolean) => void;
}

/** Rows with no target carry no meaning, so they do not make the form "changed". */
function comparable(s: SlaSettings): string {
  return JSON.stringify({ ...s, targets: s.targets.filter((t) => t.hours != null) });
}

/**
 * The project's SLA policy: how many working hours each priority may stay open, which
 * issue types count, and the hours of a working day the clock runs on. Which days are
 * worked (weekdays, holidays, make-up days) is the project's calendar, shared with the
 * resource tab, timesheet and sprints, and edited in WorkCalendarModal — shown here only
 * as a summary. Anyone can open it; only a project admin can save (the server checks
 * again, and never writes the calendar from this dialog).
 */
export default function SlaSettingsModal({ current, onClose, onSaved, onOpenCalendar, embedded = false, onDirtyChange }: Props) {
  const { confirm } = useDialogs();
  const [draft, setDraft] = useState<SlaSettings>(() => structuredClone(current.settings));
  const [priorities, setPriorities] = useState<string[]>([]);
  const [issueTypes, setIssueTypes] = useState<string[]>([]);
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
    if (embedded) return;
    const opener = document.activeElement as HTMLElement | null;
    modalRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => opener?.focus?.();
  }, [embedded]);

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

  useEffect(() => {
    onDirtyChange?.(dirty && !readOnly);
  }, [dirty, readOnly, onDirtyChange]);
  // On the page, "Huỷ" puts the saved values back without asking (plan 2.6); the dialog asks before closing.
  const reset = () => {
    setDraft(structuredClone(current.settings));
    setError(null);
  };

  function setTarget(priority: string, hours: number | null) {
    setDraft((d) => {
      const rest = d.targets.filter((t) => t.priority.toLowerCase() !== priority.toLowerCase());
      return { ...d, targets: [...rest, { priority, hours }] };
    });
  }

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  async function confirmDiscard(): Promise<boolean> {
    return !dirty || readOnly || (await confirm({ message: "Bỏ các thay đổi chưa lưu?", confirmLabel: "Bỏ thay đổi", cancelLabel: "Tiếp tục sửa", tone: "danger" }));
  }

  async function requestClose() {
    if (await confirmDiscard()) onClose?.();
  }

  async function openCalendar() {
    // The settings page asks about unsaved edits itself before it switches section.
    if (embedded || (await confirmDiscard())) onOpenCalendar();
  }

  async function save() {
    if (readOnly || saving) return;
    setSaving(true);
    setError(null);
    try {
      // Switching SLA on for the first time starts it today, so earlier work is not judged by a rule it never had.
      const toSave = draft.enabled && !draft.appliesFrom ? { ...draft, appliesFrom: todayIso() } : draft;
      const saved = await api.saveSlaSettings(toSave);
      onSaved(saved);
      // On the page the form stays: show what the server kept (e.g. "áp dụng từ" filled in) so it is not "changed".
      if (embedded) setDraft(structuredClone(saved.settings));
      onClose?.();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Không lưu được cài đặt SLA.");
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

  const note = readOnly ? (
    <div className="sla-note">
      {embedded ? "Chỉ quản trị dự án được sửa" : "Bạn chỉ xem được. Chỉ người có quyền Administer Projects trên dự án này mới sửa được cài đặt SLA."}
    </div>
  ) : null;

  const form = (
        <fieldset className="sla-form" disabled={readOnly || saving}>
          <label className="sla-switch">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
            <span>Bật SLA cho dự án này</span>
          </label>

          <div className="field-row">
            <label className="field">
              <span title="Để trống: tính từ hôm nay khi bật. Việc tạo trước ngày này không bị tính SLA">Áp dụng cho việc tạo từ ngày</span>
              <DateField value={draft.appliesFrom ?? ""} ariaLabel="Áp dụng từ ngày" onChange={(iso) => patch({ appliesFrom: iso || null })} />
            </label>
            <label className="field">
              <span title="0 = không báo sắp trễ">Báo "Sắp trễ" khi còn ≤ (% thời hạn)</span>
              <NumberInput value={draft.warnPercent} min={0} max={90} integer onChange={(v) => v != null && patch({ warnPercent: v })} />
            </label>
          </div>

          <section className="sla-section">
            <h3 title={`Một ngày làm việc = ${hoursPerDay} giờ theo khung giờ của lịch. Để trống = mức đó không tính SLA`}>Thời hạn theo ưu tiên (giờ làm việc)</h3>
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
            <h3 title="Không chọn loại nào = mọi loại việc trừ Epic">Loại việc áp dụng</h3>
            <div className="sla-checks">
              {typeRows.map((t) => (
                <label key={t} className="sla-check">
                  <input type="checkbox" checked={draft.issueTypes.includes(t)} onChange={() => patch({ issueTypes: toggle(draft.issueTypes, t) })} />
                  {t}
                </label>
              ))}
            </div>
          </section>

          <p className="field-hint sla-calendar-summary">
            Lịch: {describeWorkDays(draft.workDays)} · {draft.periods.map((p) => `${p.start}–${p.end}`).join(", ")} · UTC{draft.tzOffsetMinutes >= 0 ? "+" : "−"}
            {Math.abs(draft.tzOffsetMinutes) / 60} · {draft.holidays.length} ngày lễ · {(draft.makeUpDays ?? []).length} ngày làm bù.{" "}
            <button type="button" className="text-btn" onClick={() => void openCalendar()}>
              Mở Lịch làm việc…
            </button>
          </p>

        </fieldset>
  );

  const errorEl = error ? <div className="modal-error">{error}</div> : null;

  if (embedded) {
    return (
      <div className="sla-modal is-embedded" ref={modalRef} onKeyDown={onKeyDown}>
        {note}
        {form}
        {errorEl}
        {!readOnly && (
          <div className="settings-foot">
            <button onClick={reset} disabled={saving || !dirty}>
              Huỷ
            </button>
            <button className="primary" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? "Đang lưu…" : "Lưu cài đặt"}
            </button>
          </div>
        )}
      </div>
    );
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

        {note}
        {form}
        {errorEl}
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
