import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { priorityRank } from "../boardModel";
import { EMPTY_TASK_FILTER, facetCount, isTaskFiltering, type TaskFilter } from "../taskFilter";
import type { Task } from "../types";

export type FilterFacet =
  | "people"
  | "statuses"
  | "types"
  | "epics"
  | "labels"
  | "priorities"
  | "components"
  | "versions"
  | "sprints"
  | "overdue";

/**
 * What only the Gantt offers: a JQL box. The resource tab shares the filter but
 * not this, so it travels as one optional block.
 */
export interface JqlControl {
  /** State of the JQL query behind `filter.jql`. */
  state: { running: boolean; error: string | null; truncated: boolean; count: number | null };
  onRun: (jql: string) => void;
  onClear: () => void;
}

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
  jql?: JqlControl;
}

const ALL_FACETS: FilterFacet[] = ["people", "statuses", "types", "epics", "labels", "priorities", "components", "versions", "sprints", "overdue"];

/** Tiny glyphs so the bar reads as "two instant toggles, then a row of value
 * pickers" at a glance instead of a wall of identical gray pills. */
function FbIcon({ name }: { name: "user" | "alert" | "caret" }) {
  const common = {
    width: 13,
    height: 13,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    className: "fb-icon",
  };
  if (name === "user")
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" />
      </svg>
    );
  if (name === "alert")
    return (
      <svg {...common}>
        <path d="M12 3 2 20h20L12 3Z" />
        <path d="M12 10v4" />
        <path d="M12 16.8v.1" />
      </svg>
    );
  return (
    <svg {...common} width="10" height="10" strokeWidth="2.4">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

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
        {selected.size > 0 ? ` (${selected.size})` : ""}
        <FbIcon name="caret" />
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
  jql,
}: Props) {
  const has = (f: FilterFacet) => facets.includes(f);
  const [jqlOpen, setJqlOpen] = useState(!!filter.jql);
  const [jqlDraft, setJqlDraft] = useState(filter.jql);
  // A filter applied from elsewhere (a saved one, the assistant) carries its JQL with it.
  // Adjusted while rendering, not in an effect: React re-renders at once, with no frame
  // showing the old text.
  const [seenJql, setSeenJql] = useState(filter.jql);
  if (seenJql !== filter.jql) {
    setSeenJql(filter.jql);
    setJqlDraft(filter.jql);
    if (filter.jql) setJqlOpen(true);
  }

  const options = useMemo(() => {
    const people = new Map<string, string>();
    const statuses = new Set<string>();
    const types = new Set<string>();
    const labels = new Set<string>();
    const priorities = new Set<string>();
    const components = new Set<string>();
    const versions = new Set<string>();
    const sprints = new Set<string>();
    const epics: Option[] = [];
    let anyUnassigned = false;
    for (const t of tasks) {
      if (t.assigneeAccountId) people.set(t.assigneeAccountId, t.assigneeName ?? t.assigneeAccountId);
      else anyUnassigned = true;
      statuses.add(t.statusName);
      types.add(t.issueType);
      for (const l of t.labels) labels.add(l);
      priorities.add(t.priority ?? "none");
      for (const c of t.components) components.add(c);
      for (const v of t.fixVersions) versions.add(v);
      if (t.sprint) sprints.add(t.sprint.name);
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
      components: plain(components),
      versions: plain(versions),
      sprints: plain(sprints),
      epics: [...epics.sort(byLabel), { value: "none", label: "Không thuộc Epic" }],
    };
  }, [tasks]);

  const mine = filter.people.has(myAccountId);
  const filtering = isTaskFiltering(filter);

  // The two single-click toggles read at a glance (icon + is-on tint); the
  // value pickers that follow all share the same "dropdown" shape, so the bar
  // scans as two distinct groups instead of one undifferentiated row.
  const hasPickers = has("people") || has("statuses") || has("types") || has("epics") || has("labels") || has("priorities") || has("components") || has("versions") || has("sprints");

  return (
    <div className="tf-bar">
      {leading}
      {has("people") && (
        <button
          type="button"
          className={`tf-btn${mine ? " is-on" : ""}`}
          onClick={() => onChange({ ...filter, people: toggled(filter.people, myAccountId) })}
          title="Chỉ các công việc giao cho tôi"
        >
          <FbIcon name="user" />
          Của tôi
        </button>
      )}
      {has("overdue") && (
        <button
          type="button"
          className={`tf-btn${filter.onlyOverdue ? " is-on" : ""}`}
          onClick={() => onChange({ ...filter, onlyOverdue: !filter.onlyOverdue })}
          title="Quá hạn và chưa xong"
        >
          <FbIcon name="alert" />
          Quá hạn
        </button>
      )}
      {(has("people") || has("overdue")) && hasPickers && <span className="tf-divider" aria-hidden="true" />}
      {has("people") && (
        <MultiSelect
          label="Người phụ trách"
          options={options.people}
          selected={filter.people}
          onChange={(people) => onChange({ ...filter, people })}
        />
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
      {has("components") && options.components.length > 0 && (
        <MultiSelect
          label="Thành phần"
          options={options.components}
          selected={filter.components}
          onChange={(components) => onChange({ ...filter, components })}
        />
      )}
      {has("versions") && options.versions.length > 0 && (
        <MultiSelect
          label="Phiên bản"
          options={options.versions}
          selected={filter.versions}
          onChange={(versions) => onChange({ ...filter, versions })}
        />
      )}
      {has("sprints") && options.sprints.length > 0 && (
        <MultiSelect
          label="Sprint"
          options={options.sprints}
          selected={filter.sprints}
          onChange={(sprints) => onChange({ ...filter, sprints })}
        />
      )}
      {jql && (
        <button
          type="button"
          className={`tf-btn${filter.jql ? " is-on" : ""}`}
          onClick={() => setJqlOpen((v) => !v)}
          aria-expanded={jqlOpen}
          title="Lọc bằng JQL — Jira tự chạy câu truy vấn và chỉ trả những việc bạn được xem"
        >
          JQL
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
      {jql && jqlOpen && (
        <form
          className="tf-jql"
          onSubmit={(e) => {
            e.preventDefault();
            if (jqlDraft.trim()) jql.onRun(jqlDraft.trim());
          }}
        >
          <input
            value={jqlDraft}
            onChange={(e) => setJqlDraft(e.target.value)}
            placeholder='JQL, ví dụ: assignee = currentUser() AND status != Done'
            spellCheck={false}
            aria-label="Truy vấn JQL"
          />
          <button type="submit" disabled={!jqlDraft.trim() || jql.state.running}>
            {jql.state.running ? "Đang chạy…" : "Chạy"}
          </button>
          {filter.jql && (
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                setJqlDraft("");
                jql.onClear();
              }}
            >
              Bỏ JQL
            </button>
          )}
          {jql.state.error && <span className="tf-jql-error">{jql.state.error}</span>}
          {!jql.state.error && filter.jql && jql.state.count !== null && (
            <span className="tf-jql-note">
              Jira trả {jql.state.count} việc trong dự án{jql.state.truncated ? " (đã cắt ở mức tối đa)" : ""}
            </span>
          )}
        </form>
      )}
    </div>
  );
}
