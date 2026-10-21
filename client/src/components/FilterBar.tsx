import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { priorityRank } from "../boardModel";
import { EMPTY_TASK_FILTER, facetCount, isTaskFiltering, type TaskFilter } from "../taskFilter";
import type { Task } from "../types";

export type FilterFacet = "people" | "statuses" | "types" | "epics" | "labels" | "priorities" | "overdue";

export interface Option {
  value: string;
  label: string;
}

interface Props {
  tasks: Task[];
  filter: TaskFilter;
  onChange: (f: TaskFilter) => void;
  /** Powers the "Của tôi" chip: it toggles this account id in `filter.people`. */
  myAccountId: string;
  /** Which dropdowns to offer; the resource heatmap has its own people search. */
  facets?: FilterFacet[];
  /** "12 / 80" counter shown while filtering. */
  matched?: number;
  total?: number;
  /** Rendered first in the bar — the saved-filter menu. */
  leading?: ReactNode;
}

const ALL_FACETS: FilterFacet[] = ["people", "statuses", "types", "epics", "labels", "priorities", "overdue"];

function toggled(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Option[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="col-chooser tf-select" ref={ref}>
      <button
        type="button"
        className={`tf-btn${selected.size > 0 ? " is-on" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {label}
        {selected.size > 0 ? ` (${selected.size})` : ""} ▾
      </button>
      {open && (
        <div className="col-chooser-menu tf-menu" role="menu">
          {options.length === 0 ? (
            <div className="tf-empty">Chưa có giá trị nào.</div>
          ) : (
            options.map((o) => (
              <label key={o.value} className="col-chooser-item">
                <input
                  type="checkbox"
                  checked={selected.has(o.value)}
                  onChange={() => onChange(toggled(selected, o.value))}
                />
                <span className="tf-item-label">{o.label}</span>
              </label>
            ))
          )}
          {selected.size > 0 && (
            <div className="col-chooser-foot">
              <button type="button" className="text-btn" onClick={() => onChange(new Set())}>
                Bỏ chọn
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The facet dropdowns over a task list. It owns no state: the filter lives in
 * ProjectWorkspace so the Gantt and the resource tab narrow the same set, and so
 * a facet picked on one is still there on the other.
 */
export default function FilterBar({
  tasks,
  filter,
  onChange,
  myAccountId,
  facets = ALL_FACETS,
  matched,
  total,
  leading,
}: Props) {
  const has = (f: FilterFacet) => facets.includes(f);

  const options = useMemo(() => {
    const people = new Map<string, string>();
    const statuses = new Set<string>();
    const types = new Set<string>();
    const labels = new Set<string>();
    const priorities = new Set<string>();
    const epics: Option[] = [];
    let anyUnassigned = false;
    for (const t of tasks) {
      if (t.assigneeAccountId) people.set(t.assigneeAccountId, t.assigneeName ?? t.assigneeAccountId);
      else anyUnassigned = true;
      statuses.add(t.statusName);
      types.add(t.issueType);
      for (const l of t.labels) labels.add(l);
      priorities.add(t.priority ?? "none");
      if (t.issueType.toLowerCase() === "epic") epics.push({ value: t.id, label: `${t.id} · ${t.summary}` });
    }
    const byLabel = (a: Option, b: Option) => a.label.localeCompare(b.label, "vi");
    const personOptions: Option[] = [...people].map(([value, label]) => ({ value, label })).sort(byLabel);
    if (anyUnassigned) personOptions.unshift({ value: "none", label: "Chưa gán" });
    const plain = (set: Set<string>): Option[] =>
      [...set].sort((a, b) => a.localeCompare(b, "vi")).map((value) => ({ value, label: value }));
    return {
      people: personOptions,
      statuses: plain(statuses),
      types: plain(types),
      labels: plain(labels),
      // Highest first, the way the board orders the same facet.
      priorities: [...priorities]
        .sort((a, b) => priorityRank(a === "none" ? null : a) - priorityRank(b === "none" ? null : b) || a.localeCompare(b, "vi"))
        .map((value) => ({ value, label: value === "none" ? "Không đặt" : value })),
      epics: [...epics.sort(byLabel), { value: "none", label: "Không thuộc Epic" }],
    };
  }, [tasks]);

  const mine = filter.people.has(myAccountId);
  const filtering = isTaskFiltering(filter);

  return (
    <div className="tf-bar">
      {leading}
      {has("people") && (
        <>
          <button
            type="button"
            className={`tf-btn${mine ? " is-on" : ""}`}
            onClick={() => onChange({ ...filter, people: toggled(filter.people, myAccountId) })}
            title="Chỉ các công việc giao cho tôi"
          >
            Của tôi
          </button>
          <MultiSelect
            label="Người phụ trách"
            options={options.people}
            selected={filter.people}
            onChange={(people) => onChange({ ...filter, people })}
          />
        </>
      )}
      {has("statuses") && (
        <MultiSelect
          label="Trạng thái"
          options={options.statuses}
          selected={filter.statuses}
          onChange={(statuses) => onChange({ ...filter, statuses })}
        />
      )}
      {has("types") && (
        <MultiSelect
          label="Loại"
          options={options.types}
          selected={filter.types}
          onChange={(types) => onChange({ ...filter, types })}
        />
      )}
      {has("epics") && (
        <MultiSelect
          label="Epic"
          options={options.epics}
          selected={filter.epics}
          onChange={(epics) => onChange({ ...filter, epics })}
        />
      )}
      {has("labels") && (
        <MultiSelect
          label="Nhãn"
          options={options.labels}
          selected={filter.labels}
          onChange={(labels) => onChange({ ...filter, labels })}
        />
      )}
      {has("priorities") && (
        <MultiSelect
          label="Ưu tiên"
          options={options.priorities}
          selected={filter.priorities}
          onChange={(priorities) => onChange({ ...filter, priorities })}
        />
      )}
      {has("overdue") && (
        <button
          type="button"
          className={`tf-btn${filter.onlyOverdue ? " is-on" : ""}`}
          onClick={() => onChange({ ...filter, onlyOverdue: !filter.onlyOverdue })}
          title="Quá hạn và chưa xong"
        >
          Quá hạn
        </button>
      )}
      {filtering && (
        <>
          {matched !== undefined && total !== undefined && (
            <span className="tf-count">
              {matched}/{total} công việc
            </span>
          )}
          <button type="button" className="text-btn tf-clear" onClick={() => onChange(EMPTY_TASK_FILTER)}>
            Xoá lọc{facetCount(filter) > 0 ? ` (${facetCount(filter)})` : ""}
          </button>
        </>
      )}
    </div>
  );
}
