import { EMPTY_TASK_FILTER, type TaskFilter } from "./taskFilter";
import type { SavedFilterSpec } from "./types";

/**
 * A TaskFilter as the server stores it, and back.
 *
 * Two translations make a filter fit for sharing: the signed-in user's own account
 * id is saved as "@me" (a filter someone shares with "Của tôi" switched on means
 * *the opener's* tasks, not the author's), and the free-text box is saved as is —
 * unlike the per-browser memory in taskFilter.ts, a saved filter is a deliberate
 * act, so its words are part of what was saved.
 */

export const ME = "@me";

export function toSavedSpec(f: TaskFilter, myAccountId: string): SavedFilterSpec {
  return {
    text: f.text.trim(),
    people: [...f.people].map((p) => (p === myAccountId ? ME : p)),
    statuses: [...f.statuses],
    types: [...f.types],
    epics: [...f.epics],
    labels: [...f.labels],
    components: [...f.components],
    versions: [...f.versions],
    sprints: [...f.sprints],
    onlyOverdue: f.onlyOverdue,
    jql: f.jql.trim(),
  };
}

export function fromSavedSpec(spec: SavedFilterSpec, myAccountId: string): TaskFilter {
  return {
    ...EMPTY_TASK_FILTER,
    text: spec.text ?? "",
    people: new Set((spec.people ?? []).map((p) => (p === ME ? myAccountId : p))),
    statuses: new Set(spec.statuses ?? []),
    types: new Set(spec.types ?? []),
    epics: new Set(spec.epics ?? []),
    labels: new Set(spec.labels ?? []),
    components: new Set(spec.components ?? []),
    versions: new Set(spec.versions ?? []),
    sprints: new Set(spec.sprints ?? []),
    onlyOverdue: spec.onlyOverdue === true,
    jql: spec.jql ?? "",
  };
}

/** Does saving this change anything? An empty filter is not worth a name. */
export function hasContent(spec: SavedFilterSpec): boolean {
  return !!(
    spec.text ||
    spec.jql ||
    spec.onlyOverdue ||
    [spec.people, spec.statuses, spec.types, spec.epics, spec.labels, spec.components, spec.versions, spec.sprints].some((a) => a.length > 0)
  );
}
