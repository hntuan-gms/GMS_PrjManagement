import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { priorityRank, summarize } from "../boardModel";
import { EMPTY_TASK_FILTER, facetCount, isTaskFiltering, type TaskFilter } from "../taskFilter";
import type { Task } from "../types";
import { Icon, type IconName } from "./Icons";
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
  people: "Người",
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

export interface QuickToggle {
  key: string;
  label: string;
  icon: IconName;
  on: boolean;
  onToggle: () => void;
  title?: string;
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
  /** Rendered before everything else in the row: which board, which sprint view (the Bảng tab's chrome). */
  lead?: ReactNode;
  /** Rendered after the search box — the saved-filter menu. */
  leading?: ReactNode;
  /** More quick filters, after "Quá hạn" (the Gantt's "Chưa có ngày"). */
  extras?: ReactNode;
  /**
   * Switches at the top of the "Bộ lọc" panel, beside "Của tôi" and "Quá hạn" (the Gantt's "Chưa có ngày" and
   * "Trễ SLA", the board's "Bị chặn"). Each one that is on is a chip, so nothing hides in a closed panel.
   */
  quick?: QuickToggle[];
  /** Right-hand end of the row: whatever the view itself needs (zoom, display, import/export). */
  trailing?: ReactNode;
  /** Adds the free-text box that narrows `filter.text`. */
  showSearch?: boolean;
  /** Jira's wording for the box on this screen: "Search list", "Search board", "Search backlog". */
  searchPlaceholder?: string;
  /** Extra class on the row, for callers (and tests) that name it. */
  className?: string;
  jql?: JqlControl;
  /** Class and ref for the search box itself (the board's "/" shortcut and its tests find it there). */
  searchInputClassName?: string;
  searchInputRef?: Ref<HTMLInputElement>;
  /** What the "12/80" counter counts; "việc" unless the view says otherwise (the board's "thẻ"). */
  countLabel?: string;
  /** More sections at the foot of the "Bộ lọc" panel, for what only one view has (the board's own quick filters). */
  panelExtras?: ReactNode;
  /** How many of those are switched on: they light the button and count in its badge. */
  panelExtrasActive?: number;
  /** Something outside `filter` is narrowing the view too, so the chip line shows (the board's "Bị chặn"). */
  extraActive?: boolean;
  /** Chips for that outside narrowing, shown with the facet chips. */
  activeExtras?: ReactNode;
  /** Also called by "Xoá lọc", to reset what lives outside `filter`. */
  onClearExtras?: () => void;
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
  allLabel,
  options,
  selected,
  onChange,
}: {
  label: string;
  /** With it the button reads "Loại: Tất cả" while nothing is picked, like the selects beside it. */
  allLabel?: string;
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
        {allLabel ? `${label}: ${selected.size > 0 ? selected.size : allLabel}` : `${label}${selected.size > 0 ? ` (${selected.size})` : ""}`}
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

/**
 * The body of a "Bộ lọc" panel: one collapsible section per facet, each a checklist.
 * Shared by the Gantt's filter bar and the board's so the two panels cannot drift; the
 * open section is controlled by the caller so it survives the panel being closed.
 */
export function FacetAccordion({
  facets,
  openKey,
  onOpenChange,
  onChange,
}: {
  facets: { key: string; label: string; options: Option[]; selected: Set<string> }[];
  openKey: string | null;
  onOpenChange: (key: string | null) => void;
  onChange: (key: string, next: Set<string>) => void;
}) {
  return (
    <>
      {facets.map(({ key, label, options, selected }) => {
        const expanded = openKey === key;
        return (
          <div key={key} className={`tf-facet${expanded ? " is-open" : ""}`}>
            <button
              type="button"
              className="tf-facet-head"
              aria-expanded={expanded}
              onClick={() => onOpenChange(expanded ? null : key)}
            >
              <span className="tf-facet-name">{label}</span>
              {selected.size > 0 && <span className="tf-badge">{selected.size}</span>}
              <Icon name="chevronDown" size={12} className="caret" />
            </button>
            {expanded && (
              <div className="tf-facet-body">
                {options.length === 0 ? (
                  <div className="tf-empty">Chưa có giá trị nào.</div>
                ) : (
                  options.map((o) => (
                    <label key={o.value} className="col-chooser-item">
                      <input type="checkbox" checked={selected.has(o.value)} onChange={() => onChange(key, toggled(selected, o.value))} />
                      <span className="tf-item-label" title={o.label}>
                        {o.label}
                      </span>
                    </label>
                  ))
                )}
                {selected.size > 0 && (
                  <button type="button" className="text-btn tf-facet-reset" onClick={() => onChange(key, new Set())}>
                    Bỏ chọn
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
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
  lead,
  leading,
  extras,
  quick = [],
  trailing,
  showSearch,
  searchPlaceholder = "Search",
  className,
  jql,
  searchInputClassName,
  searchInputRef,
  countLabel = "việc",
  panelExtras,
  panelExtrasActive = 0,
  extraActive,
  activeExtras,
  onClearExtras,
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
  // "Của tôi" and "Quá hạn" lead; the view's own switches follow. All live in the panel, as chips while on.
  const switches: QuickToggle[] = [
    ...(has("people")
      ? [{ key: "mine", label: "Của tôi", icon: "user" as IconName, on: mine, onToggle: () => onChange({ ...filter, people: toggled(filter.people, myAccountId) }), title: "Việc của tôi (M)" }]
      : []),
    ...(has("overdue")
      ? [{ key: "overdue", label: "Quá hạn", icon: "alert" as IconName, on: filter.onlyOverdue, onToggle: () => onChange({ ...filter, onlyOverdue: !filter.onlyOverdue }), title: "Quá hạn và chưa xong (O)" }]
      : []),
    ...quick,
  ];
  const filtering = isTaskFiltering(filter) || !!extraActive || switches.some((q) => q.on);

  // Components, versions and sprints only earn a place once the project uses them.
  const shown = SET_FACETS.filter((f) => has(f) && (!["components", "versions", "sprints"].includes(f) || options[f].length > 0));
  const activeCount = shown.filter((f) => filter[f].size > 0).length + panelExtrasActive + switches.filter((q) => q.on).length;

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
          {lead}
          {showSearch && (
            <div className="tf-search">
              <Icon name="search" size={14} className="tf-search-icon" />
              <input
                ref={searchInputRef}
                className={searchInputClassName}
                type="search"
                value={filter.text}
                onChange={(e) => onChange({ ...filter, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Escape") onChange({ ...filter, text: "" });
                }}
                placeholder={searchPlaceholder}
                aria-label="Tìm việc"
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
                  title="Lọc bằng JQL"
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
                        placeholder='JQL, e.g. assignee = currentUser() AND status != Done'
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
          {extras}
          {(shown.length > 0 || panelExtras || switches.length > 0) && (
            <Popover
              className="tf-btn tf-add"
              caret={false}
              active={activeCount > 0}
              menuLabel="Bộ lọc"
              menuClassName="tf-menu tf-filter-menu"
              title="Bộ lọc"
              label={
                <>
                  <Icon name="plus" size={14} />
                  <span className="fb-label">Bộ lọc</span>
                  {activeCount > 0 && <span className="tf-badge">{activeCount}</span>}
                </>
              }
            >
              {switches.length > 0 && (
                <div className="tf-quick" role="group" aria-label="Lọc nhanh">
                  {switches.map((q) => (
                    <label key={q.key} className={`tf-quick-row${q.on ? " is-on" : ""}`} title={q.title}>
                      <Icon name={q.icon} size={14} />
                      <span className="tf-quick-label">{q.label}</span>
                      <input type="checkbox" role="switch" checked={q.on} onChange={q.onToggle} aria-label={q.label} />
                    </label>
                  ))}
                </div>
              )}
              <FacetAccordion
                facets={shown.map((f) => ({ key: f, label: FACET_LABEL[f], options: options[f], selected: filter[f] }))}
                openKey={openFacet}
                onOpenChange={(k) => setOpenFacet(k as SetFacet | null)}
                onChange={(k, next) => onChange({ ...filter, [k]: next })}
              />
              {panelExtras}
            </Popover>
          )}
        </div>
        {trailing && <div className="tf-right">{trailing}</div>}
      </div>
      {filtering && (
        <div className="tf-active">
          {switches.filter((q) => q.on).map((q) => (
            <span key={q.key} className="tf-chip" data-quick={q.key}>
              <span className="tf-chip-label">{q.label}</span>
              <button type="button" className="tf-chip-x" aria-label={`Bỏ lọc ${q.label}`} onClick={q.onToggle}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
          {chips.map((c) => (
            <span key={c.facet} className="tf-chip" title={c.full}>
              <span className="tf-chip-label">{c.text}</span>
              <button type="button" className="tf-chip-x" aria-label={`Bỏ lọc ${FACET_LABEL[c.facet]}`} onClick={() => clearFacet(c.facet)}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
          {activeExtras}
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
              {matched}/{total} {countLabel}
            </span>
          )}
          <button type="button" className="text-btn tf-clear" onClick={() => {
              onChange(EMPTY_TASK_FILTER);
              onClearExtras?.();
            }}>
            Xoá lọc{facetCount(filter) > 0 ? ` (${facetCount(filter)})` : ""}
          </button>
        </div>
      )}
    </>
  );
}
