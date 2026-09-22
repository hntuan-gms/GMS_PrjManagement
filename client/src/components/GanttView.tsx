import { Gantt, ViewMode, type Task as GanttTaskT } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { orderByWbs, resolveRanges, toGanttTasks } from "../ganttMapping";
import type { Task } from "../types";
import IssueTypeIcon from "./IssueTypeIcon";

const ROW_HEIGHT = 42;
const HEADER_HEIGHT = 46;
// Each WBS level steps in by this much; a fixed-width expander slot (reserved even
// on leaf rows, see .wbs-expander-slot) keeps every level's icon aligned under its
// parent's text rather than under the parent's own expander arrow.
const INDENT_STEP = 28;
const MIN_LIST_WIDTH = 220;
const MIN_CHART_WIDTH = 240;
// gantt-task-react always renders its own horizontal scrollbar strip under the
// chart rows; reserve room for it so the fixed-height layout below doesn't clip it.
const SCROLLBAR_RESERVE = 24;

interface Props {
  tasks: Task[];
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenEdit: (task: Task) => void;
  onScheduleChange: (id: string, startDate: string, durationDays: number) => void;
  onProgressChange: (id: string, percentComplete: number) => void;
}

function toIso(d: Date): string {
  // gantt-task-react hands back local-midnight Date objects for the dragged bar's
  // calendar day; read them with local getters instead of toISOString() (UTC),
  // which would roll the date back a day in timezones ahead of UTC (e.g. Vietnam).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function GanttView({
  tasks,
  collapsed,
  onToggleCollapse,
  selectedId,
  onSelect,
  onOpenEdit,
  onScheduleChange,
  onProgressChange,
}: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Week);

  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 });
  const [listWidthOverride, setListWidthOverride] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setBodySize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Defaults to the middle of the visible Gantt area; a manual drag (listWidthOverride)
  // always wins over that default once set.
  const defaultListWidth = bodySize.width > 0 ? Math.round(bodySize.width / 2) : 320;
  const maxListWidth = Math.max(MIN_LIST_WIDTH, bodySize.width - MIN_CHART_WIDTH);
  const listWidth = Math.min(maxListWidth, Math.max(MIN_LIST_WIDTH, listWidthOverride ?? defaultListWidth));
  const ganttHeight = Math.max(ROW_HEIGHT, bodySize.height - HEADER_HEIGHT - SCROLLBAR_RESERVE);

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = listWidth;
    setDragging(true);
    function onMove(ev: MouseEvent) {
      setListWidthOverride(startWidth + (ev.clientX - startX));
    }
    function onUp() {
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const ordered = useMemo(() => orderByWbs(tasks), [tasks]);
  const ranges = useMemo(() => resolveRanges(ordered), [ordered]);
  const visible = useMemo(() => {
    const hiddenAncestors = new Set<string>();
    const result = [] as typeof ordered;
    for (const item of ordered) {
      if (item.task.wbsParentId && hiddenAncestors.has(item.task.wbsParentId)) {
        hiddenAncestors.add(item.task.id);
        continue;
      }
      result.push(item);
      if (collapsed.has(item.task.id)) hiddenAncestors.add(item.task.id);
    }
    return result;
  }, [ordered, collapsed]);

  // Rows actually rendered: gantt-task-react positions its chart bars purely by
  // index within the array passed to <Gantt>, so the custom WBS table below must
  // render this exact same filtered list, in this exact order, or the two panes
  // drift out of row alignment (a task without a resolvable date can't get a bar).
  const rows = useMemo(() => visible.filter((v) => ranges.has(v.task.id)), [visible, ranges]);
  const ganttTasks = useMemo(() => toGanttTasks(rows, ranges), [rows, ranges]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        Chưa có task nào có ngày bắt đầu để hiển thị trên Gantt. Hãy tạo task hoặc đặt
        ngày bắt đầu cho task hiện có.
      </div>
    );
  }

  // gantt-task-react does NOT size its TaskList wrapper to listCellWidth itself —
  // it only forwards that value as a `rowWidth` prop and expects the consumer's own
  // TaskListHeader/TaskListTable to apply it. Without an explicit width here, these
  // roots stay at their shrink-to-fit content width, so dragging the divider moves
  // only the handle (which follows `listWidth` directly) while the WBS pane itself
  // never actually resizes.
  const TaskListHeader = () => (
    <div className="wbs-header" style={{ height: HEADER_HEIGHT, width: listWidth }}>
      <div className="wbs-col wbs-col-key">Mã</div>
      <div className="wbs-col wbs-col-name">Tên công việc</div>
      <div className="wbs-col wbs-col-assignee">Phụ trách</div>
      <div className="wbs-col wbs-col-pct">%</div>
    </div>
  );

  const TaskListTable = () => (
    <div style={{ width: listWidth }}>
      {rows.map(({ task, depth, hasChildren }) => (
        <div
          key={task.id}
          className={`wbs-row ${task.id === selectedId ? "wbs-row-selected" : ""}`}
          style={{ height: ROW_HEIGHT }}
          onClick={() => onSelect(task.id)}
          onDoubleClick={() => onOpenEdit(task)}
        >
          <div className="wbs-col wbs-col-key">
            <a href={task.jiraUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              {task.id}
            </a>
          </div>
          <div className="wbs-col wbs-col-name" style={{ paddingLeft: depth * INDENT_STEP }}>
            <span className="wbs-expander-slot">
              {hasChildren && (
                <button
                  className={`expander ${collapsed.has(task.id) ? "expander-collapsed" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCollapse(task.id);
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10">
                    <path d="M2 1 L8 5 L2 9 Z" fill="currentColor" />
                  </svg>
                </button>
              )}
            </span>
            <IssueTypeIcon type={task.issueType} />
            <span className={hasChildren ? "wbs-summary wbs-summary-parent" : "wbs-summary"}>
              {task.summary}
            </span>
          </div>
          <div className="wbs-col wbs-col-assignee">{task.assigneeName ?? "—"}</div>
          <div className="wbs-col wbs-col-pct">{task.percentComplete}%</div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="gantt-wrap">
      <div className="gantt-toolbar">
        {[ViewMode.Day, ViewMode.Week, ViewMode.Month].map((vm) => (
          <button
            key={vm}
            className={viewMode === vm ? "active" : ""}
            onClick={() => setViewMode(vm)}
          >
            {vm}
          </button>
        ))}
      </div>
      <div className="gantt-body" ref={bodyRef}>
        {bodySize.width > 0 && (
          <>
            <Gantt
              tasks={ganttTasks}
              viewMode={viewMode}
              locale="vi"
              rowHeight={ROW_HEIGHT}
              headerHeight={HEADER_HEIGHT}
              ganttHeight={ganttHeight}
              listCellWidth={`${listWidth}px`}
              columnWidth={viewMode === ViewMode.Month ? 200 : viewMode === ViewMode.Week ? 160 : 60}
              TaskListHeader={TaskListHeader}
              TaskListTable={TaskListTable}
              onSelect={(t: GanttTaskT) => onSelect(t.id)}
              onDoubleClick={(t: GanttTaskT) => {
                const full = byId.get(t.id);
                if (full) onOpenEdit(full);
              }}
              onDateChange={(t: GanttTaskT) => {
                const start = toIso(t.start);
                const end = toIso(t.end);
                const durationDays = Math.max(
                  1,
                  Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000) + 1
                );
                onScheduleChange(t.id, start, durationDays);
              }}
              onProgressChange={(t: GanttTaskT) => onProgressChange(t.id, Math.round(t.progress))}
            />
            <div
              className={`gantt-divider ${dragging ? "dragging" : ""}`}
              style={{ left: listWidth }}
              onMouseDown={startDrag}
            />
          </>
        )}
      </div>
    </div>
  );
}
