import { slipDays } from "./baselineGeometry";
import type { CsvCell } from "./csv";
import type { DateRange } from "./ganttMapping";
import type { Predecessor, Task } from "./types";

/**
 * The schedule data that lives only in our overlay (not in Jira): a sheet of the
 * WBS without it is just a copy of the Jira issue list. These columns go into
 * every WBS export whatever the table is showing — they are the reason to export
 * from here at all.
 */

/** "DEMO-3 FS; DEMO-4 SS+2; DEMO-5 FF-1" — type and lag the way the edit modal shows them. */
export function formatPredecessors(preds: Predecessor[]): string {
  return preds
    .map((p) => `${p.taskId} ${p.type}${p.lagDays > 0 ? `+${p.lagDays}` : p.lagDays < 0 ? String(p.lagDays) : ""}`)
    .join("; ");
}

/** `includePct` is false when the % column is already in the sheet as a visible column. */
export function overlayCsvHeader(includePct: boolean): string[] {
  return [
    ...(includePct ? ["% hoàn thành"] : []),
    "Phụ thuộc (việc trước)",
    "Baseline bắt đầu",
    "Baseline kết thúc",
    "Lệch baseline (ngày)",
  ];
}

/**
 * `range` and `baseline` are the resolved ones the chart draws (an Epic's roll
 * up its children), so a row in the sheet says what its bar on screen says.
 * The slip is a number, so a negative one is not mistaken for a formula.
 */
export function overlayCsvCells(
  task: Task,
  range: DateRange | undefined,
  baseline: DateRange | undefined,
  includePct: boolean
): CsvCell[] {
  return [
    ...(includePct ? [task.percentComplete] : []),
    formatPredecessors(task.predecessors),
    baseline?.start ?? null,
    baseline?.end ?? null,
    range && baseline ? slipDays(range, baseline) : null,
  ];
}
