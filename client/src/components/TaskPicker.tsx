import { useMemo } from "react";
import { rankTasks, type TaskPickOptions } from "../taskPickerModel";
import type { Task } from "../types";
import CellPicker, { type PickItem } from "./CellPicker";

/** Marks the row `typed` builds, so it cannot be mistaken for a task id. */
const TYPED_PREFIX = "::typed::";

/**
 * Choose one task by typing its key or part of its title, no diacritics needed (plan 0-2). At most 30
 * rows, finished work last. `exclude` keeps out the task itself (and its descendants when choosing a
 * parent, see `descendantIds`); `filter` narrows what may be chosen (only Epics and Stories as a parent).
 */
export default function TaskPicker({
  anchor,
  tasks,
  exclude,
  filter,
  limit,
  placeholder = "Tìm việc theo mã hoặc tên",
  typed,
  onPickTyped,
  onPick,
  onClose,
}: {
  anchor: DOMRect;
  tasks: readonly Task[] | null;
  onPick: (task: Task) => void;
  onClose: () => void;
  placeholder?: string;
  /**
   * A row built from what was typed, shown first, for text no task answers to: "5fs+2" as a dependency,
   * the key of another project as a Jira link. Picking it calls `onPickTyped` with `value`.
   */
  typed?: (query: string) => { value: string; label: string; hint?: string } | null;
  onPickTyped?: (value: string) => void;
} & TaskPickOptions) {
  const byId = useMemo(() => new Map((tasks ?? []).map((t) => [t.id, t])), [tasks]);
  const items = useMemo<PickItem[] | null>(
    () =>
      tasks
        ? tasks.map((t) => ({
            id: t.id,
            label: t.summary,
            lead: <span className="tp-key">{t.id}</span>,
            hint: t.statusCategory === "done" ? "xong" : undefined,
          }))
        : null,
    [tasks]
  );
  const search = useMemo(() => {
    const lookup = new Map((items ?? []).map((i) => [i.id, i]));
    return (_: PickItem[], q: string) => {
      const found = rankTasks(tasks ?? [], q, { exclude, filter, limit })
        .map((t) => lookup.get(t.id))
        .filter((i): i is PickItem => !!i);
      const t = typed?.(q);
      return t
        ? [{ id: TYPED_PREFIX + t.value, label: t.label, hint: t.hint, lead: <span className="tp-key">{t.value}</span> }, ...found]
        : found;
    };
  }, [tasks, items, exclude, filter, limit, typed]);
  return (
    <CellPicker
      anchor={anchor}
      items={items}
      loading={tasks === null}
      placeholder={placeholder}
      search={search}
      className="is-wide"
      onPick={(it) => {
        if (it.id.startsWith(TYPED_PREFIX)) {
          onPickTyped?.(it.id.slice(TYPED_PREFIX.length));
          return;
        }
        const t = byId.get(it.id);
        if (t) onPick(t);
      }}
      onClose={onClose}
    />
  );
}
