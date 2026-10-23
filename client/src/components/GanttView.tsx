import { buildEpicIndex, filterTaskIds, isOverdueTask, type TaskFilter } from "../taskFilter";
import FilterBar from "./FilterBar";
import { Gantt, ViewMode, type Task as GanttTaskT } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { csvName, downloadCsv, type CsvCell } from "../csv";
import { computeCriticalPath } from "../criticalPath";
import { resolveBaselines } from "../baselineGeometry";
import { orderByWbs, resolveRanges, toGanttTasks } from "../ganttMapping";
import type { DependencyType, Task } from "../types";
import { overlayCsvCells, overlayCsvHeader } from "../wbsExport";
import BaselineOverlay from "./BaselineOverlay";
import DependencyOverlay from "./DependencyOverlay";
import IssueTypeIcon from "./IssueTypeIcon";
import SavedFilterMenu from "./SavedFilterMenu";

// "Spotlight" colours used only while the critical-path toggle is on: critical
// bars get an unambiguous red-orange, everything else is dimmed to grey so the
// chain reads clearly without fighting the normal status/type colour coding
// (which already uses red for Bug and would otherwise be ambiguous with "critical").
const CRITICAL_STYLES = { backgroundColor: "#e35d4f", progressColor: "#a3271b", backgroundSelectedColor: "#c94a3d" };
const DIMMED_STYLES = { backgroundColor: "#e7e7ec", progressColor: "#b7b7c0", backgroundSelectedColor: "#d5d5db" };

const ROW_HEIGHT = 42;
const HEADER_HEIGHT = 46;
// Each WBS level steps in by this much; a fixed-width expander slot (reserved even
// on leaf rows, see .wbs-expander-slot) keeps every level's icon aligned under its
// parent's text rather than under the parent's own expander arrow.
const INDENT_STEP = 28;
const MIN_LIST_WIDTH = 220;
const MIN_CHART_WIDTH = 240;
// gantt-task-react always renders its own horizontal scrollbar strip under the
// chart rows; reserve room for it so the fixed-height layout below doesn't clip it.
const SCROLLBAR_RESERVE = 24;
const DAY_MS = 86_400_000;

/**
 * The WBS table and header are handed to gantt-task-react as component *types*, and
 * React unmounts and rebuilds a subtree whenever that type changes. Defining them
 * inline in GanttView's render gave them a new identity on every render, so the
 * first click of a double-click (which selects, which re-renders) replaced the row
 * under the pointer and the browser never saw a dblclick. These two have a fixed
 * identity instead; the current closures reach them through context, which
 * re-renders them in place on every change.
 */
const WbsListContext = createContext<{ renderHeader: () => ReactNode; renderTable: () => ReactNode } | null>(null);
const useWbsList = () => {
  const ctx = useContext(WbsListContext);
  if (!ctx) throw new Error("WBS list rendered outside GanttView");
  return ctx;
};
function WbsListHeader() {
  return <>{useWbsList().renderHeader()}</>;
}
function WbsListTable() {
  return <>{useWbsList().renderTable()}</>;
}

// How many calendar days one column spans in each mode (gantt-task-react's own
// seedDates — Month is a real calendar month, ~30.4 days on average). This is
// what makes one continuous zoom variable ("pixels per day") work across all
// three modes at once: a column's on-screen width is always pixelsPerDay times
// this, so the SAME zoom gesture that shrinks a 1-day column also shrinks a
// 7-day one, at the same rate, with no separate scale to reset between modes.
const DAYS_PER_COLUMN: Record<ViewMode, number> = {
  [ViewMode.Day]: 1,
  [ViewMode.Week]: 7,
  [ViewMode.Month]: 30.4,
} as Record<ViewMode, number>;
const VIEW_MODE_LABEL: Partial<Record<ViewMode, string>> = {
  [ViewMode.Day]: "Ngày",
  [ViewMode.Week]: "Tuần",
  [ViewMode.Month]: "Tháng",
};

type ToolbarIconName = "critical" | "link" | "layers" | "download" | "upload" | "columns";

/** Small outline glyphs for the toolbar — one per action, so a row of identical
 * text pills doesn't have to be read word by word to tell toggles from one-shot
 * actions apart. Inline rather than an icon package: ten paths isn't worth a
 * dependency, and `IssueTypeIcon` already sets the precedent in this codebase. */
function ToolbarIcon({ name }: { name: ToolbarIconName }) {
  const PATHS: Record<ToolbarIconName, ReactNode> = {
    critical: (
      <>
        <path d="M5 21V4" />
        <path d="M5 4h13l-2.5 4L18 12H5" />
      </>
    ),
    link: (
      <>
        <path d="M9 17H7a5 5 0 0 1 0-10h2" />
        <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
        <path d="M8 12h8" />
      </>
    ),
    layers: (
      <>
        <path d="M12 3 3 8l9 5 9-5-9-5Z" />
        <path d="M3 16l9 5 9-5" />
        <path d="M3 12l9 5 9-5" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v11" />
        <path d="M7 10l5 5 5-5" />
        <path d="M5 21h14" />
      </>
    ),
    upload: (
      <>
        <path d="M12 21V10" />
        <path d="M7 15l5-5 5 5" />
        <path d="M5 3h14" />
      </>
    ),
    columns: (
      <>
        <rect x="3" y="4" width="5" height="16" rx="1.2" />
        <rect x="9.5" y="4" width="5" height="16" rx="1.2" />
        <rect x="16" y="4" width="5" height="16" rx="1.2" />
      </>
    ),
  };
  return (
    <svg
      className="tbi"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
// A column narrower than this can't fit its own label; wider than this, zooming
// in stops helping and just wastes horizontal space. Both modes' comfort bands
// overlap on purpose — see pickScale — so the handoff between them has room to
// land at a *comfortable* width on the new mode, not right at its own edge.
const MIN_COLUMN_WIDTH = 26;
const MAX_COLUMN_WIDTH = 260;
const MIN_PIXELS_PER_DAY = MIN_COLUMN_WIDTH / DAYS_PER_COLUMN[ViewMode.Month];
const MAX_PIXELS_PER_DAY = MAX_COLUMN_WIDTH / DAYS_PER_COLUMN[ViewMode.Day];
// The pixels-per-day each mode's button jumps to — chosen to match this file's
// old fixed per-mode column widths (60/160/200), so clicking a button lands
// exactly where it always used to.
const DEFAULT_PIXELS_PER_DAY: Record<ViewMode, number> = {
  [ViewMode.Day]: 60,
  [ViewMode.Week]: 160 / DAYS_PER_COLUMN[ViewMode.Week],
  [ViewMode.Month]: 200 / DAYS_PER_COLUMN[ViewMode.Month],
} as Record<ViewMode, number>;
// How much one "notch" of trackpad pinch or Ctrl+wheel changes the zoom — tuned
// so a full pinch gesture (deltaY in the low hundreds) crosses roughly one
// mode's whole comfort band in one smooth motion, not a single jump.
const ZOOM_SENSITIVITY = 0.9;

/**
 * The single source of truth for "how zoomed in are we": everything else
 * (which of Day/Week/Month is showing, and how wide its columns are) is derived
 * from this one number, never stored separately — so there is no way for the
 * mode and the column width to disagree with each other. Whichever mode's
 * column width would land inside [MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH] wins,
 * preferring the finest granularity that still fits; Month is the fallback once
 * even Week's columns would be too narrow.
 */
function pickScale(pixelsPerDay: number): { viewMode: ViewMode; columnWidth: number } {
  const dayWidth = pixelsPerDay * DAYS_PER_COLUMN[ViewMode.Day];
  if (dayWidth >= MIN_COLUMN_WIDTH) {
    return { viewMode: ViewMode.Day, columnWidth: Math.min(MAX_COLUMN_WIDTH, dayWidth) };
  }
  const weekWidth = pixelsPerDay * DAYS_PER_COLUMN[ViewMode.Week];
  if (weekWidth >= MIN_COLUMN_WIDTH) {
    return { viewMode: ViewMode.Week, columnWidth: Math.min(MAX_COLUMN_WIDTH, weekWidth) };
  }
  const monthWidth = pixelsPerDay * DAYS_PER_COLUMN[ViewMode.Month];
  return {
    viewMode: ViewMode.Month,
    columnWidth: Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, monthWidth)),
  };
}

/* ---------------------------------------------------------------- columns */

type ColumnId = "type" | "status" | "priority" | "labels" | "assignee" | "start" | "due" | "duration" | "estimate" | "spent" | "pct";

interface ColumnDef {
  id: ColumnId;
  label: string;
  /** Spelled out in the chooser, where there is room. */
  long: string;
  width: number;
  align?: "right";
  /** `range` is the bar's own span — an Epic's rolls up its children, so its columns must too. */
  cell: (task: Task, range: { start: string; end: string } | undefined, today: string) => ReactNode;
}

const dm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "—");
const hours = (h: number | null) => (h === null ? "—" : `${Math.round(h * 10) / 10}h`);
const spanDays = (r: { start: string; end: string }) =>
  Math.round((Date.parse(r.end + "T00:00:00Z") - Date.parse(r.start + "T00:00:00Z")) / DAY_MS) + 1;

const COLUMNS: ColumnDef[] = [
  { id: "type", label: "Loại", long: "Loại issue", width: 70, cell: (t) => t.issueType },
  {
    id: "status",
    label: "Trạng thái",
    long: "Trạng thái Jira",
    width: 112,
    cell: (t) => <span className={`wbs-status is-${t.statusCategory}`}>{t.statusName}</span>,
  },
  { id: "priority", label: "Ưu tiên", long: "Độ ưu tiên", width: 76, cell: (t) => t.priority ?? "—" },
  {
    id: "labels",
    label: "Nhãn",
    long: "Nhãn (labels)",
    width: 110,
    cell: (t) => (t.labels.length > 0 ? <span title={t.labels.join(", ")}>{t.labels.join(", ")}</span> : "—"),
  },
  { id: "assignee", label: "Phụ trách", long: "Người phụ trách", width: 110, cell: (t) => t.assigneeName ?? "—" },
  { id: "start", label: "Bắt đầu", long: "Ngày bắt đầu", width: 76, cell: (t, r) => dm(r?.start ?? t.startDate) },
  {
    id: "due",
    label: "Kết thúc",
    long: "Ngày kết thúc",
    width: 76,
    // Marked by the task's own due date — the same rule as the "Quá hạn" filter,
    // so a red date and a filter hit always agree.
    cell: (t, r, today) =>
      isOverdueTask(t, today) ? (
        <span className="wbs-overdue" title={`Quá hạn — hạn ${dm(t.dueDate)}, chưa xong`}>
          {dm(r?.end ?? t.dueDate)}
        </span>
      ) : (
        dm(r?.end ?? t.dueDate)
      ),
  },
  {
    id: "duration",
    label: "T.lượng",
    long: "Thời lượng (ngày)",
    width: 66,
    align: "right",
    cell: (t, r) => `${r ? spanDays(r) : t.durationDays}d`,
  },
  { id: "estimate", label: "Ước lượng", long: "Ước lượng (Original estimate)", width: 76, align: "right", cell: (t) => hours(t.estimateHours) },
  {
    id: "spent",
    label: "Đã ghi",
    long: "Giờ đã ghi (worklog)",
    width: 66,
    align: "right",
    cell: (t) =>
      t.estimateHours !== null && (t.spentHours ?? 0) > t.estimateHours ? (
        <span className="wbs-over" title={`Vượt ước lượng ${hours((t.spentHours ?? 0) - t.estimateHours)}`}>
          ▲ {hours(t.spentHours)}
        </span>
      ) : (
        hours(t.spentHours)
      ),
  },
  { id: "pct", label: "%", long: "% hoàn thành", width: 48, align: "right", cell: (t) => `${t.percentComplete}%` },
];

/** The same value a column shows, as plain data for a spreadsheet. */
function csvValue(id: ColumnId, t: Task, r: { start: string; end: string } | undefined): CsvCell {
  switch (id) {
    case "type":
      return t.issueType;
    case "status":
      return t.statusName;
    case "priority":
      return t.priority;
    case "labels":
      return t.labels.join(", ");
    case "assignee":
      return t.assigneeName;
    case "start":
      return r?.start ?? t.startDate;
    case "due":
      return r?.end ?? t.dueDate;
    case "duration":
      return r ? spanDays(r) : t.durationDays;
    case "estimate":
      return t.estimateHours;
    case "spent":
      return t.spentHours;
    case "pct":
      return t.percentComplete;
  }
}

// What the table always showed, so nobody's Gantt changes until they ask.
const DEFAULT_COLUMNS: ColumnId[] = ["assignee", "pct"];
const COLUMNS_KEY = "gms.gantt.columns";
const KEY_COL_WIDTH = 75;
const MIN_NAME_WIDTH = 200;

function loadColumns(): ColumnId[] {
  try {
    const raw = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? "null");
    if (Array.isArray(raw)) return raw.filter((id): id is ColumnId => COLUMNS.some((c) => c.id === id));
  } catch {
    // Private mode or a mangled value — the defaults are a fine answer.
  }
  return DEFAULT_COLUMNS;
}

function saveColumns(ids: ColumnId[]): void {
  try {
    localStorage.setItem(COLUMNS_KEY, JSON.stringify(ids));
  } catch {
    // Not remembered across reloads; still applies now.
  }
}

// Per browser, like the columns: whether someone reads the plan against its baseline is a habit.
const BASELINE_KEY = "gms.gantt.baseline";

function loadShowBaseline(): boolean {
  try {
    return localStorage.getItem(BASELINE_KEY) !== "off";
  } catch {
    return true;
  }
}

function saveShowBaseline(on: boolean): void {
  try {
    localStorage.setItem(BASELINE_KEY, on ? "on" : "off");
  } catch {
    // Not remembered across reloads; still applies now.
  }
}

interface Props {
  tasks: Task[];
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  selectedId: string | null;
  /**
   * Ctrl/Cmd toggles one row, Shift extends from the last click — like a file
   * list. `visibleOrder` comes along because only this view knows which rows are
   * on screen and in what order, which is what a Shift range is measured in.
   */
  onSelect: (
    id: string,
    modifiers: { toggle: boolean; range: boolean },
    visibleOrder: string[]
  ) => void;
  selectedIds: Set<string>;
  /** Shared with the resource tab, so it lives in ProjectWorkspace. */
  filter: TaskFilter;
  onFilterChange: (f: TaskFilter) => void;
  myAccountId: string;
  today: string;
  /** Replaces the whole collapsed set — empty expands everything. */
  onSetCollapsed: (ids: string[]) => void;
  onOpenEdit: (task: Task) => void;
  onScheduleChange: (id: string, startDate: string, durationDays: number) => void;
  onProgressChange: (id: string, percentComplete: number) => void;
  onAddDependency: (successorId: string, predecessorId: string, type: DependencyType) => void;
  onEditDependency: (
    successorId: string,
    predecessorId: string,
    currentType: DependencyType,
    next: { type: DependencyType; lagDays: number }
  ) => void;
  onDeleteDependency: (successorId: string, predecessorId: string, type: DependencyType) => void;
  /** Opens the KBKT test-case workbook import — beside "Xuất CSV": import next to export. */
  onImportKbkt: () => void;
}

function toIso(d: Date): string {
  // gantt-task-react hands back local-midnight Date objects for the dragged bar's
  // calendar day; read them with local getters instead of toISOString() (UTC),
  // which would roll the date back a day in timezones ahead of UTC (e.g. Vietnam).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function GanttView({
  tasks,
  collapsed,
  onToggleCollapse,
  selectedId,
  onSelect,
  selectedIds,
  filter,
  onFilterChange,
  myAccountId,
  today,
  onSetCollapsed,
  onOpenEdit,
  onScheduleChange,
  onProgressChange,
  onAddDependency,
  onEditDependency,
  onDeleteDependency,
  onImportKbkt,
}: Props) {
  // The one zoom variable everything else derives from — see pickScale.
  const [pixelsPerDay, setPixelsPerDay] = useState(DEFAULT_PIXELS_PER_DAY[ViewMode.Week]);
  const { viewMode, columnWidth } = pickScale(pixelsPerDay);
  const [showCriticalPath, setShowCriticalPath] = useState(false);
  const [showDependencies, setShowDependencies] = useState(true);
  const [showBaseline, setShowBaseline] = useState(loadShowBaseline);
  const query = filter.text;
  const setQuery = (text: string) => onFilterChange({ ...filter, text });
  // gantt-task-react scrolls to `viewDate` whenever its value changes. The
  // nonce nudges the millisecond so pressing "Hôm nay" again — after scrolling
  // away — is a different value and scrolls again; a day column can't tell.
  const [viewDate, setViewDate] = useState<Date | undefined>();
  const viewNonce = useRef(0);
  const scrollToDate = useCallback((iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    setViewDate(new Date(y, m - 1, d, 0, 0, 0, viewNonce.current++ % 900));
  }, []);
  const [unscheduledOpen, setUnscheduledOpen] = useState(false);
  const unscheduledRef = useRef<HTMLDivElement>(null);
  // Per browser, not per project: which columns someone reads is a habit, not a property of the plan.
  const [columnIds, setColumnIds] = useState<ColumnId[]>(loadColumns);
  const [chooserOpen, setChooserOpen] = useState(false);
  const chooserRef = useRef<HTMLDivElement>(null);
  // Kept in COLUMNS order whatever order they were ticked in, so the table never reshuffles.
  const columns = useMemo(() => COLUMNS.filter((c) => columnIds.includes(c.id)), [columnIds]);
  const columnsWidth = columns.reduce((s, c) => s + c.width, 0);

  function toggleColumn(id: ColumnId) {
    setColumnIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      saveColumns(next);
      return next;
    });
    // Let the divider re-fit the new set of columns.
    setListWidthOverride(null);
  }

  useEffect(() => {
    if (!chooserOpen) return;
    function onDown(e: MouseEvent) {
      if (chooserRef.current && !chooserRef.current.contains(e.target as Node)) setChooserOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setChooserOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [chooserOpen]);
  const criticalIds = useMemo(() => computeCriticalPath(tasks), [tasks]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const bodyRef = useRef<HTMLDivElement>(null);
  // Mirrors bodyRef.current into state: DependencyOverlay needs the element itself
  // (to locate the chart's SVG to portal into), and reading ref.current directly
  // during render isn't safe — this effect is the one place that's allowed to.
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 });
  const [listWidthOverride, setListWidthOverride] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    setBodyEl(el);
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setBodySize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Defaults to the middle of the visible Gantt area; a manual drag (listWidthOverride)
  // always wins over that default once set.
  // Wide enough for the chosen columns plus a readable name — more columns
  // push the divider right rather than squeezing the task names to nothing.
  const neededListWidth = KEY_COL_WIDTH + MIN_NAME_WIDTH + columnsWidth;
  const defaultListWidth = Math.max(bodySize.width > 0 ? Math.round(bodySize.width / 2) : 320, neededListWidth);
  const maxListWidth = Math.max(MIN_LIST_WIDTH, bodySize.width - MIN_CHART_WIDTH);
  const listWidth = Math.min(maxListWidth, Math.max(MIN_LIST_WIDTH, listWidthOverride ?? defaultListWidth));
  const ganttHeight = Math.max(ROW_HEIGHT, bodySize.height - HEADER_HEIGHT - SCROLLBAR_RESERVE);

  // Trackpad pinch (and Ctrl+wheel) only — a plain two-finger scroll must keep
  // panning the chart, not hijack it into a zoom. Browsers report pinch-to-zoom
  // as a wheel event with ctrlKey set specifically so a page can tell the two
  // apart and override the browser's own page-zoom with its own behaviour.
  //
  // Registered as a native, non-passive listener rather than React's onWheel:
  // React attaches wheel handlers as passive by default, where preventDefault()
  // is silently ignored — the browser would still zoom the whole page underneath
  // this chart's own zoom.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setPixelsPerDay((prev) => {
        // deltaY < 0 is pinch-out / scroll-up — zoom in.
        const next = prev * Math.exp((-e.deltaY / 100) * ZOOM_SENSITIVITY * 0.1);
        return Math.min(MAX_PIXELS_PER_DAY, Math.max(MIN_PIXELS_PER_DAY, next));
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Day-view header: gantt-task-react always renders "Th 2, 15" (weekday + day),
  // with no prop to ask for just the day number, and always at the same pixel
  // width regardless of zoom — at low zoom that text collides with its
  // neighbours. Both are fixed by reaching into the rendered SVG directly (same
  // technique DependencyOverlay already uses for this library's other missing
  // extension points): every calendar-header label shares one CSS module class,
  // so labels are found by that class and by ending in a bare day number, then
  // trimmed to just the number, dropping every Nth one once columns are too
  // narrow for all of them to fit without overlapping.
  useEffect(() => {
    if (!bodyEl || viewMode !== ViewMode.Day) return;

    // Day view's column width only ranges down to MIN_COLUMN_WIDTH before
    // pickScale hands off to Week instead of cramming it further — so there's
    // only ever a little room to thin out before the handoff does the rest.
    // Thinned by skipping every Nth label instead of shrinking text, so what
    // remains stays legible rather than tiny.
    const skipEvery = columnWidth < MIN_COLUMN_WIDTH + 8 ? 2 : 1;

    function simplify() {
      // Not scoped to a specific <svg>: gantt-task-react renders the calendar
      // header and the bar grid as two SEPARATE sibling <svg> elements, and
      // grabbing "the first svg in bodyEl" turned out not to reliably mean the
      // header one — querying bodyEl's whole subtree finds the label class
      // wherever it actually landed, since only the header ever uses it.
      const labels = bodyEl!.querySelectorAll<SVGTextElement>("text._9w8d5");
      labels.forEach((el, i) => {
        const match = (el.dataset.fullLabel ?? el.textContent ?? "").match(/(\d+)\s*$/);
        if (!match) return;
        // The original text is stashed once so re-simplifying (e.g. after the
        // skip pattern changes with zoom) always starts from the real label
        // instead of compounding an earlier truncation.
        if (!el.dataset.fullLabel) el.dataset.fullLabel = el.textContent ?? "";
        const next = i % skipEvery === 0 ? match[1] : "";
        // Skipped when already correct so this doesn't retrigger the very
        // MutationObserver watching this subtree for the library's own changes.
        if (el.textContent !== next) el.textContent = next;
      });
    }

    simplify();
    const observer = new MutationObserver(simplify);
    observer.observe(bodyEl, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [bodyEl, viewMode, columnWidth]);

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = listWidth;
    setDragging(true);
    function onMove(ev: MouseEvent) {
      setListWidthOverride(startWidth + (ev.clientX - startX));
    }
    function onUp() {
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const ordered = useMemo(() => orderByWbs(tasks), [tasks]);
  // Deliberately resolved from the FULL tree, before any search filtering: a parent's
  // rolled-up bar must span all of its children, not just the ones matching the query.
  const ranges = useMemo(() => resolveRanges(ordered), [ordered]);
  // Same full-tree rule, so an Epic's baseline rolls up its children like its bar does.
  const baselines = useMemo(() => resolveBaselines(ordered), [ordered]);

  const epicOf = useMemo(() => buildEpicIndex(tasks), [tasks]);
  const matchIds = useMemo(
    () => filterTaskIds(tasks, filter, { today, epicOf }),
    [tasks, filter, today, epicOf]
  );

  /**
   * Matches plus their ancestors. Keeping matches alone would strip a matched
   * Sub-task of the Epic/Story rows that identify it, and leave gaps in the
   * indentation that make the remaining depth values look arbitrary.
   */
  const searchKeep = useMemo(() => {
    if (!matchIds) return null;
    const keep = new Set<string>();
    for (const id of matchIds) {
      let cur: string | null = id;
      // Doubles as a cycle guard: a malformed parent chain would otherwise spin
      // here and hang the render thread rather than fail visibly.
      while (cur && !keep.has(cur)) {
        keep.add(cur);
        cur = byId.get(cur)?.wbsParentId ?? null;
      }
    }
    return keep;
  }, [matchIds, byId]);

  const visible = useMemo(() => {
    // While searching, collapse state is bypassed: a hit sitting inside a collapsed
    // parent would be counted in the result total but never appear on screen.
    if (searchKeep) return ordered.filter((o) => searchKeep.has(o.task.id));
    const hiddenAncestors = new Set<string>();
    const result = [] as typeof ordered;
    for (const item of ordered) {
      if (item.task.wbsParentId && hiddenAncestors.has(item.task.wbsParentId)) {
        hiddenAncestors.add(item.task.id);
        continue;
      }
      result.push(item);
      if (collapsed.has(item.task.id)) hiddenAncestors.add(item.task.id);
    }
    return result;
  }, [ordered, collapsed, searchKeep]);

  // Rows actually rendered: gantt-task-react positions its chart bars purely by
  // index within the array passed to <Gantt>, so the custom WBS table below must
  // render this exact same filtered list, in this exact order, or the two panes
  // drift out of row alignment (a task without a resolvable date can't get a bar).
  const rows = useMemo(() => visible.filter((v) => ranges.has(v.task.id)), [visible, ranges]);

  // Tasks with no resolvable date have no bar, so without this list a task whose
  // start was cleared simply vanishes from the Gantt with nowhere to find it.
  const unscheduled = useMemo(
    () => ordered.map((o) => o.task).filter((t) => !ranges.has(t.id) && (!matchIds || matchIds.has(t.id))),
    [ordered, ranges, matchIds]
  );
  const parentIds = useMemo(
    () => [...new Set(tasks.map((t) => t.wbsParentId).filter((id): id is string => !!id))],
    [tasks]
  );

  // The chart only spans its own bars, so "today" can lie outside it, where a
  // scroll to it would silently do nothing. Go to the nearest end and say why.
  const [todayNote, setTodayNote] = useState<string | null>(null);
  useEffect(() => {
    if (!todayNote) return;
    const timer = window.setTimeout(() => setTodayNote(null), 5000);
    return () => window.clearTimeout(timer);
  }, [todayNote]);
  function goToToday() {
    let first: string | null = null;
    let last: string | null = null;
    for (const row of rows) {
      const r = ranges.get(row.task.id)!;
      if (!first || r.start < first) first = r.start;
      if (!last || r.end > last) last = r.end;
    }
    if (first && today < first) {
      setTodayNote("Hôm nay nằm trước thanh đầu tiên của biểu đồ.");
      scrollToDate(first);
    } else if (last && today > last) {
      setTodayNote("Hôm nay nằm sau thanh cuối cùng của biểu đồ.");
      scrollToDate(last);
    } else {
      setTodayNote(null);
      scrollToDate(today);
    }
  }

  // Typing a search jumps the chart to the first hit. Keyed on the text itself:
  // matchIds is a new Set after every edit, and re-scrolling after a drag while a
  // search is open would yank the chart away from what was just moved.
  const lastScrolledText = useRef("");
  useEffect(() => {
    const text = filter.text.trim();
    if (text === lastScrolledText.current) return;
    lastScrolledText.current = text;
    if (!text || !matchIds || matchIds.size === 0) return;
    let first: string | null = null;
    for (const id of matchIds) {
      const r = ranges.get(id);
      if (r && (!first || r.start < first)) first = r.start;
    }
    if (first) scrollToDate(first);
  }, [filter.text, matchIds, ranges, scrollToDate]);

  useEffect(() => {
    if (!unscheduledOpen) return;
    function onDown(e: MouseEvent) {
      if (unscheduledRef.current && !unscheduledRef.current.contains(e.target as Node)) setUnscheduledOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setUnscheduledOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [unscheduledOpen]);

  function exportCsv() {
    // Matches only: the table keeps their ancestors for indentation, but a sheet of
    // "what the filter found" should not list parents the filter excluded.
    const list = ordered.filter((o) => !matchIds || matchIds.has(o.task.id));
    // The overlay block (dependencies, baseline, and % unless it is already a
    // visible column) always follows: it is the data Jira's own export lacks.
    const includePct = !columnIds.includes("pct");
    const header = ["Mã", "Tên công việc", ...columns.map((c) => c.long), ...overlayCsvHeader(includePct)];
    const body = list.map((o) => [
      o.task.id,
      o.task.summary,
      ...columns.map((c) => csvValue(c.id, o.task, ranges.get(o.task.id))),
      ...overlayCsvCells(o.task, ranges.get(o.task.id), baselines.get(o.task.id), includePct),
    ]);
    downloadCsv(csvName(`wbs-${tasks[0]?.id.split("-")[0] ?? "du-an"}`, today), [header, ...body]);
  }

  // Replaces the library's English hover card ("Duration: 3 day(s)").
  const TooltipContent = useMemo(
    () =>
      function GanttTooltip({ task }: { task: GanttTaskT; fontSize: string; fontFamily: string }) {
        const full = byId.get(task.id);
        const days = Math.max(1, Math.round((task.end.getTime() - task.start.getTime()) / DAY_MS));
        const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
        // `end` is exclusive (see toGanttTasks), so the last day is one before it.
        const last = new Date(task.end.getTime() - DAY_MS);
        return (
          <div className="gantt-tip">
            <b>{task.id}</b> · {task.name}
            <div>
              {fmt(task.start)} – {fmt(last)} ({days} ngày)
            </div>
            {full && (
              <div>
                {full.statusName} · {full.assigneeName ?? "Chưa gán"}
              </div>
            )}
            <div>Hoàn thành: {Math.round(task.progress)}%</div>
          </div>
        );
      },
    [byId]
  );
  const ganttTasks = useMemo(() => {
    const base = toGanttTasks(rows, ranges);
    if (!showCriticalPath) return base;
    return base.map((t) => ({
      ...t,
      styles: criticalIds.has(t.id) ? CRITICAL_STYLES : DIMMED_STYLES,
    }));
  }, [rows, ranges, showCriticalPath, criticalIds]);

  // Bumped whenever a bar's actual on-screen position could have changed, so
  // DependencyOverlay knows when to re-measure. Own dates in ms rather than
  // object identity, since ganttTasks gets a new array/Date identity on every
  // render regardless of whether anything actually moved.
  const measureKey = useMemo(
    () =>
      `${viewMode}:${columnWidth}:${listWidth}:` +
      ganttTasks.map((t) => `${t.id}=${t.start.getTime()}-${t.end.getTime()}`).join(","),
    [viewMode, columnWidth, listWidth, ganttTasks]
  );
  const rowTasks = useMemo(() => rows.map((r) => r.task), [rows]);

  // gantt-task-react does NOT size its TaskList wrapper to listCellWidth itself —
  // it only forwards that value as a `rowWidth` prop and expects the consumer's own
  // TaskListHeader/TaskListTable to apply it. Without an explicit width here, these
  // roots stay at their shrink-to-fit content width, so dragging the divider moves
  // only the handle (which follows `listWidth` directly) while the WBS pane itself
  // never actually resizes.
  const renderHeader = () => (
    <div className="wbs-header" style={{ height: HEADER_HEIGHT, width: listWidth }}>
      <div className="wbs-col wbs-col-key">Mã</div>
      <div className="wbs-col wbs-col-name">Tên công việc</div>
      {columns.map((c) => (
        <div
          key={c.id}
          className={`wbs-col wbs-col-extra ${c.align === "right" ? "is-right" : ""}`}
          style={{ width: c.width }}
          title={c.long}
        >
          {c.label}
        </div>
      ))}
    </div>
  );

  const renderTable = () => (
    <div style={{ width: listWidth }}>
      {rows.map(({ task, depth, hasChildren }) => (
        <div
          key={task.id}
          className={`wbs-row ${matchIds?.has(task.id) ? "wbs-row-match" : ""} ${
            selectedIds.has(task.id) || task.id === selectedId ? "wbs-row-selected" : ""
          } ${showCriticalPath && criticalIds.has(task.id) ? "wbs-row-critical" : ""}`}
          style={{ height: ROW_HEIGHT }}
          onClick={(e) =>
            onSelect(
              task.id,
              { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey },
              rows.map((r) => r.task.id)
            )
          }
          onDoubleClick={() => onOpenEdit(task)}
        >
          <div className="wbs-col wbs-col-key">
            <a href={task.jiraUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              {task.id}
            </a>
          </div>
          <div className="wbs-col wbs-col-name" style={{ paddingLeft: depth * INDENT_STEP }}>
            <span className="wbs-expander-slot">
              {hasChildren && (
                <button
                  className={`expander ${collapsed.has(task.id) ? "expander-collapsed" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCollapse(task.id);
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10">
                    <path d="M2 1 L8 5 L2 9 Z" fill="currentColor" />
                  </svg>
                </button>
              )}
            </span>
            <IssueTypeIcon type={task.issueType} />
            <span className={hasChildren ? "wbs-summary wbs-summary-parent" : "wbs-summary"}>
              {task.summary}
            </span>
          </div>
          {columns.map((c) => (
            <div
              key={c.id}
              className={`wbs-col wbs-col-extra wbs-cell-${c.id} ${c.align === "right" ? "is-right" : ""}`}
              style={{ width: c.width }}
            >
              {c.cell(task, ranges.get(task.id), today)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <div className="gantt-wrap">
      <div className="gantt-toolbar">
        <div className="seg-group" role="group" aria-label="Chia theo">
          {[ViewMode.Day, ViewMode.Week, ViewMode.Month].map((vm) => (
            <button
              key={vm}
              className={viewMode === vm ? "active" : ""}
              onClick={() => setPixelsPerDay(DEFAULT_PIXELS_PER_DAY[vm])}
            >
              {VIEW_MODE_LABEL[vm]}
            </button>
          ))}
        </div>
        <span className="gantt-toolbar-divider" aria-hidden="true" />
        <button
          className={showCriticalPath ? "active toggle-pill critical-toggle" : "toggle-pill critical-toggle"}
          onClick={() => setShowCriticalPath((v) => !v)}
          title="Chuỗi công việc quyết định thời gian hoàn thành dự án — trễ bất kỳ task nào trong chuỗi này sẽ làm trễ cả dự án"
        >
          <ToolbarIcon name="critical" />
          Đường găng
        </button>
        <button
          className={showDependencies ? "active toggle-pill" : "toggle-pill"}
          onClick={() => setShowDependencies((v) => !v)}
          title="Ẩn/hiện mũi tên phụ thuộc giữa các task (FS/SS/FF/SF). Kéo từ đầu hoặc đuôi một task sang task khác để tạo phụ thuộc mới."
        >
          <ToolbarIcon name="link" />
          Phụ thuộc
        </button>
        <button
          className={showBaseline ? "active toggle-pill" : "toggle-pill"}
          onClick={() => {
            setShowBaseline(!showBaseline);
            saveShowBaseline(!showBaseline);
          }}
          title="Ẩn/hiện thanh baseline mờ dưới mỗi thanh để so lịch hiện tại với lịch đã chốt (đỏ = kết thúc muộn hơn baseline). Lưu baseline: chọn công việc rồi dùng ô Baseline… trên thanh chọn."
        >
          <ToolbarIcon name="layers" />
          Baseline
        </button>
        <span className="gantt-toolbar-divider" aria-hidden="true" />
        <button onClick={goToToday} title="Cuộn biểu đồ tới ngày hôm nay">
          Hôm nay
        </button>
        {todayNote && (
          <span className="gantt-today-note" role="status">
            {todayNote}
          </span>
        )}
        <button
          onClick={() => onSetCollapsed(parentIds)}
          disabled={parentIds.length === 0}
          title="Thu gọn mọi nhóm công việc"
        >
          Thu gọn
        </button>
        <button onClick={() => onSetCollapsed([])} disabled={collapsed.size === 0} title="Mở rộng mọi nhóm công việc">
          Mở rộng
        </button>
        <span className="gantt-toolbar-divider" aria-hidden="true" />
        {unscheduled.length > 0 && (
          <div className="col-chooser" ref={unscheduledRef}>
            <button
              className={unscheduledOpen ? "active warning-pill" : "warning-pill"}
              onClick={() => setUnscheduledOpen((v) => !v)}
              aria-expanded={unscheduledOpen}
              title="Công việc chưa có ngày bắt đầu nên không có thanh trên biểu đồ"
            >
              Chưa có ngày ({unscheduled.length}) ▾
            </button>
            {unscheduledOpen && (
              <div className="col-chooser-menu tf-menu" role="menu">
                <div className="col-chooser-title">Bấm để đặt ngày</div>
                {unscheduled.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="unscheduled-item"
                    onClick={() => {
                      setUnscheduledOpen(false);
                      onOpenEdit(t);
                    }}
                  >
                    <b>{t.id}</b> {t.summary}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          onClick={exportCsv}
          title="Tải bảng WBS (các cột đang hiện, theo bộ lọc) kèm % hoàn thành, phụ thuộc và baseline về file CSV mở được bằng Excel"
        >
          <ToolbarIcon name="download" />
          Xuất CSV
        </button>
        <button onClick={onImportKbkt} title="Tạo/cập nhật test case và lỗi trong Jira từ file kịch bản kiểm thử (KBKT) .xlsx">
          <ToolbarIcon name="upload" />
          Nhập KBKT
        </button>
        <div className="col-chooser" ref={chooserRef}>
          <button
            className={chooserOpen ? "active" : ""}
            onClick={() => setChooserOpen((v) => !v)}
            aria-expanded={chooserOpen}
            title="Chọn cột hiển thị trong bảng WBS"
          >
            <ToolbarIcon name="columns" />
            Cột ({columns.length}) ▾
          </button>
          {chooserOpen && (
            <div className="col-chooser-menu" role="menu">
              <div className="col-chooser-title">Hiển thị cột</div>
              {COLUMNS.map((c) => (
                <label key={c.id} className="col-chooser-item">
                  <input type="checkbox" checked={columnIds.includes(c.id)} onChange={() => toggleColumn(c.id)} />
                  {c.long}
                </label>
              ))}
              <div className="col-chooser-foot">
                <button
                  className="text-btn"
                  onClick={() => {
                    setColumnIds(DEFAULT_COLUMNS);
                    saveColumns(DEFAULT_COLUMNS);
                  }}
                >
                  Mặc định
                </button>
                <button
                  className="text-btn"
                  onClick={() => {
                    const all = COLUMNS.map((c) => c.id);
                    setColumnIds(all);
                    saveColumns(all);
                  }}
                >
                  Tất cả
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="gantt-search">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Tìm theo mã hoặc tên công việc..."
            aria-label="Tìm công việc"
          />
          {query && (
            <button
              className="gantt-search-clear"
              onClick={() => setQuery("")}
              aria-label="Xoá tìm kiếm"
            >
              ×
            </button>
          )}
        </div>
      </div>
      {/* The empty state lives inside .gantt-body rather than replacing it: the
          ResizeObserver attaches to bodyRef once on mount, so unmounting this node
          when a query matches nothing would leave the observer bound to a detached
          element and freeze bodySize once the query was cleared again. */}
      <FilterBar
        tasks={tasks}
        filter={filter}
        onChange={onFilterChange}
        myAccountId={myAccountId}
        matched={matchIds?.size}
        total={tasks.length}
        leading={<SavedFilterMenu filter={filter} onApply={onFilterChange} myAccountId={myAccountId} />}
      />
      <div className="gantt-body" ref={bodyRef}>
        {rows.length === 0 ? (
          <div className="empty-state">
            {matchIds?.size === 0
              ? "Không có công việc nào khớp bộ lọc."
              : "Chưa có task nào có ngày bắt đầu để hiển thị trên Gantt. Hãy tạo task hoặc đặt ngày bắt đầu cho task hiện có."}
          </div>
        ) : (
          bodySize.width > 0 && (
            <>
              <WbsListContext.Provider value={{ renderHeader, renderTable }}>
              <Gantt
                tasks={ganttTasks}
                viewMode={viewMode}
                viewDate={viewDate}
                TooltipContent={TooltipContent}
                locale="vi"
                rowHeight={ROW_HEIGHT}
                headerHeight={HEADER_HEIGHT}
                ganttHeight={ganttHeight}
                listCellWidth={`${listWidth}px`}
                columnWidth={columnWidth}
                // Defaults to a 5-minute step, which snaps a drag to wherever the mouse
                // happens to land instead of the day grid — a whole day here makes every
                // drag jump cleanly from one day-cell to the next, matching how the rest
                // of the app (and a real Gantt chart) treats a day as the smallest unit.
                timeStep={DAY_MS}
                TaskListHeader={WbsListHeader}
                TaskListTable={WbsListTable}
                onSelect={(t: GanttTaskT) =>
                  onSelect(t.id, { toggle: false, range: false }, rows.map((r) => r.task.id))
                }
                onDoubleClick={(t: GanttTaskT) => {
                  const full = byId.get(t.id);
                  if (full) onOpenEdit(full);
                }}
                onDateChange={(t: GanttTaskT) => {
                  const start = toIso(t.start);
                  const end = toIso(t.end);
                  // `end` is an EXCLUSIVE boundary (see ganttMapping.ts's toGanttTasks) —
                  // midnight of the day after the last day of the bar — so the day count
                  // between the two truncated calendar dates *is* the duration, with no
                  // +1 to make it inclusive.
                  const durationDays = Math.max(
                    1,
                    Math.round((new Date(end).getTime() - new Date(start).getTime()) / DAY_MS)
                  );
                  onScheduleChange(t.id, start, durationDays);
                }}
                onProgressChange={(t: GanttTaskT) => onProgressChange(t.id, Math.round(t.progress))}
              />
              </WbsListContext.Provider>
              <div
                className={`gantt-divider ${dragging ? "dragging" : ""}`}
                style={{ left: listWidth }}
                onMouseDown={startDrag}
              />
              <DependencyOverlay
                bodyEl={bodyEl}
                rows={rowTasks}
                showArrows={showDependencies}
                measureKey={measureKey}
                onAddDependency={onAddDependency}
                onEditDependency={onEditDependency}
                onDeleteDependency={onDeleteDependency}
              />
              {showBaseline && (
                <BaselineOverlay
                  bodyEl={bodyEl}
                  rows={rowTasks}
                  ranges={ranges}
                  baselines={baselines}
                  measureKey={measureKey}
                  pxPerDay={columnWidth / DAYS_PER_COLUMN[viewMode]}
                />
              )}
            </>
          )
        )}
      </div>
    </div>
  );
}
