import { EMPTY_TASK_FILTER, type TaskFilter } from "./taskFilter";
import type { SavedFilterSpec } from "./types";

/** Stands for "whoever applies the filter" — see toSavedSpec. */
export const ME = "@me";

const sorted = (s: Set<string>) => [...s].sort();

/**
 * The filter as it is stored. The saver's own account id becomes "@me", so a
 * shared "Của tôi" filter shows each teammate their own work rather than the
 * creator's. The search box is left out: it is a transient search, never a saved
 * view (the same rule useTaskFilter follows for localStorage).
 */
export function toSavedSpec(f: TaskFilter, myAccountId: string): SavedFilterSpec {
  return {
    people: sorted(new Set([...f.people].map((p) => (p === myAccountId ? ME : p)))),
    statuses: sorted(f.statuses),
    types: sorted(f.types),
    epics: sorted(f.epics),
    labels: sorted(f.labels),
    priorities: sorted(f.priorities),
    onlyOverdue: f.onlyOverdue,
  };
}

/** Back into the shared filter state, with "@me" as the person applying it and the search box cleared. */
export function fromSavedSpec(spec: SavedFilterSpec, myAccountId: string): TaskFilter {
  return {
    ...EMPTY_TASK_FILTER,
    text: "",
    people: new Set(spec.people.map((p) => (p === ME ? myAccountId : p))),
    statuses: new Set(spec.statuses),
    types: new Set(spec.types),
    epics: new Set(spec.epics),
    labels: new Set(spec.labels),
    priorities: new Set(spec.priorities),
    onlyOverdue: spec.onlyOverdue,
  };
}

/** Whether the current facets are exactly this saved filter — used to name the active one. */
export function matchesSaved(f: TaskFilter, spec: SavedFilterSpec, myAccountId: string): boolean {
  const a = toSavedSpec(f, myAccountId);
  const b = toSavedSpec(fromSavedSpec(spec, myAccountId), myAccountId);
  return JSON.stringify(a) === JSON.stringify(b);
}
