import type { BoardFilter } from "./boardModel";
import { EMPTY_TASK_FILTER, filterTaskIds, isTaskFiltering, type TaskFilter } from "./taskFilter";
import type { Task } from "./types";

/**
 * The Bảng tab reads the same `TaskFilter` as the Kế hoạch and Nhân lực lenses (plan E1). Two
 * things exist only on the board and stay local: "Bị chặn" (a card with an unfinished
 * predecessor or a flag) and the board's own Jira quick filters. This module is the seam: the
 * shared filter plus those two become the `BoardFilter` that `boardModel.matchesFilter` already
 * understands, so that function did not have to change.
 */

export interface BoardOnly {
  onlyBlocked: boolean;
  /** Ids of the board's Jira quick filters that are switched on. */
  quick: Set<string>;
}

export const EMPTY_BOARD_ONLY: BoardOnly = { onlyBlocked: false, quick: new Set() };

export function isBoardOnlyActive(b: BoardOnly): boolean {
  return b.onlyBlocked || b.quick.size > 0;
}

/**
 * The shared facets a board card carries itself pass through unchanged. Components, sprints, a
 * JQL and the SLA toggle are not on a `BoardIssue`: `taskOnlyKeys` answers them from the tasks.
 * A status filter set from the Gantt still applies here even though the board's panel does not
 * offer that facet (its columns are the statuses).
 */
export function boardFilterFrom(tf: TaskFilter, boardOnly: BoardOnly): BoardFilter {
  return {
    text: tf.text,
    people: tf.people,
    onlyBlocked: boardOnly.onlyBlocked,
    onlyOverdue: tf.onlyOverdue,
    types: tf.types,
    statuses: tf.statuses,
    epics: tf.epics,
    labels: tf.labels,
    priorities: tf.priorities,
    versions: tf.versions,
    quick: boardOnly.quick,
  };
}

/** The other direction: a `BoardFilter` (from the assistant, say) as the shared filter plus the board-only part. */
export function splitBoardFilter(bf: BoardFilter): { task: TaskFilter; boardOnly: BoardOnly } {
  return {
    task: {
      ...EMPTY_TASK_FILTER,
      text: bf.text,
      people: new Set(bf.people),
      statuses: new Set(bf.statuses),
      types: new Set(bf.types),
      epics: new Set(bf.epics),
      labels: new Set(bf.labels),
      priorities: new Set(bf.priorities),
      versions: new Set(bf.versions),
      onlyOverdue: bf.onlyOverdue,
    },
    boardOnly: { onlyBlocked: bf.onlyBlocked, quick: new Set(bf.quick) },
  };
}

export interface TaskOnlyContext {
  today: string;
  jqlKeys?: Set<string> | null;
  slaBreached?: Set<string> | null;
}

/**
 * Issue keys that pass the facets a card cannot answer by itself (components, sprint, JQL, Trễ
 * SLA), or null when none of them is on. A JQL whose keys have not arrived restricts nothing,
 * the same stance `matchesTaskFilter` takes.
 */
export function taskOnlyKeys(tasks: Task[], tf: TaskFilter, ctx: TaskOnlyContext): Set<string> | null {
  const only: TaskFilter = {
    ...EMPTY_TASK_FILTER,
    components: tf.components,
    sprints: tf.sprints,
    jql: tf.jql,
    onlySlaBreached: tf.onlySlaBreached,
  };
  if (!isTaskFiltering(only)) return null;
  return filterTaskIds(tasks, only, { today: ctx.today, epicOf: new Map(), jqlKeys: ctx.jqlKeys, slaBreached: ctx.slaBreached });
}

/** True while anything narrows the board: the shared filter, or "Bị chặn" / a quick filter. */
export function isBoardFiltering(tf: TaskFilter, boardOnly: BoardOnly): boolean {
  return isTaskFiltering(tf) || isBoardOnlyActive(boardOnly);
}
