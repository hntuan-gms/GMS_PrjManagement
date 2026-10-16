import { useCallback, useState } from "react";
import type { Task } from "./types";

/**
 * One filter over `Task[]`, shared by the Gantt and the resource heatmap.
 *
 * Mirrors `BoardFilter` in boardModel.ts on purpose — the board's cards are a
 * different type (`BoardIssue`), but the facets and their semantics are meant to
 * read the same everywhere: an empty set means "no restriction", and "none"
 * stands for "unassigned" in `people`. "Của tôi" is just the signed-in user's
 * own account id in `people`, so it needs no field of its own.
 */
export interface TaskFilter {
  text: string;
  /** Account ids to show; empty = everyone. "none" stands for unassigned. */
  people: Set<string>;
  statuses: Set<string>;
  types: Set<string>;
  /** Epic keys — a task matches through its nearest Epic ancestor (or itself). */
  epics: Set<string>;
  labels: Set<string>;
  /** Priority names; "none" stands for an issue with no priority. Same rule as the board's facet. */
  priorities: Set<string>;
  onlyOverdue: boolean;
}

export const EMPTY_TASK_FILTER: TaskFilter = {
  text: "",
  people: new Set(),
  statuses: new Set(),
  types: new Set(),
  epics: new Set(),
  labels: new Set(),
  priorities: new Set(),
  onlyOverdue: false,
};

export function isTaskFiltering(f: TaskFilter): boolean {
  return (
    !!f.text.trim() ||
    f.people.size > 0 ||
    f.statuses.size > 0 ||
    f.types.size > 0 ||
    f.epics.size > 0 ||
    f.labels.size > 0 ||
    f.priorities.size > 0 ||
    f.onlyOverdue
  );
}

/** Facets only — the free-text box is a transient search, not a saved view. */
export function facetCount(f: TaskFilter): number {
  return (
    (f.people.size > 0 ? 1 : 0) +
    (f.statuses.size > 0 ? 1 : 0) +
    (f.types.size > 0 ? 1 : 0) +
    (f.epics.size > 0 ? 1 : 0) +
    (f.labels.size > 0 ? 1 : 0) +
    (f.priorities.size > 0 ? 1 : 0) +
    (f.onlyOverdue ? 1 : 0)
  );
}

export function isOverdueTask(t: Task, today: string): boolean {
  return t.statusCategory !== "done" && !!t.dueDate && t.dueDate < today;
}

/** task id → key of its nearest Epic ancestor (itself, for an Epic); null when it has none. */
export function buildEpicIndex(tasks: Task[]): Map<string, string | null> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out = new Map<string, string | null>();
  for (const t of tasks) {
    let cur: Task | undefined = t;
    let found: string | null = null;
    // The step cap doubles as a cycle guard: a malformed parent chain must not
    // hang the render.
    for (let i = 0; cur && i < 50; i++) {
      if (cur.issueType.toLowerCase() === "epic") {
        found = cur.id;
        break;
      }
      cur = cur.wbsParentId ? byId.get(cur.wbsParentId) : undefined;
    }
    out.set(t.id, found);
  }
  return out;
}

export interface FilterContext {
  today: string;
  epicOf: Map<string, string | null>;
}

export function matchesTaskFilter(t: Task, f: TaskFilter, ctx: FilterContext): boolean {
  const q = f.text.trim().toLowerCase();
  if (q && !`${t.id} ${t.summary} ${t.assigneeName ?? ""} ${t.labels.join(" ")}`.toLowerCase().includes(q)) {
    return false;
  }
  if (f.people.size > 0 && !f.people.has(t.assigneeAccountId ?? "none")) return false;
  if (f.statuses.size > 0 && !f.statuses.has(t.statusName)) return false;
  if (f.types.size > 0 && !f.types.has(t.issueType)) return false;
  if (f.epics.size > 0) {
    const epic = ctx.epicOf.get(t.id) ?? "none";
    if (!f.epics.has(epic)) return false;
  }
  if (f.labels.size > 0 && !t.labels.some((l) => f.labels.has(l))) return false;
  if (f.priorities.size > 0 && !f.priorities.has(t.priority ?? "none")) return false;
  if (f.onlyOverdue && !isOverdueTask(t, ctx.today)) return false;
  return true;
}

/** Ids of the tasks that pass; null when nothing is being filtered. */
export function filterTaskIds(tasks: Task[], f: TaskFilter, ctx: FilterContext): Set<string> | null {
  if (!isTaskFiltering(f)) return null;
  const ids = new Set<string>();
  for (const t of tasks) if (matchesTaskFilter(t, f, ctx)) ids.add(t.id);
  return ids;
}

/* ------------------------------------------------------------- persistence */

interface Stored {
  people?: string[];
  statuses?: string[];
  types?: string[];
  epics?: string[];
  labels?: string[];
  priorities?: string[];
  onlyOverdue?: boolean;
}

function load(key: string): TaskFilter {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return EMPTY_TASK_FILTER;
    const s = JSON.parse(raw) as Stored;
    const arr = (v: unknown) => new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    return {
      text: "",
      people: arr(s.people),
      statuses: arr(s.statuses),
      types: arr(s.types),
      epics: arr(s.epics),
      labels: arr(s.labels),
      priorities: arr(s.priorities),
      onlyOverdue: s.onlyOverdue === true,
    };
  } catch {
    return EMPTY_TASK_FILTER;
  }
}

function save(key: string, f: TaskFilter): void {
  try {
    const s: Stored = {
      people: [...f.people],
      statuses: [...f.statuses],
      types: [...f.types],
      epics: [...f.epics],
      labels: [...f.labels],
      priorities: [...f.priorities],
      onlyOverdue: f.onlyOverdue,
    };
    localStorage.setItem(key, JSON.stringify(s));
  } catch {
    // Private window or blocked storage: the filter still works, it just isn't remembered.
  }
}

/**
 * The shared filter, remembered per browser under `storageKey` (site + project —
 * a status called "In Review" in one project means nothing in another). The text
 * box is deliberately not restored: a search left over from last week would make
 * a project look empty.
 */
export function useTaskFilter(storageKey: string): [TaskFilter, (f: TaskFilter) => void] {
  const [filter, setFilterState] = useState<TaskFilter>(() => load(storageKey));
  const setFilter = useCallback(
    (f: TaskFilter) => {
      setFilterState(f);
      save(storageKey, f);
    },
    [storageKey]
  );
  return [filter, setFilter];
}
