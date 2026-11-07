import type { Task as GanttTask } from "gantt-task-react";
import type { Task } from "./types";
import { categoryColors, type Palette } from "./themeColors";

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
    const children = childrenOf.get(task.id) ?? [];

    // An Epic's bar is always the span of its own children, full stop — even when
    // the Epic issue itself carries a startDate/dueDate (Jira lets you set one; this
    // app ignores it for the bar on purpose). A WBS is read top-down as "this phase
    // runs from its earliest task to its latest", and an Epic with its own,
    // unrelated dates would show a span that has nothing to do with the work under
    // it. Non-Epic parents (a Story with sub-tasks, say) keep the opposite rule
    // below: their own dates win, because those are usually the real commitment.
    if (task.issueType === "Epic" && children.length > 0) {
      let start: string | null = null;
      let end: string | null = null;
      for (const childId of children) {
        const childRange = ranges.get(childId);
        if (!childRange) continue;
        if (!start || childRange.start < start) start = childRange.start;
        if (!end || childRange.end > end) end = childRange.end;
      }
      if (start && end) {
        ranges.set(task.id, { start, end });
        continue;
      }
      // No child has a resolvable range (yet) — fall through to the Epic's own
      // dates below rather than leaving it with no bar at all.
    }

    if (task.startDate) {
      // A task with its own dates is authoritative, full stop — never widened by a
      // child's schedule. (Bug: this used to min/max against children unconditionally,
      // so dragging any parent task narrower than its children's span would snap
      // straight back to the wider range on the very next render.)
      ranges.set(task.id, { start: task.startDate, end: task.dueDate ?? task.startDate });
      continue;
    }
    // No own date — typically a grouping issue with no schedule of its own. Roll up
    // the min/max across descendants' resolved ranges so it still gets a displayable bar.
    let start: string | null = null;
    let end: string | null = null;
    for (const childId of children) {
      const childRange = ranges.get(childId);
      if (!childRange) continue;
      if (!start || childRange.start < start) start = childRange.start;
      if (!end || childRange.end > end) end = childRange.end;
    }
    if (start && end) ranges.set(task.id, { start, end });
  }
  return ranges;
}

export function nextDayIso(iso: string): string {
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
export function toGanttTasks(
  ordered: OrderedTask[],
  ranges: Map<string, DateRange>,
  colors?: BarColorContext,
  /**
   * A task with no resolvable date normally has no bar. With this day set it gets an invisible, undraggable
   * one-day bar there instead, so the library keeps one bar per row and every overlay that reads bars by row
   * index stays aligned with the table. GanttView passes a day inside the dated bars' span (anchorDay), so the
   * placeholder never widens the date axis; computeCriticalPath, progress and the cascade never see it
   * because they read `tasks`, not these.
   */
  placeholderDay?: string
): GanttTask[] {
  return ordered
    .filter((o) => placeholderDay !== undefined || ranges.has(o.task.id))
    .map(({ task, hasChildren }) => {
      const range = ranges.get(task.id);
      if (!range) return placeholderTask(task, placeholderDay!);
      return {
        id: task.id,
        name: task.summary,
        start: new Date(range.start + "T00:00:00"),
        end: new Date(nextDayIso(range.end) + "T00:00:00"),
        progress: task.percentComplete,
        type: "task",
        dependencies: [],
        // An Epic's bar is a computed rollup of its children (see resolveRanges),
        // not its own schedule, so dragging it would just snap straight back on
        // the next render — disabled rather than left to look broken. A
        // childless Epic has no rollup to snap back to, so it stays draggable.
        isDisabled: task.issueType === "Epic" && hasChildren,
        ...(colors ? { styles: barStyles(task, hasChildren, colors, range.end) } : {}),
      };
    });
}

/** Marks a row without dates in the library's own task list: `name` is empty so no label is drawn beside it. */
export const UNSCHEDULED_BAR_STYLE = {
  backgroundColor: "transparent",
  backgroundSelectedColor: "transparent",
  progressColor: "transparent",
  progressSelectedColor: "transparent",
};

function placeholderTask(task: Task, day: string): GanttTask {
  return {
    id: task.id,
    name: "",
    start: new Date(day + "T00:00:00"),
    end: new Date(nextDayIso(day) + "T00:00:00"),
    progress: 0,
    type: "task",
    dependencies: [],
    isDisabled: true,
    styles: UNSCHEDULED_BAR_STYLE,
  };
}

/**
 * How bars are coloured ("Hiển thị › Tô màu theo"). The old rule hashed each task id into a
 * pastel hue: the biggest, loudest shapes on the screen carried colour that meant nothing, and
 * people went looking for a meaning that was not there. Now colour always answers a question:
 * what state is this in (default), whose is it, which Epic is it under — or nothing at all.
 */
export type BarColorBy = "status" | "person" | "epic" | "none";

export interface BarColorContext {
  colorBy: BarColorBy;
  palette: Palette;
  /** YYYY-MM-DD, the browser's local day — a bar past its due date and not done is drawn as risk. */
  today: string;
  /** Category index per assignee / Epic id, in a stable order (team list, WBS order). */
  categoryOf: (task: Task) => number | null;
}

export interface BarStyle {
  backgroundColor: string;
  backgroundSelectedColor: string;
  progressColor: string;
  progressSelectedColor: string;
}

export function barStyles(task: Task, hasChildren: boolean, ctx: BarColorContext, dueDate: string | null): BarStyle {
  const p = ctx.palette;
  const style = (bg: string, progress: string, selected = bg): BarStyle => ({
    backgroundColor: bg,
    backgroundSelectedColor: selected,
    progressColor: progress,
    progressSelectedColor: progress,
  });
  const done = task.statusCategory === "done";
  // An Epic (or any parent) is a span, not work: drawn quiet so the work under it leads.
  // TimelineMarkers draws it as a bracket; the bar itself only carries the label.
  if (hasChildren && task.issueType === "Epic") return style(p.sheet, p.sheet, p.sunken);
  // Late is the one signal that overrides every colouring choice.
  if (!done && dueDate && dueDate < ctx.today) return style(p.riskSoft, p.risk);
  if (ctx.colorBy === "person" || ctx.colorBy === "epic") {
    const i = ctx.categoryOf(task);
    if (i === null) return style(p.line, p.ink4, p.lineStrong);
    const c = categoryColors(i, p.dark);
    return style(c.bg, c.progress, c.selected);
  }
  if (ctx.colorBy === "none") return style(p.line, p.ink3, p.lineStrong);
  if (done) return style(p.okSoft, p.ok);
  if (task.statusCategory === "indeterminate") return style(p.infoSoft, p.info);
  return style(p.line, p.ink3, p.lineStrong);
}
