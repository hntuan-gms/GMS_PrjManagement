import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLayer } from "../useLayer";
import { api } from "../api";
import type { PersonLoad } from "../resourceAllocation";
import { MAX_CAPACITY_HOURS, parseCapacity, shortDate } from "../resourceColumns";
import { normalizeSkills } from "../skillMatrix";
import type { ResourceAbsence, ResourceProfile } from "../types";
import Avatar from "./Avatar";
import DateField from "./DateField";
import { Icon } from "./Icons";
import SkillsInput from "./SkillsInput";

interface Props {
  person: PersonLoad;
  defaultCapacityHours: number;
  /** Skills already recorded for anyone on the team, offered as completions. */
  skillSuggestions: string[];
  /** The one line under the name: the person's load over the same window as every other figure on the tab. */
  summary: string;
  onClose: () => void;
  onProfileSaved: (profile: ResourceProfile) => void;
  onAbsenceAdded: (absence: ResourceAbsence) => void;
  onAbsenceRemoved: (id: string) => void;
  /** An edited leave period replaces the stored one. */
  onAbsenceUpdated: (absence: ResourceAbsence) => void;
}

const sameSkills = (a: string[], b: string[]) => a.length === b.length && a.every((s, i) => s === b[i]);

type Field = "role" | "capacity" | "skills" | "notes";
interface LeaveDraft {
  id: string | null;
  from: string;
  to: string;
  reason: string;
}

/**
 * What the heatmap cannot know about a person: their role, how many hours a day they really have,
 * the days they are away, their skills and a note.
 *
 * A window in the middle of the page, like the task detail, in two columns: the person on the left,
 * their leave on the right. It used to be a slide-over on the far edge of the screen, away from the
 * pencil that opened it, with a footer button that saved what Esc and × saved anyway.
 *
 * **Each field saves when it is finished** (leaving the box, Enter, a skill added or removed), through one
 * chain so two quick edits are two writes in order. A refusal puts the field back and says why. Only the
 * changed field is sent, so a profile saved long ago with a value that would not pass today (24 h a day)
 * can still have its role edited. Leave is its own small form with its own "Thêm" — a period is two dates
 * and a reason, never half of one. Closing writes anything still being typed first.
 */
export default function ResourceProfileDialog({
  person,
  defaultCapacityHours,
  skillSuggestions,
  summary,
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
  const [leave, setLeave] = useState<LeaveDraft | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const roleRef = useRef<HTMLInputElement>(null);

  // What the server last confirmed: a field is saved only when its draft differs from this.
  const saved = useRef({
    role: person.role ?? "",
    capacity: person.capacityHoursPerDay,
    skills: person.profile?.skills ?? [],
    notes: person.profile?.notes ?? "",
  });
  const chain = useRef<Promise<void>>(Promise.resolve());
  const inFlight = useRef(0);
  // The form as of the last render, for closing: a date typed a moment ago is in state by the time it is read.
  const leaveRef = useRef<LeaveDraft | null>(null);
  useEffect(() => {
    leaveRef.current = leave;
  });

  // Focus lands inside, and goes back to whatever opened the dialog when it closes.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    roleRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  /** Writes one field. Writes queue behind each other and each reads what was confirmed when its turn comes. */
  function saveField(field: Field, value: string | number | string[]) {
    inFlight.current += 1;
    setStatus("saving");
    setError(null);
    chain.current = chain.current.then(async () => {
      try {
        const patch =
          field === "capacity"
            ? { capacityHoursPerDay: value as number }
            : field === "skills"
              ? { skills: value as string[] }
              : { [field]: value as string };
        const profile = await api.saveResourceProfile(person.accountId, { displayName: person.displayName, ...patch });
        if (field === "capacity") saved.current.capacity = value as number;
        else if (field === "skills") saved.current.skills = value as string[];
        else saved.current[field] = value as string;
        onProfileSaved(profile);
      } catch (err) {
        setError((err as Error).message);
        // The box goes back to what the server holds, so what is on screen is never a lie.
        if (field === "role") setRole(saved.current.role);
        else if (field === "capacity") setCapacity(String(saved.current.capacity));
        else if (field === "skills") setSkills(saved.current.skills);
        else setNotes(saved.current.notes);
      } finally {
        inFlight.current -= 1;
        if (inFlight.current === 0) setStatus((s) => (s === "saving" ? "saved" : s));
      }
    });
  }

  const commitRole = () => {
    if (role.trim() !== saved.current.role) saveField("role", role.trim());
  };
  const commitNotes = () => {
    if (notes.trim() !== saved.current.notes) saveField("notes", notes.trim());
  };
  const commitCapacity = () => {
    const parsed = parseCapacity(capacity);
    if (!parsed.ok) {
      setError(parsed.message);
      setCapacity(String(saved.current.capacity));
      return;
    }
    if (parsed.hours !== saved.current.capacity) saveField("capacity", parsed.hours);
    else setCapacity(String(parsed.hours));
  };
  const changeSkills = (next: string[]) => {
    const clean = normalizeSkills(next);
    setSkills(clean);
    if (!sameSkills(clean, saved.current.skills)) saveField("skills", clean);
  };

  /** Adds or updates the period being typed. Returns whether it went through (closing waits on this). */
  async function submitLeave(): Promise<boolean> {
    const draft = leaveRef.current;
    if (!draft) return true;
    if (!draft.from || !draft.to) {
      setError("Kỳ nghỉ cần cả ngày bắt đầu và ngày kết thúc.");
      return false;
    }
    if (draft.to < draft.from) {
      setError("Ngày kết thúc kỳ nghỉ phải sau hoặc cùng ngày bắt đầu.");
      return false;
    }
    setError(null);
    setStatus("saving");
    try {
      const reason = draft.reason.trim() || null;
      if (draft.id) onAbsenceUpdated(await api.updateAbsence(draft.id, { from: draft.from, to: draft.to, reason }));
      else onAbsenceAdded(await api.addAbsence(person.accountId, draft.from, draft.to, reason));
      setLeave(null);
      setStatus("saved");
      return true;
    } catch (err) {
      setError((err as Error).message);
      setStatus("idle");
      return false;
    }
  }

  async function removeAbsence(id: string) {
    try {
      await api.deleteAbsence(id);
      if (leave?.id === id) setLeave(null);
      onAbsenceRemoved(id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /** Closing is finishing: the box under the cursor is committed, queued writes land, then it closes. A refusal keeps it open. */
  async function requestClose() {
    (document.activeElement as HTMLElement | null)?.blur?.();
    await new Promise((r) => setTimeout(r, 0));
    await chain.current;
    const pending = leaveRef.current;
    if (pending && (pending.from || pending.to) && !(await submitLeave())) return;
    onClose();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    // Escape first undoes what is half-typed in the box it is pressed in; only then does it close.
    const field = (e.target as HTMLElement).closest<HTMLElement>("[data-pf]")?.dataset.pf;
    if (field === "role" && role.trim() !== saved.current.role) setRole(saved.current.role);
    else if (field === "capacity" && capacity !== String(saved.current.capacity)) setCapacity(String(saved.current.capacity));
    else if (field === "notes" && notes.trim() !== saved.current.notes) setNotes(saved.current.notes);
    else if (field === "leave" && leave) setLeave(null);
    else return;
    e.stopPropagation();
  }

  const absences = [...person.absences].sort((a, b) => a.from.localeCompare(b.from));

  return (
    <div
      className="rv-profile-layer"
      onMouseDown={(e) => {
        // The dimmer around the window: pressing on it (not on the window) closes, like Esc.
        if (e.target === e.currentTarget) void requestClose();
      }}
    >
      <div
        className="rv-profile"
        role="dialog"
        aria-modal="true"
        aria-label={`Hồ sơ và kỳ nghỉ của ${person.displayName}`}
        onKeyDown={onKeyDown}
      >
        <div className="rv-profile-head">
          <Avatar name={person.displayName} avatarUrl={person.avatarUrl} className="rv-avatar rv-avatar-lg rv-avatar-empty" decorative />
          <div className="rv-profile-title">
            <b>{person.displayName}</b>
            <small>{summary}</small>
          </div>
          <span className="rv-profile-status" role="status" aria-live="polite">
            {status === "saving" ? "Đang lưu…" : status === "saved" ? "Đã lưu" : ""}
          </span>
          <button type="button" className="icon-btn" onClick={() => void requestClose()} aria-label="Đóng" title="Đóng (Esc)">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="rv-profile-body">
          <div className="rv-profile-col">
            <label className="field" data-pf="role">
              <span>Vai trò</span>
              <input
                ref={roleRef}
                value={role}
                placeholder="VD: Backend Developer"
                onChange={(e) => setRole(e.target.value)}
                onBlur={commitRole}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
            </label>
            <label className="field" data-pf="capacity">
              <span>Công suất (giờ/ngày)</span>
              <input
                type="number"
                min={0.5}
                max={MAX_CAPACITY_HOURS}
                step={0.5}
                value={capacity}
                placeholder={String(defaultCapacityHours)}
                onChange={(e) => setCapacity(e.target.value)}
                onBlur={commitCapacity}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
            </label>
            <label className="field rv-skills-field">
              <span>Kỹ năng</span>
              <SkillsInput value={skills} onChange={changeSkills} suggestions={skillSuggestions} />
            </label>
            <label className="field rv-notes-field" data-pf="notes">
              <span>Ghi chú</span>
              <textarea
                rows={3}
                value={notes}
                placeholder="VD: chỉ làm buổi sáng thứ 6"
                onChange={(e) => setNotes(e.target.value)}
                onBlur={commitNotes}
              />
            </label>
          </div>

          <div className="rv-profile-col rv-profile-leave">
            <div className="rv-profile-leave-head">
              <span>Kỳ nghỉ</span>
              {!leave && (
                <button type="button" className="text-btn" onClick={() => setLeave({ id: null, from: "", to: "", reason: "" })}>
                  + Thêm kỳ nghỉ
                </button>
              )}
            </div>

            {absences.length === 0 && !leave && <p className="rv-profile-empty">Chưa có kỳ nghỉ nào.</p>}
            {absences.length > 0 && (
              <ul className="rv-absences">
                {absences.map((a) => (
                  <li key={a.id} className={`rv-abs-row${leave?.id === a.id ? " is-editing" : ""}`}>
                    <span className="rv-abs-when">
                      {shortDate(a.from)}
                      {a.to !== a.from ? ` – ${shortDate(a.to)}` : ""}
                    </span>
                    <span className="rv-abs-reason">{a.reason ?? ""}</span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Sửa kỳ nghỉ"
                      title="Sửa"
                      onClick={() => setLeave({ id: a.id, from: a.from, to: a.to, reason: a.reason ?? "" })}
                    >
                      <Icon name="edit" size={13} />
                    </button>
                    <button type="button" className="icon-btn" aria-label="Xoá kỳ nghỉ" title="Xoá" onClick={() => void removeAbsence(a.id)}>
                      <Icon name="x" size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {leave && (
              <div className="rv-leave-form" data-pf="leave">
                <div className="field-row">
                  <label className="field">
                    <span>Từ</span>
                    <DateField value={leave.from} ariaLabel="Nghỉ từ" onChange={(iso) => setLeave((l) => l && { ...l, from: iso, to: l.to && l.to < iso ? iso : l.to })} />
                  </label>
                  <label className="field">
                    <span>Đến</span>
                    <DateField value={leave.to} ariaLabel="Nghỉ đến" base={leave.from || undefined} onChange={(iso) => setLeave((l) => l && { ...l, to: iso })} />
                  </label>
                </div>
                <label className="field">
                  <span>Lý do</span>
                  <input
                    value={leave.reason}
                    placeholder="Nghỉ phép, công tác..."
                    onChange={(e) => setLeave((l) => l && { ...l, reason: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void submitLeave();
                      }
                    }}
                  />
                </label>
                <div className="rv-leave-actions">
                  <button type="button" className="primary" onClick={() => void submitLeave()}>
                    {leave.id ? "Lưu kỳ nghỉ" : "Thêm"}
                  </button>
                  <button type="button" className="text-btn" onClick={() => setLeave(null)}>
                    Huỷ
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="rv-notice rv-notice-error rv-profile-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
