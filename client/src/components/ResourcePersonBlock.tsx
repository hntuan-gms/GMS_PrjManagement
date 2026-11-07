import { startTaskDrag } from "../taskDrag";
import { useMemo, useState } from "react";
import {
  aggregateMonths,
  aggregateWeeks,
  overloadedDaysIn,
  loadInRange,
  type Granularity,
  type PersonLoad,
  type ResourceLoad,
} from "../resourceAllocation";
import { pct, placeBar, shortDate, taskBarDates, type ColumnSpan } from "../resourceColumns";
import { cellTooltip } from "../resourceTimeline";
import type { JiraUser, Task } from "../types";
import type { WorkCalendar } from "../workCalendar";
import { Icon } from "./Icons";
import TodayInCell from "./TodayInCell";
import Avatar from "./Avatar";
import PersonPicker from "./PersonPicker";
import StatusGlyph from "./StatusGlyph";

/** One unit on the bars: hours. No Jira estimate means days × the person's hours a day. */
function taskBarHours(task: Task, capacityPerDay: number): number {
  const h = task.estimateHours ?? task.durationDays * capacityPerDay;
  return Math.round(h * 10) / 10;
}

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
  /** Who a task can be handed to from the row's "Chuyển…" picker, with the load that says who is free. */
  people: JiraUser[];
  load: Pick<ResourceLoad, "people">;
  calendar: WorkCalendar;
  onAssign: (taskId: string, accountId: string | null) => void;
  /** The two weeks the red badge counts, and the window the opened summary is measured over. */
  overloadWindow: { from: string; to: string };
  summary: { from: string; to: string; label: string };
  /** The red badge: open this person and bring their first over-capacity day into view. */
  onJumpOverload: () => void;
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
  people,
  load,
  calendar,
  onAssign,
  overloadWindow,
  summary,
  onJumpOverload,
  onDragTask,
  droppable,
  isDropTarget,
  onDragOverPerson,
  onDropOnPerson,
}: Props) {
  // The red number is what to act on now: over-capacity days in the next two weeks. An 85-day project-wide
  // count made every busy person look the same; that figure stays in the tooltip.
  const soon = overloadedDaysIn(person.days, overloadWindow.from, overloadWindow.to);
  const cells =
    granularity !== "day"
      ? (granularity === "month" ? aggregateMonths(person.days) : aggregateWeeks(person.days)).map((w) => ({
          key: w.start,
          band: w.band,
          ratio: w.ratio,
          allocated: w.allocatedHours,
          capacity: w.capacityHours,
          start: w.start,
          end: w.end,
          taskIds: w.taskIds,
          isToday: today >= w.start && today <= w.end,
        }))
      : person.days.map((d) => ({
          key: d.date,
          band: d.band,
          ratio: d.ratio,
          allocated: d.allocatedHours,
          capacity: d.capacityHours,
          start: d.date,
          end: d.date,
          taskIds: d.taskIds,
          isToday: d.date === today,
          holiday: d.offReason === "holiday" ? d.offLabel || "Ngày lễ" : undefined,
        }));

  const bodyId = `rv-expand-${person.accountId}`;

  return (
    <div
      data-person={person.accountId}
      className={`rv-block${expanded ? " is-expanded" : ""}${soon > 0 ? " is-overloaded" : ""}${droppable ? " is-droppable" : ""}${isDropTarget ? " is-drop-target" : ""}`}
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
            <Avatar name={person.displayName} avatarUrl={person.avatarUrl} className="rv-avatar rv-avatar-empty" decorative />
            <span className="rv-person-text">
              <b>{person.displayName}</b>
              <small>
                {person.role ? `${person.role} · ` : ""}
                {/* More than 12 h a day is almost certainly a typo in the profile, not a person. */}
                <span className={person.capacityHoursPerDay > 12 ? "rv-cap-odd" : undefined} title={person.capacityHoursPerDay > 12 ? "Kiểm tra lại số giờ/ngày trong hồ sơ" : undefined}>
                  {person.capacityHoursPerDay}h/ngày
                </span>{" "}
                {person.tasks.length > 0 && <>· {person.tasks.length} việc</>}
              </small>
            </span>
          </button>
          {person.overloadedDays > 0 && (
            <button
              type="button"
              className={`rv-badge-over${soon > 0 ? "" : " is-later"}`}
              title={`${person.overloadedDays} ngày quá tải trong cả khoảng đang xem${soon > 0 ? `, ${soon} ngày trong 2 tuần tới` : ", chưa có ngày nào trong 2 tuần tới"}. Bấm để xem.`}
              aria-label={`${person.displayName}: ${person.overloadedDays} ngày quá tải`}
              onClick={(e) => {
                e.stopPropagation();
                onJumpOverload();
              }}
            >
              {soon > 0 ? soon : person.overloadedDays} ngày
            </button>
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
            className={`rv-cell band-${c.band} ${c.isToday ? "is-today" : ""}${c.isToday && granularity !== "day" ? " is-aggregated" : ""}`}
            title={cellTooltip(c)}
          >
            {c.isToday && granularity !== "day" && <TodayInCell start={c.start} end={c.end} today={today} />}
            {/* A skyline, not a number: the bar's height is the load, an empty cell is a free one,
                and only work above capacity turns red (plan §6.7). The figure is in the tooltip. */}
            {c.capacity > 0 && c.ratio > 0 && (
              <span className="rv-sky" style={{ "--load": Math.min(1, c.ratio) } as React.CSSProperties} aria-hidden="true" />
            )}
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
          people={people}
          load={load}
          calendar={calendar}
          onAssign={onAssign}
          summary={summary}
          overloaded={soon > 0}
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
  people,
  load,
  calendar,
  onAssign,
  summary,
  overloaded,
  onDragTask,
}: Pick<Props, "person" | "granularity" | "today" | "spans" | "onOpenProfile" | "onOpenEdit" | "people" | "load" | "calendar" | "onAssign" | "summary" | "onDragTask"> & {
  id: string;
  /** Overloaded in the next two weeks: "Chuyển…" is shown on every row, not only the hovered one. */
  overloaded: boolean;
}) {
  const [picker, setPicker] = useState<{ task: Task; rect: DOMRect } | null>(null);
  const inSummary = useMemo(() => loadInRange(person.days, summary.from, summary.to), [person.days, summary.from, summary.to]);
  const conflictIds = useMemo(() => new Set(person.overlaps.flatMap((o) => [o.aId, o.bId])), [person.overlaps]);

  // Consecutive days off become one shaded band rather than one element per day: a 120-day
  // window with weekends is ~35 bands instead of 120. Only drawn by day — a week or month
  // column is not a day off.
  const offBands = useMemo(() => {
    if (granularity !== "day") return [];
    const bands: Array<{ start: number; length: number; reason: "weekend" | "holiday" | "absence" }> = [];
    person.days.forEach((day, i) => {
      if (!day.offReason) return;
      const last = bands[bands.length - 1];
      if (last && last.start + last.length === i && last.reason === day.offReason) last.length += 1;
      else bands.push({ start: i, length: 1, reason: day.offReason });
    });
    return bands;
  }, [person.days, granularity]);

  const todayMark = useMemo(() => placeBar(spans, today, today), [spans, today]);
  // Positions are shares of the track, not pixels: the columns stretch to fill the table when there are few
  // of them, and a bar placed in pixels would stay put while the date columns above it moved.
  const cols = spans.length;
  const share = (n: number) => `${(n / cols) * 100}%`;

  /**
   * Every task of the person, positioned on the heatmap's own columns. A task outside the columns
   * on screen still gets its row — with an arrow at the edge it lies beyond — so opening someone
   * always lists all their work, however the time axis is cut.
   */
  const bars = useMemo(
    () =>
      person.tasks.map((task) => {
        const dates = taskBarDates(task);
        const place = dates ? placeBar(spans, dates.start, dates.end) : null;
        const beyond = !place && dates && spans.length > 0 ? (dates.end < spans[0].start ? "before" : "after") : null;
        return { task, dates, place, beyond } as const;
      }),
    [person.tasks, spans]
  );

  return (
    <div className="rv-expand" id={id}>
      <div className="rv-expand-head">
        <div className="rv-meta">
          <span>
            {summary.label}: {inSummary.allocatedHours}h / {inSummary.capacityHours}h · {pct(inSummary.utilisation)}
          </span>
          <button type="button" className="rv-profile-text" onClick={onOpenProfile}>
            <Icon name="edit" size={13} />
            Hồ sơ &amp; Kỳ nghỉ
          </button>
        </div>
        {person.overlaps.length > 0 && (
          <div className="rv-banner" role="status">
            <Icon name="alert" size={14} className="rv-banner-icon" />
            <strong>{person.overlaps.length} cặp việc chồng lịch:</strong>
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
        <div className="rv-tl-empty">Chưa có việc nào được giao.</div>
      ) : (
        bars.map(({ task, dates, place, beyond }) => {
          const conflict = conflictIds.has(task.id);
          return (
            <div
              key={task.id}
              className={`rv-row rv-task-row${conflict ? " is-conflict" : ""}`}
              draggable
              onDragStart={(e) => {
                startTaskDrag(e, [task.id], task.summary);
                onDragTask(task);
              }}
              onClick={() => onOpenEdit(task)}
              title={`${task.id} · ${task.summary} (${task.statusName})\nKéo sang người khác để chuyển, kéo xuống “bỏ gán” để bỏ gán`}
            >
              <div className="rv-name rv-task-name">
                {conflict && <Icon name="alert" size={13} className="rv-warn" />}
                <StatusGlyph category={task.statusCategory} percent={task.percentComplete} name={task.statusName} size={13} title={task.statusName} />
                <span className="rv-tl-key">{task.id}</span>
                <span className="rv-tl-summary">{task.summary}</span>
                <button
                  type="button"
                  className={`rv-assign-btn${overloaded ? " is-shown" : ""}`}
                  aria-label={`Chuyển ${task.id} cho người khác`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPicker({ task, rect: e.currentTarget.getBoundingClientRect() });
                  }}
                >
                  Chuyển…
                </button>
              </div>
              <div className="rv-task-track">
                {/* Shading sits inside every track rather than once behind the grid: the track is
                    the only element whose width is exactly the date axis, so the bands stay
                    aligned when the grid scrolls sideways. */}
                {offBands.map((b) => (
                  <span
                    key={b.start}
                    className={`rv-tl-off rv-tl-off-${b.reason}`}
                    style={{ left: share(b.start), width: share(b.length) }}
                  />
                ))}
                {todayMark && (
                  <span
                    className="rv-task-today"
                    style={{ left: share(todayMark.left), width: share(todayMark.width) }}
                  />
                )}
                {place ? (
                  <span
                    className={`rv-tl-bar${conflict ? " is-conflict" : ""}${place.clippedLeft ? " clip-l" : ""}${place.clippedRight ? " clip-r" : ""}`}
                    style={{ left: share(place.left), width: share(place.width) }}
                  >
                    {task.percentComplete > 0 && <span className="rv-tl-progress" style={{ width: `${task.percentComplete}%` }} />}
                    <span
                      className="rv-tl-bar-label"
                      title={task.estimateHours != null ? undefined : `ước tính: ${task.durationDays} ngày × ${person.capacityHoursPerDay}h/ngày`}
                    >
                      {taskBarHours(task, person.capacityHoursPerDay)}h
                    </span>
                  </span>
                ) : (
                  beyond &&
                  dates && (
                    <span
                      className={`rv-tl-beyond is-${beyond}`}
                      title={`${shortDate(dates.start)} → ${shortDate(dates.end)}: nằm ${beyond === "before" ? "trước" : "sau"} khoảng đang xem`}
                    >
                      {beyond === "before" ? `◂ ${shortDate(dates.start)}–${shortDate(dates.end)}` : `${shortDate(dates.start)}–${shortDate(dates.end)} ▸`}
                    </span>
                  )
                )}
              </div>
            </div>
          );
        })
      )}
      {picker && (
        <PersonPicker
          anchor={picker.rect}
          people={people}
          task={picker.task}
          load={load}
          calendar={calendar}
          currentAccountId={person.accountId}
          placeholder="Chuyển cho"
          onPick={(accountId) => {
            const t = picker.task;
            setPicker(null);
            onAssign(t.id, accountId);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
