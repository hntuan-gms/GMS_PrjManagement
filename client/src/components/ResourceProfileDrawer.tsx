import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLayer } from "../useLayer";
import { api } from "../api";
import type { PersonLoad } from "../resourceAllocation";
import { pct, shortDate } from "../resourceColumns";
import { normalizeSkills } from "../skillMatrix";
import type { ResourceAbsence, ResourceProfile } from "../types";
import DateField from "./DateField";
import Avatar from "./Avatar";
import { Icon } from "./Icons";
import SkillsInput from "./SkillsInput";

interface Props {
  person: PersonLoad;
  defaultCapacityHours: number;
  /** Skills already recorded for anyone on the team, offered as completions. */
  skillSuggestions: string[];
  onClose: () => void;
  onProfileSaved: (profile: ResourceProfile) => void;
  onAbsenceAdded: (absence: ResourceAbsence) => void;
  onAbsenceRemoved: (id: string) => void;
  /** An edited leave period replaces the stored one. */
  onAbsenceUpdated: (absence: ResourceAbsence) => void;
}

const sameSkills = (a: string[], b: string[]) => a.length === b.length && a.every((s, i) => s === b[i]);

/**
 * What the heatmap cannot know about a person: their role, how many hours a day they really
 * have, the days they are away, their skills and a note. A slide-over, one save for all of it.
 *
 * The tasks they hold are not here any more — they open inline under the person's row in the
 * heatmap, on the same date columns. This is only the part that is *edited*.
 *
 * Leave periods already stored are listed (edit loads one into the form, ✕ deletes it at once,
 * as it always has); a period typed into the form is added or updated by the same "Lưu"
 * that writes the profile. Only what changed is sent: leave alone, no profile write.
 *
 * Like the task panel (plan 2.6) it has no dimmer and closing saves: Esc, ✕ or the rail all write what
 * was edited and then close. If the write is refused, or a field is not valid, it stays open and says why.
 */
export default function ResourceProfileDrawer({
  person,
  defaultCapacityHours,
  skillSuggestions,
  onClose,
  onProfileSaved,
  onAbsenceAdded,
  onAbsenceRemoved,
  onAbsenceUpdated,
}: Props) {
  useLayer("resource-profile", true, { onEscape: () => void requestClose(), dismissOnNav: true });
  const [role, setRole] = useState(person.role ?? "");
  const [capacity, setCapacity] = useState(String(person.capacityHoursPerDay));
  const [skills, setSkills] = useState<string[]>(person.profile?.skills ?? []);
  const [notes, setNotes] = useState(person.profile?.notes ?? "");
  const [absFrom, setAbsFrom] = useState("");
  const [absTo, setAbsTo] = useState("");
  const [absReason, setAbsReason] = useState("");
  // The leave period being changed; null = the form adds a new one.
  const [editingAbs, setEditingAbs] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const roleRef = useRef<HTMLInputElement>(null);

  const profileDirty =
    role.trim() !== (person.role ?? "") ||
    Number(capacity) !== person.capacityHoursPerDay ||
    !sameSkills(normalizeSkills(skills), person.profile?.skills ?? []) ||
    notes.trim() !== (person.profile?.notes ?? "");
  const leaveDirty = Boolean(absFrom || absTo || absReason.trim());
  const dirty = profileDirty || leaveDirty;

  // Focus lands inside, and goes back to whatever opened the drawer when it closes.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    roleRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  /** Closing is saving: what was edited is written first, and a refusal keeps the drawer open. */
  async function requestClose() {
    await save();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      // Stopped here: the workspace clears the Gantt selection on a window-level Escape.
      e.stopPropagation();
      void requestClose();
      return;
    }
    // Ctrl/Cmd+Enter saves; so does the drawer's own button. Tab is not trapped: it is not a modal.
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void save();
    }
  }

  function resetLeaveForm() {
    setEditingAbs(null);
    setAbsFrom("");
    setAbsTo("");
    setAbsReason("");
  }

  function editAbsence(a: ResourceAbsence) {
    setEditingAbs(a.id);
    setAbsFrom(a.from);
    setAbsTo(a.to);
    setAbsReason(a.reason ?? "");
  }

  async function removeAbsence(id: string) {
    try {
      await api.deleteAbsence(id);
      if (editingAbs === id) resetLeaveForm();
      onAbsenceRemoved(id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function save() {
    if (saving) return;
    const hours = Number(capacity);
    if (profileDirty && (!Number.isFinite(hours) || hours <= 0 || hours > 24)) {
      setError("Công suất phải lớn hơn 0 và không quá 24 giờ mỗi ngày.");
      return;
    }
    if (leaveDirty && (!absFrom || !absTo)) {
      setError("Kỳ nghỉ cần cả ngày bắt đầu và ngày kết thúc.");
      return;
    }
    if (leaveDirty && absTo < absFrom) {
      setError("Ngày kết thúc kỳ nghỉ phải sau hoặc cùng ngày bắt đầu.");
      return;
    }
    if (!dirty) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (profileDirty) {
        onProfileSaved(
          await api.saveResourceProfile(person.accountId, {
            displayName: person.displayName,
            role: role.trim(),
            capacityHoursPerDay: hours,
            skills,
            notes: notes.trim(),
          })
        );
      }
      if (leaveDirty) {
        const reason = absReason.trim() || null;
        if (editingAbs) onAbsenceUpdated(await api.updateAbsence(editingAbs, { from: absFrom, to: absTo, reason }));
        else onAbsenceAdded(await api.addAbsence(person.accountId, absFrom, absTo, reason));
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div
        ref={drawerRef}
        className="rv-drawer"
        role="dialog"
        aria-modal="false"
        aria-label={`Hồ sơ và kỳ nghỉ của ${person.displayName}`}
        onKeyDown={onKeyDown}
      >
        <div className="rv-drawer-head">
          <Avatar name={person.displayName} avatarUrl={person.avatarUrl} className="rv-avatar rv-avatar-lg rv-avatar-empty" decorative />
          <div className="rv-drawer-title">
            <b>{person.displayName}</b>
            <small>
              {person.allocatedHours}h đã giao / {person.capacityHours}h khả dụng · {pct(person.utilisation)} mức sử dụng
              {person.overloadedDays > 0 && ` · ${person.overloadedDays} ngày quá tải`}
            </small>
          </div>
          <button type="button" className="icon-btn" onClick={() => void requestClose()} aria-label="Đóng" title="Đóng">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="rv-drawer-body">
          <label className="field">
            <span>Vai trò</span>
            <input ref={roleRef} value={role} onChange={(e) => setRole(e.target.value)} placeholder="VD: Backend Developer" />
          </label>
          <label className="field">
            <span>Công suất (giờ/ngày)</span>
            <input type="number" min={1} max={24} step={0.5} value={capacity} placeholder={String(defaultCapacityHours)} onChange={(e) => setCapacity(e.target.value)} />
          </label>

          <fieldset className="rv-drawer-leave">
            <legend>{editingAbs ? "Sửa kỳ nghỉ" : "Nghỉ từ – đến"}</legend>
            <div className="field-row">
              <label className="field">
                <span>Từ</span>
                <DateField value={absFrom} ariaLabel="Nghỉ từ" onChange={setAbsFrom} />
              </label>
              <label className="field">
                <span>Đến</span>
                <DateField value={absTo} ariaLabel="Nghỉ đến" base={absFrom || undefined} onChange={setAbsTo} />
              </label>
            </div>
            <label className="field">
              <span>Lý do</span>
              <input value={absReason} onChange={(e) => setAbsReason(e.target.value)} placeholder="Nghỉ phép, công tác..." />
            </label>
            {leaveDirty && (
              <button type="button" className="text-btn rv-drawer-reset" onClick={resetLeaveForm}>
                {editingAbs ? "Huỷ sửa kỳ nghỉ" : "Xoá phần đang nhập"}
              </button>
            )}
            {person.absences.length > 0 && (
              <div className="rv-absences">
                {person.absences.map((a) => (
                  <span key={a.id} className={`rv-abs-chip ${editingAbs === a.id ? "is-editing" : ""}`}>
                    {shortDate(a.from)} – {shortDate(a.to)}
                    {a.reason ? ` · ${a.reason}` : ""}
                    <button type="button" onClick={() => editAbsence(a)} aria-label="Sửa kỳ nghỉ" title="Sửa">
                      <Icon name="edit" size={12} />
                    </button>
                    <button type="button" onClick={() => void removeAbsence(a.id)} aria-label="Xoá kỳ nghỉ" title="Xoá">
                      <Icon name="x" size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </fieldset>

          <label className="field rv-skills-field">
            <span>Kỹ năng</span>
            <SkillsInput value={skills} onChange={setSkills} suggestions={skillSuggestions} />
          </label>
          <label className="field rv-notes-field">
            <span>Ghi chú</span>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="VD: chỉ làm buổi sáng thứ 6" />
          </label>

          {error && (
            <div className="rv-notice rv-notice-error" role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="rv-drawer-foot">
          <button type="button" className="primary" onClick={() => void save()} disabled={saving || !dirty} title="Đóng khung cũng lưu">
            {saving ? "Đang lưu…" : dirty ? "Lưu" : "Đã lưu"}
            <kbd>Ctrl ⏎</kbd>
          </button>
        </div>
      </div>
    </>
  );
}
