import type { Task as GanttTask } from "gantt-task-react";
import type { Task } from "./types";

export interface OrderedTask {
  task: Task;
  depth: number;
  hasChildren: boolean;
}

/** Depth-first WBS ordering: children immediately follow their parent, siblings sorted by start date. */
export function orderByWbs(tasks: Task[]): OrderedTask[] {
  const ids = new Set(tasks.map((t) => t.id));
  // Orphan parents (filtered out / not loaded) collapse to root so their children still render.
  const byParent = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const key = t.wbsParentId && ids.has(t.wbsParentId) ? t.wbsParentId : null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(t);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999"));
  }

  const result: OrderedTask[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const t of byParent.get(parentId) ?? []) {
      const children = byParent.get(t.id) ?? [];
      result.push({ task: t, depth, hasChildren: children.length > 0 });
      visit(t.id, depth + 1);
    }
  };
  visit(null, 0);
  return result;
}

export interface DateRange {
  start: string;
  end: string;
}

/**
 * A displayable date range for every task: its own start/due when set, or — for a
 * WBS parent (an Epic used purely as a grouping issue, say) that has none of its
 * own — the min/max across its descendants' resolved ranges, so the parent still
 * gets a bar spanning its children instead of vanishing from the chart entirely.
 * Computed from the *full* tree regardless of collapse state, so collapsing a
 * parent never changes its own resolved range.
 */
export function resolveRanges(ordered: OrderedTask[]): Map<string, DateRange> {
  const childrenOf = new Map<string, string[]>();
  const byId = new Map(ordered.map((o) => [o.task.id, o.task]));
  for (const o of ordered) {
    const parentId = o.task.wbsParentId;
    if (parentId && byId.has(parentId)) {
      if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
      childrenOf.get(parentId)!.push(o.task.id);
    }
  }

  const ranges = new Map<string, DateRange>();
  // `ordered` is depth-first, parent-before-children, so every descendant of a node
  // appears somewhere after it — walking in reverse guarantees children (and their
  // own already-resolved rollups) are available by the time their parent is visited.
  for (const { task } of [...ordered].reverse()) {
    if (task.startDate) {
      // A task with its own dates is authoritative, full stop — never widened by a
      // child's schedule. (Bug: this used to min/max against children unconditionally,
      // so dragging any parent task narrower than its children's span would snap
      // straight back to the wider range on the very next render.)
      ranges.set(task.id, { start: task.startDate, end: task.dueDate ?? task.startDate });
      continue;
    }
    // No own date — typically an Epic used purely as a grouping issue. Roll up the
    // min/max across descendants' resolved ranges so it still gets a displayable bar.
    let start: string | null = null;
    let end: string | null = null;
    for (const childId of childrenOf.get(task.id) ?? []) {
      const childRange = ranges.get(childId);
      if (!childRange) continue;
      if (!start || childRange.start < start) start = childRange.start;
      if (!end || childRange.end > end) end = childRange.end;
    }
    if (start && end) ranges.set(task.id, { start, end });
  }
  return ranges;
}

function nextDayIso(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Hierarchy (indentation, expand/collapse) is driven entirely by our own custom WBS
 * table, not gantt-task-react's built-in project/child aggregation — so every bar is
 * a plain "task" here regardless of whether it has children in the WBS. `ordered`
 * must already be filtered to entries present in `ranges` (see GanttView) so this
 * list stays index-aligned, row for row, with the custom TaskListTable.
 *
 * `dependencies` is deliberately left empty: gantt-task-react's own arrows carry no
 * FS/SS/FF/SF distinction (its Task.dependencies is just a list of ids, always drawn
 * as a Finish-to-Start elbow) — DependencyOverlay.tsx draws every relationship type
 * correctly instead, as a custom overlay portaled into the chart's own SVG.
 *
 * `end` is deliberately midnight of the day AFTER the due date (an EXCLUSIVE end),
 * not 23:59:59 of the due date itself. gantt-task-react snaps a drag to 5-minute
 * increments of mouse position, not whole days, so a plain move lands both edges on
 * some arbitrary time-of-day, not midnight. With start at 00:00 and end at 23:59:59,
 * that arbitrary offset had ~24h of slack before start rolled to the next calendar
 * day but under a second's worth before end did — so nearly every move pushed end
 * into the next day while start didn't, silently adding a day to the duration on
 * drop (GanttView.tsx's onDateChange only reads the calendar date, not the time).
 * Anchoring both edges to the same 00:00 keeps them at the identical time-of-day
 * after an equal shift, so the day-count between them can no longer drift.
 */
export function toGanttTasks(ordered: OrderedTask[], ranges: Map<string, DateRange>): GanttTask[] {
  return ordered
    .filter((o) => ranges.has(o.task.id))
    .map(({ task }) => {
      const range = ranges.get(task.id)!;
      return {
        id: task.id,
        name: task.summary,
        start: new Date(range.start + "T00:00:00"),
        end: new Date(nextDayIso(range.end) + "T00:00:00"),
        progress: task.percentComplete,
        type: "task",
        dependencies: [],
        styles: statusStyles(task.statusCategory, task.issueType),
      };
    });
}

function statusStyles(statusCategory: Task["statusCategory"], issueType: Task["issueType"]) {
  if (issueType === "Bug") {
    return { backgroundColor: "#f8caca", progressColor: "#d64545", backgroundSelectedColor: "#f2a4a4" };
  }
  if (issueType === "Epic") {
    return { backgroundColor: "#e3d4fb", progressColor: "#7c4dd6", backgroundSelectedColor: "#d0b8f7" };
  }
  switch (statusCategory) {
    case "done":
      return { backgroundColor: "#c6e8c6", progressColor: "#3a9d3a", backgroundSelectedColor: "#a6d8a6" };
    case "indeterminate":
      return { backgroundColor: "#cfe0fb", progressColor: "#3369c9", backgroundSelectedColor: "#aecafb" };
    default:
      return { backgroundColor: "#e3e3e8", progressColor: "#8a8a93", backgroundSelectedColor: "#cacace" };
  }
}
