import { EMPTY_FILTER, type BoardFilter } from "./boardModel";
import { EMPTY_TASK_FILTER, type TaskFilter } from "./taskFilter";

/**
 * A filter the assistant resolved from a sentence ("lọc việc quá hạn của Minh"),
 * as the server sends it (server/src/ai/viewFilter.ts — keep the two shapes in
 * step). Names are already accountIds and status words already status names; all
 * that is left here is to pour it into the two filter states people already set
 * by hand, so a filter the assistant applied looks and clears exactly like one
 * from the toolbar.
 */
export interface ViewFilterSpec {
  text: string;
  /** Account ids; "none" stands for unassigned. */
  people: string[];
  statuses: string[];
  types: string[];
  /** Epic keys. */
  epics: string[];
  labels: string[];
  /** Priority names; "none" stands for no priority. */
  priorities: string[];
  onlyOverdue: boolean;
  /** Board only. */
  onlyBlocked: boolean;
}

/** Gantt and resource heatmap. "Blocked" is not a facet there. */
export function toTaskFilter(spec: ViewFilterSpec): TaskFilter {
  return {
    ...EMPTY_TASK_FILTER,
    text: spec.text,
    people: new Set(spec.people),
    statuses: new Set(spec.statuses),
    types: new Set(spec.types),
    epics: new Set(spec.epics),
    labels: new Set(spec.labels),
    priorities: new Set(spec.priorities),
    onlyOverdue: spec.onlyOverdue,
  };
}

/** The board. */
export function toBoardFilter(spec: ViewFilterSpec): BoardFilter {
  return {
    ...EMPTY_FILTER,
    text: spec.text,
    people: new Set(spec.people),
    statuses: new Set(spec.statuses),
    types: new Set(spec.types),
    epics: new Set(spec.epics),
    labels: new Set(spec.labels),
    priorities: new Set(spec.priorities),
    onlyOverdue: spec.onlyOverdue,
    onlyBlocked: spec.onlyBlocked,
  };
}
