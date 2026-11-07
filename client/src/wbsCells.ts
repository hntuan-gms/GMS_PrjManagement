/*
 * Which cells of a WBS row can be edited where they are, and where Tab goes next (plan C4). Pure so the
 * rules are testable without the chart. Status stays its own picker (workflow transitions), so it is not here.
 */

export type CellKind = "summary" | "assignee" | "start" | "due" | "duration" | "pct" | "predecessors";

/** The order Tab walks a row in: the name, then the table's columns left to right. */
export const CELL_ORDER: CellKind[] = ["summary", "assignee", "start", "due", "duration", "predecessors", "pct"];

/** The column ids (GanttView's ColumnId) that carry an editable kind. */
export const KIND_OF_COLUMN: Record<string, CellKind | undefined> = {
  assignee: "assignee",
  start: "start",
  due: "due",
  duration: "duration",
  predecessors: "predecessors",
  pct: "pct",
};

export interface EditContext {
  issueType: string;
  hasChildren: boolean;
  /** An assignee can be written (an Epic has none to give). */
  canAssign: boolean;
  /** Field-level writes are wired (name, predecessors). */
  canUpdate: boolean;
  canSchedule: boolean;
  canProgress: boolean;
}

/**
 * An Epic with children is drawn as the span of its children, so dates, duration and % would snap back on the
 * next render: those cells are read-only for it, like its bar is undraggable.
 */
export function editableKinds(ctx: EditContext): Set<CellKind> {
  const out = new Set<CellKind>();
  const rollup = ctx.issueType === "Epic" && ctx.hasChildren;
  if (ctx.canUpdate) out.add("summary");
  if (ctx.canAssign) out.add("assignee");
  if (ctx.canSchedule && !rollup) {
    out.add("start");
    out.add("due");
    out.add("duration");
  }
  if (ctx.canUpdate) out.add("predecessors");
  if (ctx.canProgress && !rollup) out.add("pct");
  return out;
}

/** Editable kinds that are actually on screen (a hidden column is no stop), in Tab order; the name is always shown. */
export function stopsFor(editable: Set<CellKind>, visibleColumnIds: readonly string[]): CellKind[] {
  const shown = new Set<CellKind>(["summary"]);
  for (const id of visibleColumnIds) {
    const k = KIND_OF_COLUMN[id];
    if (k) shown.add(k);
  }
  return CELL_ORDER.filter((k) => shown.has(k) && editable.has(k));
}

/** The stop after (dir 1) or before (dir -1) `from`; null at either end of the row. */
export function neighbourStop(stops: readonly CellKind[], from: CellKind, dir: 1 | -1): CellKind | null {
  const i = stops.indexOf(from);
  if (i === -1) return stops[dir === 1 ? 0 : stops.length - 1] ?? null;
  return stops[i + dir] ?? null;
}

/**
 * The row an Enter (down) lands on: the next row in `order` where `kind` is editable, so a column can be
 * filled top to bottom without the mouse. null at the end.
 */
export function nextRowFor(order: readonly string[], fromId: string, canEdit: (id: string) => boolean): string | null {
  const i = order.indexOf(fromId);
  for (let j = i + 1; j < order.length; j++) if (canEdit(order[j])) return order[j];
  return null;
}
