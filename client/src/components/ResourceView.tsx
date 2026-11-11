import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Spinner from "./Spinner";
import { assignHints } from "../assignHints";
import { monthLabels, shortRange, weekColumnLabel } from "../dateLabels";
import { buildResourceLoad, firstOverloadedDate, loadInRange, overloadedDaysIn, todayIso, type Granularity, type PersonLoad } from "../resourceAllocation";
import {
  columnSpans,
  currentPreset,
  filterPeople,
  sortPeople,
  PEOPLE_SORT_LABEL,
  type PeopleSort,
  overloadWindow,
  pct,
  peopleCounts,
  placeBar,
  RANGE_PRESETS,
  rangeForPreset,
  SOON_LABEL,
  taskBarDates,
  type ColumnSpan,
  type PeopleView,
  type RangePresetId,
} from "../resourceColumns";
import { toast } from "../toast";
import { formatDate, monthLabel, scrubExtent, type MonthLabel } from "../resourceTimeline";
import { DEFAULT_PIXELS_PER_DAY, pickScale, zoomByWheel } from "../timeZoom";
import type { JiraUser, ResourceAbsence, ResourceProfile, ResourcePool, Task } from "../types";
import { csvName, downloadCsv } from "../csv";
import { buildEpicIndex, isTaskFiltering, matchesTaskFilter, type TaskFilter } from "../taskFilter";
import FilterBar from "./FilterBar";
import DateField from "./DateField";
import { Icon } from "./Icons";
import InfoTip from "./InfoTip";
import Popover from "./Popover";
import ResourceModes from "./ResourceModes";
import type { ResourceMode } from "../lenses";
import ResourcePersonBlock from "./ResourcePersonBlock";
import TodayInCell from "./TodayInCell";
import ResourceProfileDialog from "./ResourceProfileDialog";
import ResourceUnassigned, { type DragState } from "./ResourceUnassigned";
import SavedFilterMenu from "./SavedFilterMenu";
import SkillMatrixView from "./SkillMatrixView";
import { useHeldHours } from "./heldHoursContext";
import { useWorkCalendar } from "./workCalendarContext";
import { dayKind, dayLabel } from "../workCalendar";

interface Props {
  tasks: Task[];
  users: JiraUser[];
  /** Capacity and absences, fetched once by the workspace. null while loading. */
  pool: ResourcePool | null;
  poolError: string | null;
  onPoolChange: (next: ResourcePool) => void;
  /** null as accountId means "take it off whoever holds it". */
  onAssign: (taskId: string, accountId: string | null) => void;
  onOpenEdit: (task: Task) => void;
  /** Shared with the Gantt. Its `people` and `text` facets are ignored here. */
  filter: TaskFilter;
  onFilterChange: (f: TaskFilter) => void;
  myAccountId: string;
  /** Issue keys Jira returned for the filter's JQL (null until they arrive). */
  jqlKeys?: Set<string> | null;
  /** Which of the lens's modes is showing. */
  mode: "load" | "skills";
  onModeChange: (m: ResourceMode) => void;
  /** Open this person and bring their first overloaded day into view (the report's "Xem lịch …"); a new nonce asks again. */
  focusPerson?: { accountId: string; nonce: number } | null;
}

/** Sentinel for the "remove from whoever holds it" drop zone. */
const UNASSIGNED_ZONE = "__unassigned__";

const GRANULARITIES: Array<{ value: Granularity; label: string }> = [
  { value: "day", label: "Ngày" },
  { value: "week", label: "Tuần" },
  { value: "month", label: "Tháng" },
];

const LEGEND: Array<{ band: string; short: string; title: string }> = [
  { band: "light", short: "<50%", title: "Dưới 50% công suất" },
  { band: "healthy", short: "50–100%", title: "Hợp lý: từ 50% đến 100% công suất" },
  { band: "over", short: ">100%", title: "Quá tải: trên 100% công suất" },
  {
    band: "off",
    short: "Ngày nghỉ",
    title:
      "Cuối tuần, ngày lễ (theo Lịch làm việc của dự án) hoặc ngày nghỉ phép (sọc xám). Sọc đỏ: có việc bị xếp vào ngày nghỉ — không ai làm được. Ô trống: chưa có việc.",
  },
];

/**
 * The resource tab: who is overloaded, when, and by how much.
 *
 * Load is computed here from tasks the workspace already holds (see
 * resourceAllocation.ts), so dragging a bar in the Gantt recolours this tab on
 * the same render rather than after a round trip. Only the two things Jira has
 * no field for — capacity and absence — are fetched.
 *
 * One row of chrome and then the table: view, search, who is shown (the counts are the KPIs), filters |
 * work nobody owns, columns, window, and a "⋯" with sort, legend and export. A person opens *inside* the
 * table (their tasks on the same date columns); what is edited about them — role, hours, leave,
 * skills — is a slide-over; work nobody owns is a floating card, closed until asked for.
 */
export default function ResourceView({
  tasks,
  users,
  pool,
  poolError,
  onPoolChange,
  onAssign,
  onOpenEdit,
  filter,
  jqlKeys,
  onFilterChange,
  myAccountId,
  mode,
  onModeChange,
  focusPerson = null,
}: Props) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [profileId, setProfileId] = useState<string | null>(null);
  // Everyone on the project by default. Showing only people who already hold
  // dated work makes the tab go blank on a project nobody has assigned yet,
  // which reads as "broken" rather than as "nothing is assigned" — and the
  // whole point of a resource tab is to see who is free.
  const [peopleView, setPeopleView] = useState<PeopleView>("all");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [unassignedOpen, setUnassignedOpen] = useState(false);
  // The unassigned row under the pointer: its dates are marked on the people grid, to see who is free.
  const [hoverTask, setHoverTask] = useState<Task | null>(null);
  // The one zoom variable (timeZoom.ts): which of day / week / month columns show, and how wide they
  // are, both come from it — the same gesture and the same mechanism as the Gantt's.
  const [pixelsPerDay, setPixelsPerDay] = useState(DEFAULT_PIXELS_PER_DAY.week);
  const scale = pickScale(pixelsPerDay);
  const unassignedBtn = useRef<HTMLButtonElement>(null);
  const unassignedId = useId();

  const today = useMemo(() => todayIso(), []);

  // The table draws the whole project and scrolls, like the Gantt: nothing is cut off by a window
  // that has to be slid, so a person's tasks are all there. A window only exists if one is picked
  // from the "Khoảng" menu, and even then no task row is dropped (see PersonTasks).
  const span = useMemo(() => range ?? scrubExtent(tasks, today, { from: today, to: today }), [range, tasks, today]);

  // The heatmap has its own member search, and a person picked on the Gantt would
  // blank everyone else's rows here — so only the task facets apply.
  const taskFacets = useMemo<TaskFilter>(() => ({ ...filter, text: "", people: new Set() }), [filter]);
  const filtering = isTaskFiltering(taskFacets);
  // The project's working calendar: a holiday has no capacity for anyone, a make-up Saturday has a day's.
  const calendar = useWorkCalendar();
  const filteredTasks = useMemo(() => {
    if (!filtering) return tasks;
    const ctx = { today, epicOf: buildEpicIndex(tasks), jqlKeys };
    return tasks.filter((t) => matchesTaskFilter(t, taskFacets, ctx));
  }, [tasks, taskFacets, filtering, today, jqlKeys]);

  // Always everyone: "Có việc" and "Đang quá tải" are pills over this list, not a different
  // computation, so the counts on the pills and the average beside them stay one set of numbers.
  const load = useMemo(
    () =>
      buildResourceLoad({
        tasks: filteredTasks,
        users,
        profiles: pool?.profiles ?? [],
        absences: pool?.absences ?? [],
        defaultCapacityHours: pool?.defaultCapacityHours,
        from: span.from,
        to: span.to,
        includeIdle: true,
        calendar,
      }),
    [filteredTasks, users, pool, span, calendar]
  );

  const granularity: Granularity = scale.granularity;
  const spans = useMemo(() => columnSpans(load.dates, granularity), [load.dates, granularity]);
  // One window of "now" for every figure about load: the pill, the badge by a name, the opened summary and the
  // profile's header all count today and the 13 days after it (see SOON_LABEL).
  const soonWindow = useMemo(() => overloadWindow(today), [today]);
  const soonDays = useMemo(
    () => new Map(load.people.map((p) => [p.accountId, overloadedDaysIn(p.days, soonWindow.from, soonWindow.to)])),
    [load.people, soonWindow]
  );
  const isOver = useCallback((p: { accountId: string }) => (soonDays.get(p.accountId) ?? 0) > 0, [soonDays]);
  const counts = useMemo(() => peopleCounts(load.people, isOver), [load.people, isOver]);

  const [peopleSort, setPeopleSortState] = useState<PeopleSort>(() => {
    try {
      const v = localStorage.getItem("gms.rv.sort");
      return v && v in PEOPLE_SORT_LABEL ? (v as PeopleSort) : "load";
    } catch {
      return "load";
    }
  });
  const setPeopleSort = (v: PeopleSort) => {
    setPeopleSortState(v);
    try {
      localStorage.setItem("gms.rv.sort", v);
    } catch {
      /* private mode */
    }
  };
  const visiblePeople = useMemo(() => {
    let base = sortPeople(filterPeople(load.people, peopleView, isOver), peopleSort);
    // "Quá tải trước" follows the same window as the badge: whoever is over in the next two weeks goes first.
    if (peopleSort === "load") base = [...base].sort((a, b) => (soonDays.get(b.accountId) ?? 0) - (soonDays.get(a.accountId) ?? 0));
    const needle = query.trim().toLowerCase();
    if (!needle) return base;
    return base.filter(
      (p) => p.displayName.toLowerCase().includes(needle) || (p.role ?? "").toLowerCase().includes(needle)
    );
  }, [load.people, peopleView, query, peopleSort, isOver, soonDays]);

  const profilePerson = load.people.find((p) => p.accountId === profileId) ?? null;

  const hoverBand = useMemo(() => {
    const dates = hoverTask ? taskBarDates(hoverTask) : null;
    return dates ? placeBar(spans, dates.start, dates.end) : null;
  }, [hoverTask, spans]);

  const latestAssign = useRef(onAssign);
  latestAssign.current = onAssign;
  /**
   * Every assignment from this tab goes through here. It is not blocked and not asked about (as with the
   * assistant's auto-assign, nobody is ruled out for being busy), but handing work to someone who is
   * already full inside its dates says so, with the one click that undoes it.
   */
  const heldHours = useHeldHours();
  function assign(taskId: string, accountId: string | null) {
    const t = tasks.find((x) => x.id === taskId);
    const previous = t?.assigneeAccountId ?? null;
    let note: string | null = null;
    if (t && accountId && accountId !== previous) {
      const who = users.find((u) => u.accountId === accountId) ?? load.people.find((p) => p.accountId === accountId);
      const h = who ? assignHints(t, [{ accountId, displayName: who.displayName, avatarUrl: null }], load, calendar, heldHours)[0] : undefined;
      const dates = taskBarDates(t);
      if (who && h && h.ranged && h.conflictDays > 0 && dates) {
        note = `${who.displayName} đã kín ${h.conflictDays} ngày trong ${shortRange(dates.start, dates.end)}`;
      }
    }
    onAssign(taskId, accountId);
    // The undo runs later, after the workspace has taken the assignment: the handler of *that* render sees the
    // task as assigned, where this render's would still think it is not and do nothing.
    if (note) toast(note, { action: { label: "Hoàn tác", run: () => latestAssign.current(taskId, previous) } });
  }

  function exportCsv() {
    const header = ["Thành viên", "Vai trò", "Giờ/ngày", ...load.dates];
    const rows = visiblePeople.map((p) => [
      p.displayName,
      p.role,
      p.capacityHoursPerDay,
      ...p.days.map((d) => Math.round(d.allocatedHours * 10) / 10),
    ]);
    downloadCsv(csvName("nguon-luc", today), [header, ...rows]);
  }

  /* ---- scrolling and zoom: the table's own scrollbars, Ctrl+wheel for the time axis ---- */
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const attachScroll = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    setScrollEl(el);
  }, []);
  // Which part of the time axis sits under the pointer when a zoom starts, so it is still there after.
  const anchor = useRef<{ frac: number; x: number } | null>(null);
  const latest = useRef<{ spans: ColumnSpan[]; today: string; cell: number }>({ spans, today, cell: scale.cellWidth });
  useLayoutEffect(() => {
    latest.current = { spans, today, cell: scale.cellWidth };
  });

  const nameWidth = (sc: HTMLElement) => sc.querySelector<HTMLElement>(".rv-name")?.offsetWidth ?? 0;
  const anchorAt = useCallback((sc: HTMLElement, x: number) => {
    const nameW = nameWidth(sc);
    const trackW = sc.scrollWidth - nameW;
    if (trackW > 0) anchor.current = { frac: (sc.scrollLeft + x - nameW) / trackW, x };
  }, []);

  /** Brings a date to just right of the name column. */
  const scrollToDate = useCallback((sc: HTMLElement, iso: string) => {
    const { spans: cols, cell } = latest.current;
    const place = placeBar(cols, iso, iso);
    if (!place) return;
    const trackW = sc.scrollWidth - nameWidth(sc);
    sc.scrollLeft = Math.max(0, (place.left / cols.length) * trackW - 2 * cell);
  }, []);

  // Ctrl+wheel / pinch zooms the time axis only. Native and non-passive (React's onWheel is passive,
  // where preventDefault is ignored and the browser would zoom the page); everything else — a plain
  // wheel, Shift+wheel, the scrollbars — is the browser's own scrolling, rows and columns alike.
  useEffect(() => {
    if (!scrollEl) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const sc = scrollEl!;
      anchorAt(sc, Math.max(nameWidth(sc), e.clientX - sc.getBoundingClientRect().left));
      setPixelsPerDay((prev) => zoomByWheel(prev, e.deltaY));
    }
    scrollEl.addEventListener("wheel", onWheel, { passive: false });
    return () => scrollEl.removeEventListener("wheel", onWheel);
  }, [scrollEl, anchorAt]);

  // Applied in the commit that changed the column widths, so the axis never flashes at the old position.
  useLayoutEffect(() => {
    const a = anchor.current;
    const sc = scrollRef.current;
    if (!a || !sc) return;
    anchor.current = null;
    const nameW = nameWidth(sc);
    sc.scrollLeft = a.frac * (sc.scrollWidth - nameW) + nameW - a.x;
  }, [pixelsPerDay]);

  // Opens on today, not on the project's first day.
  useEffect(() => {
    if (scrollEl) scrollToDate(scrollEl, latest.current.today);
  }, [scrollEl, scrollToDate]);

  function chooseGranularity(g: Granularity) {
    if (scrollEl) anchorAt(scrollEl, nameWidth(scrollEl) + (scrollEl.clientWidth - nameWidth(scrollEl)) / 2);
    setPixelsPerDay(DEFAULT_PIXELS_PER_DAY[g]);
  }

  const focusNonce = useRef(0);
  useEffect(() => {
    if (!focusPerson || focusPerson.nonce === focusNonce.current) return;
    // The scroll box exists a frame after the tab mounts.
    const id = requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      focusNonce.current = focusPerson.nonce;
      jumpToOverload(focusPerson.accountId);
    });
    return () => cancelAnimationFrame(id);
    // jumpToOverload reads the latest load on its own; only a new request should run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPerson, pool, scrollEl]);

  /** The red badge by a name: open the person and bring their first over-capacity day (from today on, else the first at all) into view. */
  function jumpToOverload(accountId: string) {
    const p = load.people.find((x) => x.accountId === accountId);
    setExpanded((cur) => (cur.has(accountId) ? cur : new Set(cur).add(accountId)));
    if (!p) return;
    const first = firstOverloadedDate(p.days, today) ?? firstOverloadedDate(p.days, span.from);
    const sc = scrollRef.current;
    if (!sc) return;
    if (first) scrollToDate(sc, first);
    // Vertical after the row has opened: the person's row goes just under the sticky header.
    requestAnimationFrame(() => {
      const block = sc.querySelector<HTMLElement>(`[data-person="${CSS.escape(accountId)}"]`);
      const head = sc.querySelector<HTMLElement>(".rv-header");
      if (!block) return;
      sc.scrollTop += block.getBoundingClientRect().top - sc.getBoundingClientRect().top - (head?.offsetHeight ?? 0);
    });
  }

  const skillSuggestions = useMemo(
    () => [...new Set((pool?.profiles ?? []).flatMap((p) => p.skills))].sort((a, b) => a.localeCompare(b, "vi")),
    [pool]
  );

  function applyPreset(id: RangePresetId) {
    setRange(rangeForPreset(id, span, today, tasks));
  }
  const activePreset = currentPreset(range, today, tasks);
  const presetLabel = RANGE_PRESETS.find((p) => p.id === activePreset)?.label ?? "Tuỳ chọn";

  // Saves are applied to the cached pool rather than triggering a refetch: the
  // response is the authoritative row, and a round trip here would make the
  // heatmap flicker back to the old colour before settling.
  function upsertProfile(profile: ResourceProfile) {
    if (!pool) return;
    const others = pool.profiles.filter((p) => p.accountId !== profile.accountId);
    onPoolChange({ ...pool, profiles: [...others, profile] });
  }

  function replaceAbsence(absence: ResourceAbsence) {
    if (!pool) return;
    onPoolChange({ ...pool, absences: pool.absences.map((a) => (a.id === absence.id ? absence : a)) });
  }

  function addAbsence(absence: ResourceAbsence) {
    if (!pool) return;
    onPoolChange({ ...pool, absences: [...pool.absences, absence] });
  }

  function removeAbsence(id: string) {
    if (!pool) return;
    onPoolChange({ ...pool, absences: pool.absences.filter((a) => a.id !== id) });
  }

  function toggleExpanded(accountId: string) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (!next.delete(accountId)) next.add(accountId);
      return next;
    });
  }

  function beginDrag(task: Task) {
    setDrag({ taskId: task.id, summary: task.summary, fromAccountId: task.assigneeAccountId });
  }

  function endDrag() {
    setDrag(null);
    setDropTarget(null);
  }

  /** A drop only counts when it would actually change who holds the task. */
  function canDropOn(accountId: string | null): boolean {
    return drag !== null && drag.fromAccountId !== accountId;
  }

  function dropOn(accountId: string | null) {
    if (drag && canDropOn(accountId)) assign(drag.taskId, accountId);
    endDrag();
  }

  const scopes: Array<{ view: PeopleView; label: string; n: number; tone?: "danger" }> = [
    { view: "all", label: "Tất cả", n: counts.all },
    { view: "busy", label: "Có việc", n: counts.busy },
    { view: "over", label: "Quá tải", n: counts.over, tone: counts.over > 0 ? "danger" : undefined },
  ];

  return (
    <div className={`resource-view${mode === "load" ? " is-grid" : ""}`} onDragEnd={endDrag}>
      <FilterBar
        tasks={tasks}
        filter={taskFacets}
        onChange={(f) => onFilterChange({ ...filter, ...f, text: filter.text, people: filter.people })}
        myAccountId={myAccountId}
        // Filtering work means nothing on the skills matrix: its row carries only the mode switch.
        facets={mode === "load" ? ["statuses", "types", "epics", "labels", "priorities", "overdue"] : []}
        matched={filteredTasks.length}
        total={tasks.length}
        leading={
          <>
            <ResourceModes mode={mode} onChange={onModeChange} />
            {mode === "load" && (
              <div className="tf-search rv-member-search">
                <Icon name="search" size={14} className="tf-search-icon" />
                <input
                  type="search"
                  className="rv-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setQuery("")}
                  placeholder="Search people"
                  aria-label="Tìm thành viên"
                />
              </div>
            )}
            {/* Who is shown. The counts are the at-a-glance numbers (the overload one is red when it is not zero),
                so this is one click and always visible, not a menu. */}
            {mode === "load" && (
              <div className="seg-group rv-scope" role="group" aria-label="Lọc thành viên">
                {scopes.map((p) => (
                  <button
                    key={p.view}
                    type="button"
                    data-view={p.view}
                    className={`${peopleView === p.view ? "active" : ""}${p.tone ? " has-over" : ""}`}
                    aria-pressed={peopleView === p.view}
                    title={p.view === "over" ? `Quá công suất trong ${SOON_LABEL}` : undefined}
                    onClick={() => setPeopleView(p.view)}
                  >
                    {p.label}
                    {p.n > 0 && <span className="rv-scope-n">{p.n}</span>}
                  </button>
                ))}
              </div>
            )}
            {/* Applies the whole shared filter, people included, so the Gantt shows
                the same saved view when you switch back. */}
            {mode === "load" && <SavedFilterMenu filter={filter} onApply={onFilterChange} myAccountId={myAccountId} />}
          </>
        }
        trailing={
          mode === "load" ? (
            <div className="rv-range">
              {/* Work nobody owns. At the right: opened from the left its card floated over the columns around today. */}
              <button
                ref={unassignedBtn}
                type="button"
                className={`rv-pill rv-pill-warn rv-un-pill${unassignedOpen ? " is-on" : ""}${load.unassigned.length === 0 ? " is-empty" : ""}`}
                aria-expanded={unassignedOpen}
                aria-controls={unassignedId}
                onClick={() => setUnassignedOpen((v) => !v)}
                title="Việc chưa giao"
              >
                <Icon name="alert" size={13} />
                {load.unassigned.length} chưa gán
              </button>
              <div
                className="seg-group rv-granularity"
                role="group"
                aria-label="Chia theo"
                title="Mỗi cột là một ngày, tuần hay tháng. Ctrl + cuộn (hoặc chụm hai ngón) để phóng to / thu nhỏ trục thời gian."
              >
                {GRANULARITIES.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    data-g={g.value}
                    className={granularity === g.value ? "active" : ""}
                    aria-pressed={granularity === g.value}
                    onClick={() => chooseGranularity(g.value)}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="tb-btn"
                onClick={() => scrollEl && scrollToDate(scrollEl, today)}
                title="Cuộn bảng tới ngày hôm nay"
              >
                Hôm nay
              </button>
              <Popover
                className="tf-btn rv-preset"
                align="end"
                menuLabel="Khoảng thời gian"
                menuClassName="rv-range-menu"
                title={`Khoảng thời gian: ${presetLabel}`}
                // The default ("Theo dự án") is just the icon: it is what everyone has until they narrow the axis,
                // and the label is what the row had no room for at 1280px.
                label={
                  <>
                    <Icon name="calendar" size={14} />
                    {activePreset !== "project" && presetLabel}
                  </>
                }
              >
                {({ close }) => (
                  <>
                    {RANGE_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={activePreset === p.id}
                        className="menu-item rv-preset-item"
                        onClick={() => {
                          close();
                          applyPreset(p.id);
                        }}
                      >
                        <span className="rv-menu-check">{activePreset === p.id && <Icon name="check" size={14} />}</span>
                        {p.label}
                      </button>
                    ))}
                    <div className="menu-sep" role="separator" />
                    <div className="rv-exact">
                      <label>
                        <span>Từ</span>
                        <DateField
                          value={span.from}
                          ariaLabel="Khoảng từ"
                          // Either end dragged past the other takes the other with it, rather than being refused.
                          onChange={(iso) => iso && setRange({ from: iso, to: iso > span.to ? iso : span.to })}
                        />
                      </label>
                      <label>
                        <span>Đến</span>
                        <DateField
                          value={span.to}
                          ariaLabel="Khoảng đến"
                          base={span.from}
                          onChange={(iso) => iso && setRange({ from: iso < span.from ? iso : span.from, to: iso })}
                        />
                      </label>
                    </div>
                  </>
                )}
              </Popover>
              <Popover
                className="tb-btn rv-more"
                role="menu"
                align="end"
                caret={false}
                menuLabel="Tuỳ chọn"
                menuClassName="rv-more-menu"
                ariaLabel="Tuỳ chọn"
                title="Sắp xếp, chú giải, xuất CSV"
                label={<Icon name="more" size={16} />}
              >
                {({ close }) => (
                  <>
                    <div className="menu-heading">Sắp xếp</div>
                    {(Object.keys(PEOPLE_SORT_LABEL) as PeopleSort[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        role="menuitem"
                        data-sort={k}
                        aria-pressed={peopleSort === k}
                        className="menu-item rv-sort-item"
                        onClick={() => {
                          close();
                          setPeopleSort(k);
                        }}
                      >
                        <span className="rv-menu-check">{peopleSort === k && <Icon name="check" size={14} />}</span>
                        {PEOPLE_SORT_LABEL[k]}
                      </button>
                    ))}
                    <div className="menu-sep" role="separator" />
                    <div className="menu-heading">Chú giải</div>
                    <div className="rv-legend" role="group" aria-label="Chú giải màu">
                      {LEGEND.map((l) => (
                        <span key={l.band} className="rv-legend-item" title={l.title}>
                          <i className={`rv-swatch band-${l.band}`}>
                            <span className="rv-sky" aria-hidden="true" />
                          </i>
                          {l.short}
                        </span>
                      ))}
                    </div>
                    <div className="menu-sep" role="separator" />
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item rv-export"
                      title="Tải giờ phân bổ từng người theo ngày về file CSV"
                      onClick={() => {
                        close();
                        exportCsv();
                      }}
                    >
                      <Icon name="download" size={14} />
                      Xuất CSV
                    </button>
                  </>
                )}
              </Popover>
            </div>
          ) : undefined
        }
      />

      {mode === "skills" && <SkillMatrixView users={users} profiles={pool?.profiles ?? []} onProfileSaved={upsertProfile} onOpenProfile={(id) => setProfileId(id)} />}
      {mode === "load" && filtering && (
        <div className="rv-notice">
          Đang lọc: mức tải bên dưới chỉ tính các việc khớp bộ lọc, không phải toàn bộ khối lượng của mỗi người.
        </div>
      )}
      {mode === "load" && (
        <>
          {poolError && (
            <div className="rv-notice">
              Không tải được công suất và lịch nghỉ ({poolError}). Bản đồ nhiệt vẫn tính theo mặc định{" "}
              {pool?.defaultCapacityHours ?? 8} giờ/ngày.
            </div>
          )}

          {visiblePeople.length === 0 ? (
            <div className="empty-state">
              {load.people.length > 0
                ? peopleView === "all"
                  ? "Không có thành viên nào khớp."
                  : "Không có thành viên nào khớp. Chọn “Tất cả” để xem toàn bộ thành viên dự án."
                : pool === null
                  ? <Spinner block />
                  : "Dự án này chưa có thành viên nào trên Jira, hoặc tài khoản của bạn không đọc được danh sách."}
            </div>
          ) : (
            <div className="rv-heatmap-scroll" ref={attachScroll}>
              <div className="rv-grid" style={{ "--cols": spans.length, "--rv-cell": `${scale.cellWidth}px` } as React.CSSProperties}>
                <HeatmapHeader
                  spans={spans}
                  granularity={granularity}
                  today={today}
                  memberNote={<MemberSourceTip pool={pool} count={load.people.length} />}
                />
                {hoverBand && (
                  <div
                    className="rv-hover-band"
                    aria-hidden="true"
                    style={{ "--from": hoverBand.left, "--len": hoverBand.width } as React.CSSProperties}
                  />
                )}
                {visiblePeople.map((person) => (
                  <ResourcePersonBlock
                    key={person.accountId}
                    person={person}
                    granularity={granularity}
                    today={today}
                    spans={spans}
                    expanded={expanded.has(person.accountId)}
                    onToggle={() => toggleExpanded(person.accountId)}
                    onOpenProfile={() => setProfileId(person.accountId)}
                    onOpenEdit={onOpenEdit}
                    people={users}
                    load={load}
                    calendar={calendar}
                    onAssign={assign}
                    overloadWindow={soonWindow}
                    onJumpOverload={() => jumpToOverload(person.accountId)}
                    onDragTask={beginDrag}
                    droppable={canDropOn(person.accountId)}
                    isDropTarget={dropTarget === person.accountId}
                    onDragOverPerson={() => setDropTarget(person.accountId)}
                    onDropOnPerson={() => dropOn(person.accountId)}
                  />
                ))}
              </div>
            </div>
          )}

          <ResourceUnassigned
            panelId={unassignedId}
            open={unassignedOpen}
            onClose={() => setUnassignedOpen(false)}
            anchorRef={unassignedBtn}
            tasks={load.unassigned}
            people={users}
            load={load}
            calendar={calendar}
            onHoverTask={setHoverTask}
            drag={drag}
            canDropUnassigned={canDropOn(null)}
            isDropTarget={dropTarget === UNASSIGNED_ZONE}
            onDragStartTask={beginDrag}
            onAssign={assign}
            onOpenEdit={onOpenEdit}
            onDragOverZone={() => setDropTarget(UNASSIGNED_ZONE)}
            onDragLeaveZone={() => setDropTarget((cur) => (cur === UNASSIGNED_ZONE ? null : cur))}
            onDropZone={() => dropOn(null)}
          />

          {profilePerson && (
            <ResourceProfileDialog
              key={profilePerson.accountId}
              person={profilePerson}
              defaultCapacityHours={pool?.defaultCapacityHours ?? 8}
              skillSuggestions={skillSuggestions}
              summary={profileSummary(profilePerson, soonWindow, soonDays.get(profilePerson.accountId) ?? 0)}
              onClose={() => setProfileId(null)}
              onProfileSaved={upsertProfile}
              onAbsenceAdded={addAbsence}
              onAbsenceRemoved={removeAbsence}
              onAbsenceUpdated={replaceAbsence}
            />
          )}
        </>
      )}
    </div>
  );
}

/** The profile's one line: the same window and the same overload count as the row it was opened from. */
function profileSummary(person: PersonLoad, window: { from: string; to: string }, overDays: number): string {
  const r = loadInRange(person.days, window.from, window.to);
  return `${SOON_LABEL}: ${r.allocatedHours}h / ${r.capacityHours}h · ${pct(r.utilisation)}${overDays > 0 ? ` · quá tải ${overDays} ngày` : ""}`;
}

/**
 * Where the member list came from, behind an ⓘ beside the column's title.
 *
 * It cannot go away entirely: without it, "why is X not here / why is this stranger here" has no
 * answer on screen — the two sources differ enormously (a project's declared roles versus
 * everyone on the site holding one permission), and which one you get depends on a Jira
 * permission the user cannot see from here. So the normal case is a quiet ⓘ, and the fallback
 * (the list is probably wider than the real team) is the same control in warning colours.
 */
function MemberSourceTip({ pool, count }: { pool: ResourcePool | null; count: number }) {
  if (!pool) return null;

  if (pool.memberSource === "project-roles") {
    return (
      <InfoTip label="Danh sách thành viên lấy từ đâu">
        {count} thành viên, lấy từ vai trò dự án trên Jira
        {pool.memberRoles.length > 0 && <> ({pool.memberRoles.join(", ")})</>}. Sửa danh sách này trong Jira:{" "}
        <b>Project settings → People</b>.
        {pool.memberSkippedGroups > 0 && (
          <>
            {" "}
            Chưa tính {pool.memberSkippedGroups} nhóm không đọc được thành viên.
          </>
        )}
      </InfoTip>
    );
  }

  return (
    <InfoTip label="Danh sách thành viên có thể rộng hơn đội thật" tone="warn">
      {count} người, lấy từ danh sách <b>có thể được giao việc</b>. {fallbackReasonText(pool)} Danh sách này thường rộng hơn
      đội thật.
      {pool.memberTruncated && " Jira đã cắt ở 100 người, có thể còn thiếu."}
    </InfoTip>
  );
}

/**
 * One sentence per real cause. This used to blame Administer Projects for every
 * fallback, which sent an admin whose lookup failed for a different reason to
 * re-check the one permission they already had.
 */
function fallbackReasonText(pool: ResourcePool): ReactNode {
  const fb = pool.memberFallback;
  const status = fb?.status ? ` (HTTP ${fb.status})` : "";
  switch (fb?.reason) {
    case "roles-forbidden":
      return (
        <>
          tài khoản của bạn không có quyền <i>Administer Projects</i> nên Jira từ chối đọc vai trò dự án{status}.
        </>
      );
    case "actors-unreadable":
      return <>Jira liệt kê được vai trò dự án nhưng từ chối đọc thành viên của từng vai trò{status}.</>;
    case "groups-unreadable":
      return (
        <>
          vai trò dự án chỉ gồm nhóm, và tài khoản của bạn không có quyền toàn cục <i>Browse users and groups</i> để xem
          thành viên nhóm{status}. Thêm từng người trực tiếp vào vai trò sẽ khắc phục.
        </>
      );
    case "groups-out-of-scope":
      return (
        <>
          vai trò dự án chỉ gồm nhóm, và ứng dụng chưa được Atlassian cấp phạm vi truy cập để xem thành viên nhóm{status}.
          Đây là cấu hình của ứng dụng, không phải quyền của bạn trên Jira. Thêm từng người trực tiếp vào vai trò sẽ khắc
          phục.
        </>
      );
    case "roles-empty":
      return (
        <>
          đọc được vai trò dự án nhưng chưa vai trò nào có người. Thêm thành viên tại <b>Project settings → People</b>.
        </>
      );
    case "error":
      return <>không đọc được vai trò dự án do lỗi khi gọi Jira{status}.</>;
    default:
      return <>không đọc được vai trò dự án.</>;
  }
}

/**
 * Two header rows: months spanning their days, then the day (or week) itself.
 * The month row is what makes a 90-column strip readable — bare day numbers
 * repeat every month and give a reader nothing to anchor on.
 */
function HeatmapHeader({
  spans,
  granularity,
  today,
  memberNote,
}: {
  spans: Array<{ start: string; end: string }>;
  granularity: Granularity;
  today: string;
  memberNote: ReactNode;
}) {
  const calendar = useWorkCalendar();
  const months: Array<{ label: MonthLabel; span: number }> = [];
  for (const { start } of spans) {
    // By month the columns are months themselves, so the band above them is the year.
    const label = monthLabel(start, granularity);
    const last = months[months.length - 1];
    if (last && last.label.key === label.key) last.span += 1;
    else months.push({ label, span: 1 });
  }

  return (
    // One sticky block: both header rows stay put while the people scroll under them.
    <div className="rv-header">
      <div className="rv-row rv-row-months">
        <div className="rv-name rv-corner" />
        {months.map((m, i) => (
          // Three lengths of one label; the stylesheet shows whichever fits (container query on the band's own width).
          <div key={i} className="rv-month" title={m.label.full} style={{ "--span": m.span } as React.CSSProperties}>
            <span className="rv-month-full">{m.label.full}</span>
            <span className="rv-month-mid">{m.label.mid}</span>
            <span className="rv-month-min">{m.label.min}</span>
          </div>
        ))}
      </div>
      <div className="rv-row rv-row-head">
        <div className="rv-name rv-corner">
          Thành viên
          {memberNote}
        </div>
        {spans.map(({ start, end }) => {
          // A holiday is marked on its date, not by tinting the load cells: a yellow cell already means "<50%".
          const holiday = start === end && dayKind(start, calendar) === "holiday" ? dayLabel(start, calendar) || "Ngày lễ" : null;
          const holidays = start === end ? 0 : [...calendar.holidays.keys()].filter((d) => d >= start && d <= end).length;
          const when = start === end ? formatDate(start) : `${formatDate(start)} → ${formatDate(end)}`;
          return (
            <div
              key={start}
              className={`rv-cell rv-head-cell ${today >= start && today <= end ? "is-today" : ""}${today >= start && today <= end && granularity !== "day" ? " is-aggregated" : ""} ${holiday ? "is-holiday" : ""}`}
              title={holiday ? `${when} · Ngày lễ: ${holiday}` : holidays > 0 ? `${when} · ${holidays} ngày lễ` : when}
            >
              {granularity !== "day" && <TodayInCell start={start} end={end} today={today} />}
              {granularity === "week" ? weekColumnLabel(start) : granularity === "month" ? monthLabels(start).tiny : start.slice(8, 10)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
