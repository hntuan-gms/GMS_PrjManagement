import { useMemo } from "react";
import { aggregateMonths, aggregateWeeks, type Granularity, type PersonLoad } from "../resourceAllocation";
import { pct, placeBar, shortDate, taskBarDates, type ColumnSpan } from "../resourceColumns";
import type { Task } from "../types";
import { Icon } from "./Icons";

interface Props {
  person: PersonLoad;
  granularity: Granularity;
  today: string;
  /** The heatmap's columns, shared by the person's row and every task row under it. */
  spans: ColumnSpan[];
  expanded: boolean;
  onToggle: () => void;
  onOpenProfile: () => void;
  onOpenEdit: (task: Task) => void;
  /** Who a task can be handed to from the row's "Chuyển…" picker. */
  members: Array<{ accountId: string; displayName: string }>;
  onAssign: (taskId: string, accountId: string | null) => void;
  /** Dragging a task row out of here is how work is taken off this person. */
  onDragTask: (task: Task) => void;
  droppable: boolean;
  isDropTarget: boolean;
  onDragOverPerson: () => void;
  onDropOnPerson: () => void;
}

/**
 * One person in the heatmap: their load row and, when opened, the tasks that make it up.
 *
 * The tasks open *inside* the same grid, on the same date columns, instead of in a panel below
 * the table: "why is this person red on the 12th" is answered by looking straight down from the
 * red cell at the bars that cover that column. The whole block — row and opened tasks — is one
 * drop target, so a task can be dropped anywhere on a person to give it to them.
 */
export default function PersonBlock({
  person,
  granularity,
  today,
  spans,
  expanded,
  onToggle,
  onOpenProfile,
  onOpenEdit,
  members,
  onAssign,
  onDragTask,
  droppable,
  isDropTarget,
  onDragOverPerson,
  onDropOnPerson,
}: Props) {
  const cells =
    granularity !== "day"
      ? (granularity === "month" ? aggregateMonths(person.days) : aggregateWeeks(person.days)).map((w) => ({
          key: w.start,
          band: w.band,
          ratio: w.ratio,
          allocated: w.allocatedHours,
          capacity: w.capacityHours,
          label: `${w.start} → ${w.end}`,
          taskIds: w.taskIds,
          isToday: today >= w.start && today <= w.end,
        }))
      : person.days.map((d) => ({
          key: d.date,
          band: d.band,
          ratio: d.ratio,
          allocated: d.allocatedHours,
          capacity: d.capacityHours,
          label: d.date,
          taskIds: d.taskIds,
          isToday: d.date === today,
        }));

  const bodyId = `rv-expand-${person.accountId}`;

  return (
    <div
      className={`rv-block${expanded ? " is-expanded" : ""}${droppable ? " is-droppable" : ""}${isDropTarget ? " is-drop-target" : ""}`}
      // preventDefault on dragover is what marks an element as a drop target at
      // all; without it the browser refuses the drop and fires nothing.
      onDragOver={(e) => {
        if (!droppable) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOverPerson();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropOnPerson();
      }}
    >
      <div className={`rv-row rv-row-person${expanded ? " is-selected" : ""}`} onClick={onToggle}>
        <div className="rv-name">
          {/* The row's own click does the toggling: a button's Enter/Space comes through as a
              click that bubbles to it, so the keyboard needs no handler of its own. */}
          <button type="button" className="rv-person-toggle" aria-expanded={expanded} aria-controls={bodyId}>
            <Icon name="chevronRight" size={14} className="rv-person-caret" />
            {person.avatarUrl ? (
              <img src={person.avatarUrl} alt="" className="rv-avatar" />
            ) : (
              <span className="rv-avatar rv-avatar-empty">{person.displayName.slice(0, 1)}</span>
            )}
            <span className="rv-person-text">
              <b>{person.displayName}</b>
              <small>
                {person.role ? `${person.role} · ` : ""}
                {person.capacityHoursPerDay}h/ngày · {person.tasks.length} việc
              </small>
            </span>
          </button>
          {person.overloadedDays > 0 && (
            <span className="rv-badge-over" title={`${person.overloadedDays} ngày quá tải`}>
              {person.overloadedDays}
            </span>
          )}
          <button
            type="button"
            className="rv-profile-btn"
            aria-label={`Hồ sơ và kỳ nghỉ của ${person.displayName}`}
            title="Hồ sơ & Kỳ nghỉ"
            onClick={(e) => {
              e.stopPropagation();
              onOpenProfile();
            }}
          >
            <Icon name="edit" size={14} />
          </button>
        </div>
        {cells.map((c) => (
          <div
            key={c.key}
            className={`rv-cell band-${c.band} ${c.isToday ? "is-today" : ""}`}
            title={`${c.label} · ${c.allocated}h / ${c.capacity}h (${pct(c.ratio)})${
              c.taskIds.length > 0 ? `\n${[...new Set(c.taskIds)].join(", ")}` : ""
            }`}
          >
            {granularity !== "day" && c.capacity > 0 ? pct(c.ratio) : ""}
          </div>
        ))}
      </div>

      {expanded && (
        <PersonTasks
          id={bodyId}
          person={person}
          granularity={granularity}
          today={today}
          spans={spans}
          onOpenProfile={onOpenProfile}
          onOpenEdit={onOpenEdit}
          members={members}
          onAssign={onAssign}
          onDragTask={onDragTask}
        />
      )}
    </div>
  );
}

function PersonTasks({
  id,
  person,
  granularity,
  today,
  spans,
  onOpenProfile,
  onOpenEdit,
  members,
  onAssign,
  onDragTask,
}: Pick<Props, "person" | "granularity" | "today" | "spans" | "onOpenProfile" | "onOpenEdit" | "members" | "onAssign" | "onDragTask"> & {
  id: string;
}) {
  const conflictIds = useMemo(() => new Set(person.overlaps.flatMap((o) => [o.aId, o.bId])), [person.overlaps]);

  // Consecutive days off become one shaded band rather than one element per day: a 120-day
  // window with weekends is ~35 bands instead of 120. Only drawn by day — a week or month
  // column is not a day off.
  const offBands = useMemo(() => {
    if (granularity !== "day") return [];
    const bands: Array<{ start: number; length: number; reason: "weekend" | "absence" }> = [];
    person.days.forEach((day, i) => {
      if (!day.offReason) return;
      const last = bands[bands.length - 1];
      if (last && last.start + last.length === i && last.reason === day.offReason) last.length += 1;
      else bands.push({ start: i, length: 1, reason: day.offReason });
    });
    return bands;
  }, [person.days, granularity]);

  const todayMark = useMemo(() => placeBar(spans, today, today), [spans, today]);

  /** Tasks clipped to the visible window, positioned on the heatmap's own columns. */
  const bars = useMemo(
    () =>
      person.tasks.flatMap((task) => {
        const dates = taskBarDates(task);
        const place = dates ? placeBar(spans, dates.start, dates.end) : null;
        return place ? [{ task, place }] : [];
      }),
    [person.tasks, spans]
  );
  const outsideWindow = person.tasks.length - bars.length;

  return (
    <div className="rv-expand" id={id}>
      <div className="rv-expand-head">
        <div className="rv-meta">
          <span>
            {person.allocatedHours}h đã giao / {person.capacityHours}h khả dụng · {pct(person.utilisation)} hiệu suất
          </span>
          <button type="button" className="rv-profile-text" onClick={onOpenProfile}>
            <Icon name="edit" size={13} />
            Hồ sơ &amp; Kỳ nghỉ
          </button>
        </div>
        {person.overlaps.length > 0 && (
          <div className="rv-banner" role="status">
            <Icon name="alert" size={14} className="rv-banner-icon" />
            <strong>{person.overlaps.length} cặp công việc chồng lịch:</strong>
            {person.overlaps.slice(0, 6).map((o, i) => (
              <span key={i} className="rv-conflict-pair" title={`Trùng ${o.from} → ${o.to}`}>
                {o.aId} ↔ {o.bId} ({shortDate(o.from)}–{shortDate(o.to)})
              </span>
            ))}
            {person.overlaps.length > 6 && <span>+{person.overlaps.length - 6} cặp nữa</span>}
          </div>
        )}
      </div>

      {bars.length === 0 ? (
        <div className="rv-tl-empty">Không có công việc nào trong khoảng thời gian này.</div>
      ) : (
        bars.map(({ task, place }) => {
          const conflict = conflictIds.has(task.id);
          return (
            <div
              key={task.id}
              className={`rv-row rv-task-row${conflict ? " is-conflict" : ""}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", task.id);
                onDragTask(task);
              }}
              onClick={() => onOpenEdit(task)}
              title={`${task.id} · ${task.summary}\nKéo sang người khác để chuyển, kéo xuống “bỏ gán” để bỏ gán`}
            >
              <div className="rv-name rv-task-name">
                {conflict && <Icon name="alert" size={13} className="rv-warn" />}
                <span className="rv-tl-key">{task.id}</span>
                <span className="rv-tl-summary">{task.summary}</span>
                <span className="rv-task-side">
                  <span className={`wbs-status is-${task.statusCategory} rv-tl-status`}>{task.statusName}</span>
                  <select
                    className="rv-assign-select"
                    value=""
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v) onAssign(task.id, v === "__none__" ? null : v);
                    }}
                    aria-label={`Chuyển ${task.id} cho người khác`}
                  >
                    <option value="">Chuyển…</option>
                    <option value="__none__">— Bỏ gán —</option>
                    {members
                      .filter((m) => m.accountId !== person.accountId)
                      .map((m) => (
                        <option key={m.accountId} value={m.accountId}>
                          {m.displayName}
                        </option>
                      ))}
                  </select>
                </span>
              </div>
              <div className="rv-task-track">
                {/* Shading sits inside every track rather than once behind the grid: the track is
                    the only element whose width is exactly the date axis, so the bands stay
                    aligned when the grid scrolls sideways. */}
                {offBands.map((b) => (
                  <span
                    key={b.start}
                    className={`rv-tl-off rv-tl-off-${b.reason}`}
                    style={{ left: `calc(var(--rv-cell) * ${b.start})`, width: `calc(var(--rv-cell) * ${b.length})` }}
                  />
                ))}
                {todayMark && (
                  <span
                    className="rv-task-today"
                    style={{ left: `calc(var(--rv-cell) * ${todayMark.left})`, width: `calc(var(--rv-cell) * ${todayMark.width})` }}
                  />
                )}
                <span
                  className={`rv-tl-bar${conflict ? " is-conflict" : ""}${place.clippedLeft ? " clip-l" : ""}${place.clippedRight ? " clip-r" : ""}`}
                  style={{ left: `calc(var(--rv-cell) * ${place.left})`, width: `calc(var(--rv-cell) * ${place.width})` }}
                >
                  {task.percentComplete > 0 && <span className="rv-tl-progress" style={{ width: `${task.percentComplete}%` }} />}
                  <span className="rv-tl-bar-label">
                    {task.estimateHours != null ? `${task.estimateHours}h` : `${task.durationDays}n`}
                  </span>
                </span>
              </div>
            </div>
          );
        })
      )}

      {outsideWindow > 0 && <div className="rv-expand-note">{outsideWindow} công việc nằm ngoài khoảng đang xem.</div>}
    </div>
  );
}
