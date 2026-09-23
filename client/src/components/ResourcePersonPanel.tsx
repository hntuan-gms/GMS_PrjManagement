import { useMemo, useState } from "react";
import { api } from "../api";
import type { PersonLoad } from "../resourceAllocation";
import type { ResourceAbsence, ResourceProfile, Task } from "../types";

interface Props {
  person: PersonLoad;
  /** The heatmap's window. The grid below covers the same range, always by day. */
  dates: string[];
  today: string;
  defaultCapacityHours: number;
  onClose: () => void;
  onOpenEdit: (task: Task) => void;
  onProfileSaved: (profile: ResourceProfile) => void;
  onAbsenceAdded: (absence: ResourceAbsence) => void;
  onAbsenceRemoved: (id: string) => void;
}

function pct(ratio: number): string {
  return Number.isFinite(ratio) ? `${Math.round(ratio * 100)}%` : "—";
}

function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/**
 * One person, in detail: their capacity, their leave, and every task they hold
 * laid out over the same dates as the heatmap above.
 *
 * Always by day, even when the heatmap has collapsed to weeks: "why is this
 * person red" is a question about which bars pile up on which day, and a week
 * column cannot answer it. The `Tải theo ngày` strip at the top of the grid is
 * the same DayLoad array the heatmap cell was coloured from, so the day-level
 * answer is directly under the week-level question.
 */
export default function ResourcePersonPanel({
  person,
  dates,
  today,
  defaultCapacityHours,
  onClose,
  onOpenEdit,
  onProfileSaved,
  onAbsenceAdded,
  onAbsenceRemoved,
}: Props) {
  const [role, setRole] = useState(person.role ?? "");
  const [capacity, setCapacity] = useState(String(person.capacityHoursPerDay));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [absFrom, setAbsFrom] = useState("");
  const [absTo, setAbsTo] = useState("");
  const [absReason, setAbsReason] = useState("");

  const dateIndex = useMemo(() => new Map(dates.map((d, i) => [d, i])), [dates]);
  const conflictIds = useMemo(
    () => new Set(person.overlaps.flatMap((o) => [o.aId, o.bId])),
    [person.overlaps]
  );

  // Consecutive days off become one shaded band rather than one div per day:
  // a 120-day window with weekends is ~35 bands instead of 120 elements, and
  // the panel re-renders on every Gantt drag.
  const offBands = useMemo(() => {
    const bands: Array<{ start: number; length: number; reason: "weekend" | "absence" }> = [];
    person.days.forEach((day, i) => {
      if (!day.offReason) return;
      const last = bands[bands.length - 1];
      if (last && last.start + last.length === i && last.reason === day.offReason) last.length += 1;
      else bands.push({ start: i, length: 1, reason: day.offReason });
    });
    return bands;
  }, [person.days]);

  /** Tasks clipped to the visible window, with their column offsets. */
  const bars = useMemo(() => {
    const total = dates.length;
    const first = dates[0];
    const last = dates[total - 1];
    return person.tasks
      .map((task) => {
        const start = task.startDate!;
        const end = task.dueDate && task.dueDate >= start ? task.dueDate : start;
        if (end < first || start > last) return null;
        const from = dateIndex.get(start < first ? first : start)!;
        const to = dateIndex.get(end > last ? last : end)!;
        return {
          task,
          from,
          length: to - from + 1,
          clippedLeft: start < first,
          clippedRight: end > last,
        };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);
  }, [person.tasks, dates, dateIndex]);

  const outsideWindow = person.tasks.length - bars.length;
  const style = { "--cols": dates.length } as React.CSSProperties;

  async function saveProfile() {
    const hours = Number(capacity);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      setError("Công suất phải từ 0 đến 24 giờ mỗi ngày.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveResourceProfile(person.accountId, {
        displayName: person.displayName,
        role: role.trim(),
        capacityHoursPerDay: hours,
      });
      onProfileSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function addAbsence() {
    if (!absFrom || !absTo) {
      setError("Chọn ngày bắt đầu và kết thúc kỳ nghỉ.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await api.addAbsence(person.accountId, absFrom, absTo, absReason.trim() || null);
      onAbsenceAdded(saved);
      setAbsFrom("");
      setAbsTo("");
      setAbsReason("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function removeAbsence(id: string) {
    try {
      await api.deleteAbsence(id);
      onAbsenceRemoved(id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="rv-panel">
      <div className="rv-panel-head">
        <div className="rv-panel-title">
          {person.avatarUrl ? (
            <img src={person.avatarUrl} alt="" className="rv-avatar rv-avatar-lg" />
          ) : (
            <span className="rv-avatar rv-avatar-lg rv-avatar-empty">
              {person.displayName.slice(0, 1)}
            </span>
          )}
          <div>
            <b>{person.displayName}</b>
            <small>
              {person.allocatedHours}h đã giao / {person.capacityHours}h khả dụng ·{" "}
              {pct(person.utilisation)} hiệu suất
              {person.overloadedDays > 0 && ` · ${person.overloadedDays} ngày quá tải`}
            </small>
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Đóng">
          ✕
        </button>
      </div>

      <div className="rv-panel-form">
        <label>
          Vai trò
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="VD: Backend Developer"
          />
        </label>
        <label>
          Công suất (giờ/ngày)
          <input
            type="number"
            min={1}
            max={24}
            step={0.5}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </label>
        <button className="btn-primary" onClick={saveProfile} disabled={saving}>
          Lưu
        </button>
        {!person.profile && (
          <span className="rv-hint">Đang dùng mặc định {defaultCapacityHours}h/ngày.</span>
        )}

        <span className="rv-form-sep" />

        <label>
          Nghỉ từ
          <input type="date" value={absFrom} onChange={(e) => setAbsFrom(e.target.value)} />
        </label>
        <label>
          Đến
          <input type="date" value={absTo} onChange={(e) => setAbsTo(e.target.value)} />
        </label>
        <label>
          Lý do
          <input
            value={absReason}
            onChange={(e) => setAbsReason(e.target.value)}
            placeholder="Nghỉ phép, công tác..."
          />
        </label>
        <button onClick={addAbsence} disabled={saving}>
          Thêm kỳ nghỉ
        </button>
      </div>

      {error && <div className="rv-notice rv-notice-error">{error}</div>}

      {person.absences.length > 0 && (
        <div className="rv-absences">
          {person.absences.map((a) => (
            <span key={a.id} className="rv-abs-chip">
              {shortDate(a.from)} – {shortDate(a.to)}
              {a.reason ? ` · ${a.reason}` : ""}
              <button onClick={() => removeAbsence(a.id)} aria-label="Xoá kỳ nghỉ">
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {person.overlaps.length > 0 && (
        <div className="rv-conflicts">
          <strong>⚠ {person.overlaps.length} cặp công việc chồng lịch:</strong>{" "}
          {person.overlaps.slice(0, 6).map((o, i) => (
            <span key={i} className="rv-conflict-pair">
              {o.aId} ↔ {o.bId} ({shortDate(o.from)}–{shortDate(o.to)})
            </span>
          ))}
          {person.overlaps.length > 6 && <span> +{person.overlaps.length - 6} cặp nữa</span>}
        </div>
      )}

      <div className="rv-tl-scroll">
        <div className="rv-tl" style={style}>
          <div className="rv-tl-row rv-tl-head">
            <div className="rv-tl-name">Công việc</div>
            <div className="rv-tl-track">
              {dates.map((d) => (
                <span key={d} className={`rv-tl-tick ${d === today ? "is-today" : ""}`}>
                  {d.slice(8, 10)}
                </span>
              ))}
            </div>
          </div>

          <div className="rv-tl-row rv-tl-loadrow">
            <div className="rv-tl-name">Tải theo ngày</div>
            <div className="rv-tl-track">
              {person.days.map((d) => (
                <span
                  key={d.date}
                  className={`rv-tl-load band-${d.band}`}
                  title={`${d.date} · ${d.allocatedHours}h / ${d.capacityHours}h (${pct(d.ratio)})`}
                />
              ))}
            </div>
          </div>

          {bars.length === 0 ? (
            <div className="rv-tl-empty">Không có công việc nào trong khoảng thời gian này.</div>
          ) : (
            bars.map(({ task, from, length, clippedLeft, clippedRight }) => (
              <div
                key={task.id}
                className="rv-tl-row rv-tl-taskrow"
                onClick={() => onOpenEdit(task)}
                title={`${task.id} · ${task.summary}`}
              >
                <div className="rv-tl-name">
                  {conflictIds.has(task.id) && <span className="rv-warn">⚠</span>}
                  <span className="rv-tl-key">{task.id}</span>
                  <span className="rv-tl-summary">{task.summary}</span>
                </div>
                <div className="rv-tl-track">
                  {/* Shading sits inside every track rather than once behind the
                      grid: the track is the only element whose width is exactly
                      the date axis, so the bands stay aligned when it scrolls. */}
                  {offBands.map((b) => (
                    <span
                      key={b.start}
                      className={`rv-tl-off rv-tl-off-${b.reason}`}
                      style={{
                        left: `${(b.start / dates.length) * 100}%`,
                        width: `${(b.length / dates.length) * 100}%`,
                      }}
                    />
                  ))}
                  <span
                    className={`rv-tl-bar ${conflictIds.has(task.id) ? "is-conflict" : ""} ${
                      clippedLeft ? "clip-l" : ""
                    } ${clippedRight ? "clip-r" : ""}`}
                    style={{
                      left: `${(from / dates.length) * 100}%`,
                      width: `${(length / dates.length) * 100}%`,
                    }}
                  >
                    {task.percentComplete > 0 && (
                      <span
                        className="rv-tl-progress"
                        style={{ width: `${task.percentComplete}%` }}
                      />
                    )}
                    <span className="rv-tl-bar-label">
                      {task.estimateHours != null ? `${task.estimateHours}h` : `${task.durationDays}n`}
                    </span>
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {outsideWindow > 0 && (
        <div className="rv-hint rv-hint-block">
          {outsideWindow} công việc nằm ngoài khoảng đang xem.
        </div>
      )}
    </div>
  );
}
