import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { priorityRank } from "../boardModel";
import { EMPTY_TASK_FILTER, facetCount, isTaskFiltering, type TaskFilter } from "../taskFilter";
import type { Task } from "../types";
import { Icon } from "./Icons";
import Popover from "./Popover";

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

/** The facets that pick values from a list; "overdue" is a single switch. */
type SetFacet = Exclude<FilterFacet, "overdue">;

const SET_FACETS: SetFacet[] = ["people", "statuses", "types", "epics", "labels", "priorities", "components", "versions", "sprints"];

const FACET_LABEL: Record<SetFacet, string> = {
  people: "Người phụ trách",
  statuses: "Trạng thái",
  types: "Loại",
  epics: "Epic",
  labels: "Nhãn",
  priorities: "Ưu tiên",
  components: "Thành phần",
  versions: "Phiên bản",
  sprints: "Sprint",
};

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
  /** Which facets to offer; the resource heatmap has its own people search. */
  facets?: FilterFacet[];
  /** "12 / 80" counter shown while filtering. */
  matched?: number;
  total?: number;
  /** Rendered after the search box — the saved-filter menu. */
  leading?: ReactNode;
  /** More quick filters, after "Quá hạn" (the Gantt's "Chưa có ngày"). */
  extras?: ReactNode;
  /** Right-hand end of the row: whatever the view itself needs (zoom, display, import/export). */
  trailing?: ReactNode;
  /** Adds the free-text box that narrows `filter.text`. */
  showSearch?: boolean;
  /** Extra class on the row, for callers (and tests) that name it. */
  className?: string;
  jql?: JqlControl;
}

const ALL_FACETS: FilterFacet[] = ["people", "statuses", "types", "epics", "labels", "priorities", "components", "versions", "sprints", "overdue"];

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
        <Icon name="chevronDown" size={10} className="fb-icon" />
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

/** "A, B" for one or two values, "A, B +3" past that; the whole list goes in the title. */
function summarize(labels: string[]): string {
  return labels.length <= 2 ? labels.join(", ") : `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

/**
 * One row of controls over a task list, and — only while something is filtering — a
 * second line with the active filters as removable chips. It owns no filter state:
 * the filter lives in ProjectWorkspace so the Gantt and the resource tab narrow the
 * same set, and so a facet picked on one is still there on the other.
 *
 * The row is progressive: search, the saved views and the two instant switches are
 * always in reach; every value picker (assignee, status, type, …) hides behind one
 * "Bộ lọc" panel instead of sitting in the row as a wall of identical dropdowns.
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
  extras,
  trailing,
  showSearch,
  className,
  jql,
}: Props) {
  const has = (f: FilterFacet) => facets.includes(f);
  const [jqlOpen, setJqlOpen] = useState(false);
  const [jqlDraft, setJqlDraft] = useState(filter.jql);
  // A filter applied from elsewhere (a saved one, the assistant) carries its JQL with it.
  // Adjusted while rendering, not in an effect: React re-renders at once, with no frame
  // showing the old text.
  const [seenJql, setSeenJql] = useState(filter.jql);
  if (seenJql !== filter.jql) {
    setSeenJql(filter.jql);
    setJqlDraft(filter.jql);
  }
  const [openFacet, setOpenFacet] = useState<SetFacet | null>(null);

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
    } satisfies Record<SetFacet, Option[]>;
  }, [tasks]);

  const mine = filter.people.has(myAccountId);
  const filtering = isTaskFiltering(filter);

  // Components, versions and sprints only earn a place once the project uses them.
  const shown = SET_FACETS.filter((f) => has(f) && (!["components", "versions", "sprints"].includes(f) || options[f].length > 0));
  const activeCount = shown.filter((f) => filter[f].size > 0).length;

  function labelOf(f: SetFacet, value: string): string {
    return options[f].find((o) => o.value === value)?.label ?? value;
  }

  /** The chips: one per facet with a selection. "Của tôi" already shows as a lit switch,
   * so a people selection that is only me needs none. */
  const chips = shown.flatMap((f) => {
    const values = [...filter[f]].filter((v) => !(f === "people" && v === myAccountId));
    if (values.length === 0) return [];
    const labels = values.map((v) => labelOf(f, v));
    return [{ facet: f, text: `${FACET_LABEL[f]}: ${summarize(labels)}`, full: `${FACET_LABEL[f]}: ${labels.join(", ")}` }];
  });

  function clearFacet(f: SetFacet) {
    onChange({ ...filter, [f]: new Set(f === "people" && mine ? [myAccountId] : []) });
  }

  return (
    <>
      <div className={`tf-bar${className ? ` ${className}` : ""}`}>
        <div className="tf-left">
          {showSearch && (
            <div className="tf-search">
              <Icon name="search" size={14} className="tf-search-icon" />
              <input
                type="search"
                value={filter.text}
                onChange={(e) => onChange({ ...filter, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Escape") onChange({ ...filter, text: "" });
                }}
                placeholder="Tìm theo mã hoặc tên công việc..."
                aria-label="Tìm công việc"
              />
              {filter.text && (
                <button
                  type="button"
                  className="tf-search-clear"
                  onClick={() => onChange({ ...filter, text: "" })}
                  aria-label="Xoá tìm kiếm"
                  title="Xoá tìm kiếm"
                >
                  <Icon name="x" size={12} />
                </button>
              )}
              {jql && (
                <Popover
                  className="tf-btn tf-jql-toggle"
                  caret={false}
                  active={!!filter.jql}
                  open={jqlOpen}
                  onOpenChange={setJqlOpen}
                  menuLabel="Lọc bằng JQL"
                  menuClassName="tf-jql-menu"
                  title="Lọc bằng JQL — Jira tự chạy câu truy vấn và chỉ trả những việc bạn được xem"
                  label="JQL"
                >
                  <form
                    className="tf-jql"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (jqlDraft.trim()) jql.onRun(jqlDraft.trim());
                    }}
                  >
                    <div className="tf-jql-row">
                      <input
                        autoFocus
                        value={jqlDraft}
                        onChange={(e) => setJqlDraft(e.target.value)}
                        placeholder='JQL, ví dụ: assignee = currentUser() AND status != Done'
                        spellCheck={false}
                        aria-label="Truy vấn JQL"
                      />
                      <button type="submit" className="tf-run" disabled={!jqlDraft.trim() || jql.state.running}>
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
                    </div>
                    {jql.state.error && (
                      <span className="tf-jql-error" role="alert">
                        {jql.state.error}
                      </span>
                    )}
                    {!jql.state.error && filter.jql && jql.state.count !== null && (
                      <span className="tf-jql-note">
                        Jira trả {jql.state.count} việc trong dự án{jql.state.truncated ? " (đã cắt ở mức tối đa)" : ""}
                      </span>
                    )}
                  </form>
                </Popover>
              )}
            </div>
          )}
          {leading}
          {has("people") && (
            <button
              type="button"
              className={`tf-btn${mine ? " is-on" : ""}`}
              aria-pressed={mine}
              onClick={() => onChange({ ...filter, people: toggled(filter.people, myAccountId) })}
              title="Chỉ các công việc giao cho tôi"
            >
              <Icon name="user" size={14} />
              Của tôi
            </button>
          )}
          {has("overdue") && (
            <button
              type="button"
              className={`tf-btn${filter.onlyOverdue ? " is-on" : ""}`}
              aria-pressed={filter.onlyOverdue}
              onClick={() => onChange({ ...filter, onlyOverdue: !filter.onlyOverdue })}
              title="Quá hạn và chưa xong"
            >
              <Icon name="alert" size={14} />
              Quá hạn
            </button>
          )}
          {extras}
          {shown.length > 0 && (
            <Popover
              className="tf-btn tf-add"
              caret={false}
              active={activeCount > 0}
              menuLabel="Bộ lọc"
              menuClassName="tf-menu tf-filter-menu"
              title="Lọc theo người phụ trách, trạng thái, loại, Epic, nhãn, ưu tiên…"
              label={
                <>
                  <Icon name="plus" size={14} />
                  Bộ lọc
                  {activeCount > 0 && <span className="tf-badge">{activeCount}</span>}
                </>
              }
            >
              {shown.map((f) => {
                const expanded = openFacet === f;
                const selected = filter[f];
                const list = options[f];
                return (
                  <div key={f} className={`tf-facet${expanded ? " is-open" : ""}`}>
                    <button
                      type="button"
                      className="tf-facet-head"
                      aria-expanded={expanded}
                      onClick={() => setOpenFacet(expanded ? null : f)}
                    >
                      <span className="tf-facet-name">{FACET_LABEL[f]}</span>
                      {selected.size > 0 && <span className="tf-badge">{selected.size}</span>}
                      <Icon name="chevronDown" size={12} className="caret" />
                    </button>
                    {expanded && (
                      <div className="tf-facet-body">
                        {list.length === 0 ? (
                          <div className="tf-empty">Chưa có giá trị nào.</div>
                        ) : (
                          list.map((o) => (
                            <label key={o.value} className="col-chooser-item">
                              <input
                                type="checkbox"
                                checked={selected.has(o.value)}
                                onChange={() => onChange({ ...filter, [f]: toggled(selected, o.value) })}
                              />
                              <span className="tf-item-label" title={o.label}>
                                {o.label}
                              </span>
                            </label>
                          ))
                        )}
                        {selected.size > 0 && (
                          <button type="button" className="text-btn tf-facet-reset" onClick={() => onChange({ ...filter, [f]: new Set() })}>
                            Bỏ chọn
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </Popover>
          )}
        </div>
        {trailing && <div className="tf-right">{trailing}</div>}
      </div>
      {filtering && (
        <div className="tf-active">
          {chips.map((c) => (
            <span key={c.facet} className="tf-chip" title={c.full}>
              <span className="tf-chip-label">{c.text}</span>
              <button type="button" className="tf-chip-x" aria-label={`Bỏ lọc ${FACET_LABEL[c.facet]}`} onClick={() => clearFacet(c.facet)}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
          {jql && filter.jql && (
            <span className={`tf-chip${jql.state.error ? " is-error" : ""}`} title={jql.state.error ?? `JQL: ${filter.jql}`}>
              <button type="button" className="tf-chip-label tf-chip-open" onClick={() => setJqlOpen(true)}>
                {jql.state.error && <Icon name="alert" size={12} />}
                JQL: {filter.jql}
              </button>
              <button
                type="button"
                className="tf-chip-x"
                aria-label="Bỏ JQL"
                onClick={() => {
                  setJqlDraft("");
                  jql.onClear();
                }}
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          )}
          {matched !== undefined && total !== undefined && (
            <span className="tf-count" role="status" aria-atomic="true">
              {matched}/{total} công việc
            </span>
          )}
          <button type="button" className="text-btn tf-clear" onClick={() => onChange(EMPTY_TASK_FILTER)}>
            Xoá lọc{facetCount(filter) > 0 ? ` (${facetCount(filter)})` : ""}
          </button>
        </div>
      )}
    </>
  );
}
