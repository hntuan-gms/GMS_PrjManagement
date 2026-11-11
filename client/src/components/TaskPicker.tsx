import { useEffect, useMemo, useState } from "react";
import { mergeRemote, rankTasks, type RemoteIssue, type TaskPickOptions } from "../taskPickerModel";
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
  placeholder = "Search for issues",
  typed,
  onPickTyped,
  remote,
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
  /**
   * Also ask somewhere else for what was typed (Clockwork: any project's open work). Called 250 ms after typing
   * stops, from two characters on; what it finds is listed after the tasks given, never twice. A failure is
   * ignored: the tasks given are still there.
   */
  remote?: (query: string) => Promise<RemoteIssue[]>;
} & TaskPickOptions) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ query: string; issues: RemoteIssue[] } | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (!remote || q.length < 2) return;
    let alive = true;
    const t = setTimeout(() => {
      remote(q)
        .then((issues) => alive && setFound({ query: q, issues }))
        .catch(() => alive && setFound({ query: q, issues: [] }));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, remote]);
  // Only what answers the text now in the box: an older answer must not linger under a newer question.
  const extra = useMemo(
    () => (found && found.query === query.trim() ? mergeRemote(tasks ?? [], found.issues, exclude ?? []) : []),
    [found, query, tasks, exclude]
  );
  const byId = useMemo(() => new Map([...(tasks ?? []), ...extra].map((t) => [t.id, t])), [tasks, extra]);
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
      const more = extra.map((t) => ({ id: t.id, label: t.summary, lead: <span className="tp-key">{t.id}</span> }));
      const t = typed?.(q);
      return t
        ? [{ id: TYPED_PREFIX + t.value, label: t.label, hint: t.hint, lead: <span className="tp-key">{t.value}</span> }, ...found, ...more]
        : [...found, ...more];
    };
  }, [tasks, items, exclude, filter, limit, typed, extra]);
  return (
    <CellPicker
      anchor={anchor}
      items={items}
      loading={tasks === null}
      placeholder={placeholder}
      search={search}
      onQuery={remote ? setQuery : undefined}
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
