import { Gantt, ViewMode, type Task as GanttTaskT } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { useMemo, useState } from "react";
import { orderByWbs, toGanttTasks } from "../ganttMapping";
import type { Task } from "../types";

const ROW_HEIGHT = 42;
const HEADER_HEIGHT = 46;

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

const typeBadge: Record<Task["issueType"], string> = {
  Epic: "🟣",
  Story: "🟦",
  Task: "⬜",
  Bug: "🟥",
  "Sub-task": "↳",
};

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

  const ordered = useMemo(() => orderByWbs(tasks), [tasks]);
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

  const ganttTasks = useMemo(() => toGanttTasks(visible), [visible]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  if (visible.length === 0 || ganttTasks.length === 0) {
    return (
      <div className="empty-state">
        Chưa có task nào có ngày bắt đầu để hiển thị trên Gantt. Hãy tạo task hoặc đặt
        ngày bắt đầu cho task hiện có.
      </div>
    );
  }

  const TaskListHeader = () => (
    <div className="wbs-header" style={{ height: HEADER_HEIGHT }}>
      <div className="wbs-col wbs-col-key">Mã</div>
      <div className="wbs-col wbs-col-name">Tên công việc</div>
      <div className="wbs-col wbs-col-assignee">Phụ trách</div>
      <div className="wbs-col wbs-col-pct">%</div>
    </div>
  );

  const TaskListTable = () => (
    <div>
      {visible.map(({ task, depth, hasChildren }) => (
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
          <div className="wbs-col wbs-col-name" style={{ paddingLeft: depth * 16 }}>
            {hasChildren && (
              <button
                className="expander"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCollapse(task.id);
                }}
              >
                {collapsed.has(task.id) ? "▸" : "▾"}
              </button>
            )}
            <span title={task.issueType}>{typeBadge[task.issueType]}</span> {task.summary}
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
      <Gantt
        tasks={ganttTasks}
        viewMode={viewMode}
        locale="vi"
        rowHeight={ROW_HEIGHT}
        headerHeight={HEADER_HEIGHT}
        listCellWidth="320px"
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
    </div>
  );
}
