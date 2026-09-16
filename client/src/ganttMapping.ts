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

/**
 * Hierarchy (indentation, expand/collapse) is driven entirely by our own custom WBS
 * table, not gantt-task-react's built-in project/child aggregation — so every bar is
 * a plain "task" here regardless of whether it has children in the WBS.
 */
export function toGanttTasks(ordered: OrderedTask[]): GanttTask[] {
  return ordered
    .filter((o) => o.task.startDate)
    .map(({ task }) => ({
      id: task.id,
      name: task.summary,
      start: new Date(task.startDate! + "T00:00:00"),
      end: new Date((task.dueDate ?? task.startDate!) + "T23:59:59"),
      progress: task.percentComplete,
      type: "task",
      dependencies: task.predecessors.map((p) => p.taskId),
      styles: statusStyles(task.statusCategory, task.issueType),
    }));
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
