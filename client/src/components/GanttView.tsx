import { buildEpicIndex, filterTaskIds, isOverdueTask, type TaskFilter } from "../taskFilter";
import FilterBar, { type JqlControl } from "./FilterBar";
import TimelineMarkers from "./TimelineMarkers";
import { dragKeysFor, startTaskDrag } from "../taskDrag";
import { Gantt, ViewMode, type Task as GanttTaskT } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { axisSentinels, isWindowed, windowEnd, windowRows, windowStartFor } from "../ganttWindow";
import { csvName, downloadCsv, type CsvCell } from "../csv";
import { computeCriticalPath } from "../criticalPath";
import { resolveBaselines } from "../baselineGeometry";
import { orderByWbs, resolveRanges, toGanttTasks, type BarColorBy, type OrderedTask } from "../ganttMapping";
import { readPalette } from "../themeColors";
import { useAppearance } from "../useAppearance";
import { ROW_HEIGHTS, getDensity } from "../theme";
import { isAssignableType, type DependencyType, type JiraUser, type ProjectVersion, type ResourcePool, type Task, type TaskTransition, type TaskUpdateInput } from "../types";
import { anchorDay, isMilestone, shiftDay, weekAxisStart } from "../timelineGeometry";
import { weekColumnLabel } from "../dateLabels";
import { toast } from "../toast";
import { changeSchedule, scheduleOf } from "../scheduleFields";
import { formatPredecessors, parsePredecessors } from "../predecessorsText";
import { predecessorProblem } from "../predecessorCheck";
import { fitColumns, MIN_NAME_PX } from "../wbsFit";
import { KIND_OF_COLUMN, editableKinds, neighbourStop, nextRowFor, stopsFor, type CellKind } from "../wbsCells";
import { buildResourceLoad } from "../resourceAllocation";
import { isTypingTarget, overlayOpen } from "../shortcuts";
import { useWorkCalendar } from "./workCalendarContext";
import PersonPicker from "./PersonPicker";
import UnscheduledLayer from "./UnscheduledLayer";
import WbsCellEditor, { type EditValue, type Move } from "./WbsCellEditor";
import { zoomByWheel } from "../timeZoom";
import { SLA_STATE_LABEL, slaIds, slaSentence, slaShortText, type SlaView } from "../sla";
import { overlayCsvCells, overlayCsvHeader } from "../wbsExport";
import BaselineOverlay from "./BaselineOverlay";
import DependencyOverlay from "./DependencyOverlay";
import IssueTypeIcon from "./IssueTypeIcon";
import CellPicker, { type PickItem } from "./CellPicker";
import { api } from "../api";
import PriorityMark from "./PriorityMark";
import StatusGlyph from "./StatusGlyph";
import Avatar from "./Avatar";
import { priorityTone } from "../boardModel";
import { Icon, type IconName } from "./Icons";
import Popover from "./Popover";
import SavedFilterMenu from "./SavedFilterMenu";

// "Spotlight" colours used only while the critical-path toggle is on: critical
// bars get an unambiguous red-orange, everything else is dimmed to grey so the
// chain reads clearly without fighting the normal status/type colour coding
// (which already uses red for Bug and would otherwise be ambiguous with "critical").

/**
 * Row height follows the density setting (theme.ts). A module-level value because the
 * module-level list components (WbsListTable) and the window maths read it; GanttView
 * re-assigns it from useAppearance before its children render, so a density change
 * re-renders everything at the new height.
 */
let ROW_HEIGHT = ROW_HEIGHTS[getDensity()];

const COLOR_BY_KEY = "gms.gantt.colorBy";
const COLOR_BY_LABEL: Record<BarColorBy, string> = { status: "Trạng thái", person: "Người", epic: "Epic", none: "Không" };
function loadColorBy(): BarColorBy {
  try {
    const v = localStorage.getItem(COLOR_BY_KEY);
    return v === "person" || v === "epic" || v === "none" ? v : "status";
  } catch {
    return "status";
  }
}
function saveColorBy(v: BarColorBy) {
  try {
    localStorage.setItem(COLOR_BY_KEY, v);
  } catch {
    /* private mode */
  }
}
const HEADER_HEIGHT = 40;
// Each WBS level steps in by this much; a fixed-width expander slot (reserved even
// on leaf rows, see .wbs-expander-slot) keeps every level's icon aligned under its
// parent's text rather than under the parent's own expander arrow.
const INDENT_STEP = 28;
const MIN_LIST_WIDTH = 220;
const MIN_CHART_WIDTH = 240;
// gantt-task-react always renders its own horizontal scrollbar strip under the
// chart rows; reserve room for it so the fixed-height layout below doesn't clip it.
const SCROLLBAR_RESERVE = 24;
/** The longest a name drawn beside a bar may be before it is cut with an ellipsis (plan C7). */
const MAX_OUTSIDE_LABEL = 240;
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
type WbsRow = OrderedTask;

interface WbsList {
  header: ReactNode;
  /** The whole table, built ahead; null when the chart is windowed and the table follows the library's rows. */
  table: ReactNode;
  buildTable: (list: WbsRow[]) => ReactNode;
  rows: WbsRow[];
  /** task id → position in `rows`; present only when windowed. */
  rowIndex: Map<string, number> | null;
  /** The window the library has actually drawn: first row and how many. */
  onCommitted: (start: number, count: number) => void;
}
const WbsListContext = createContext<WbsList | null>(null);
const useWbsList = () => {
  const ctx = useContext(WbsListContext);
  if (!ctx) throw new Error("WBS list rendered outside GanttView");
  return ctx;
};
function WbsListHeader() {
  return <>{useWbsList().header}</>;
}
function WbsListTable({ tasks }: { tasks: GanttTaskT[] }) {
  const ctx = useWbsList();
  // Windowed: the rows are whatever the library has in `tasks` right now — it adopts a new
  // window one render after GanttView asks for it, and drawing the table from the same list
  // is what keeps a row and its bar on the same line.
  const list = useMemo(() => {
    if (!ctx.rowIndex) return null;
    const out: WbsRow[] = [];
    for (const t of tasks) {
      const i = ctx.rowIndex.get(t.id);
      if (i !== undefined) out.push(ctx.rows[i]);
    }
    return out;
  }, [ctx, tasks]);
  const node = useMemo(() => (list ? ctx.buildTable(list) : ctx.table), [ctx, list]);
  useLayoutEffect(() => {
    if (!list || list.length === 0 || !ctx.rowIndex) return;
    // In the same commit as the new rows and bars, so the offset below them is never out of step.
    ctx.onCommitted(ctx.rowIndex.get(list[0].task.id)!, list.length);
  }, [ctx, list]);
  return <>{node}</>;
}

/**
 * A big chart's own vertical scroll. The page's native scrollbar drives it: a spacer as
 * tall as the full list gives the scrollbar its length, and the chart sits in a sticky
 * stage that stays on screen while only a window of rows exists inside it.
 */
function VirtualStage({
  windowed,
  scrollerRef,
  stageRef,
  onScroll,
  totalHeight,
  height,
  children,
}: {
  windowed: boolean;
  scrollerRef: RefObject<HTMLDivElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  totalHeight: number;
  height: number;
  children: ReactNode;
}) {
  useEffect(() => {
    const el = stageRef.current;
    if (!windowed || !el) return;
    // The library scrolls vertically by itself on a plain wheel and cancels the event, which
    // would stop the page's scrollbar from ever seeing it. Left alone (not cancelled), the
    // browser scrolls it natively; sideways, Shift and pinch-zoom still go to the chart.
    function onWheel(e: WheelEvent) {
      if (e.ctrlKey || e.shiftKey || e.deltaX !== 0) return;
      e.stopPropagation();
    }
    el.addEventListener("wheel", onWheel, { capture: true });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, [windowed, stageRef]);

  if (!windowed) return <>{children}</>;
  return (
    <div className="gantt-vscroll" ref={scrollerRef} onScroll={onScroll}>
      <div style={{ height: totalHeight }}>
        <div className="gantt-stage" ref={stageRef} style={{ height }}>
          {children}
        </div>
      </div>
    </div>
  );
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

/** One row of the "Hiển thị" panel: a display option as a real switch, with the sentence
 * that used to live in the button's tooltip — a tooltip nobody hovers explains nothing. */
function SwitchRow({
  icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="switch-row">
      <Icon name={icon} />
      <span className="switch-text">
        <span className="switch-label">{label}</span>
        {hint && <span className="switch-hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
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
// The pixels-per-day each mode's button jumps to. Each must land *inside its
// own mode's band* in pickScale, or the button highlights a different mode:
// Month's old 200px column (6.6 px/day) made a Week column 46px wide, which
// still fits, so pickScale kept answering Week. Month therefore sits where a
// Week column would be under MIN_COLUMN_WIDTH (< 3.7 px/day).
const DEFAULT_PIXELS_PER_DAY: Record<ViewMode, number> = {
  [ViewMode.Day]: 60,
  [ViewMode.Week]: 160 / DAYS_PER_COLUMN[ViewMode.Week],
  [ViewMode.Month]: 100 / DAYS_PER_COLUMN[ViewMode.Month],
} as Record<ViewMode, number>;

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

type ColumnId = "type" | "status" | "priority" | "labels" | "components" | "versions" | "sprint" | "assignee" | "start" | "due" | "sla" | "duration" | "predecessors" | "estimate" | "spent" | "pct";

interface ColumnDef {
  id: ColumnId;
  label: string;
  /** Spelled out in the chooser, where there is room. */
  long: string;
  width: number;
  align?: "right";
  /**
   * `range` is the bar's own span — an Epic's rolls up its children, so its columns must too.
   * `sla` is the project's computed SLA (null while it is off), which a module-level column cannot reach otherwise.
   */
  cell: (task: Task, range: { start: string; end: string } | undefined, today: string, sla: SlaView | null) => ReactNode;
}

const dm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "—");
const hours = (h: number | null) => (h === null ? "—" : `${Math.round(h * 10) / 10}h`);
const spanDays = (r: { start: string; end: string }) =>
  Math.round((Date.parse(r.end + "T00:00:00Z") - Date.parse(r.start + "T00:00:00Z")) / DAY_MS) + 1;

const COLUMNS: ColumnDef[] = [
  { id: "type", label: "Loại", long: "Loại", width: 70, cell: (t) => t.issueType },
  {
    id: "status",
    label: "Trạng thái",
    long: "Trạng thái",
    width: 112,
    cell: (t) => (
      <span className={`wbs-status is-${t.statusCategory}`} title={t.statusName}>
        <StatusGlyph category={t.statusCategory} percent={t.percentComplete} name={t.statusName} />
        <span className="wbs-status-name">{t.statusName}</span>
      </span>
    ),
  },
  {
    id: "priority",
    label: "Ưu tiên",
    long: "Ưu tiên",
    width: 76,
    cell: (t) => (t.priority ? <span className="wbs-prio"><PriorityMark priority={t.priority} /> {t.priority}</span> : "—"),
  },
  {
    id: "labels",
    label: "Nhãn",
    long: "Nhãn",
    width: 110,
    cell: (t) => (t.labels.length > 0 ? <span title={t.labels.join(", ")}>{t.labels.join(", ")}</span> : "—"),
  },
  {
    id: "components",
    label: "Thành phần",
    long: "Thành phần",
    width: 110,
    cell: (t) => (t.components.length > 0 ? <span title={t.components.join(", ")}>{t.components.join(", ")}</span> : "—"),
  },
  {
    id: "versions",
    label: "Phiên bản",
    long: "Phiên bản",
    width: 100,
    cell: (t) => (t.fixVersions.length > 0 ? <span title={t.fixVersions.join(", ")}>{t.fixVersions.join(", ")}</span> : "—"),
  },
  {
    id: "sprint",
    label: "Sprint",
    long: "Sprint",
    width: 96,
    cell: (t) => (t.sprint ? <span title={`${t.sprint.name} (${t.sprint.state})`}>{t.sprint.name}</span> : "—"),
  },
  {
    id: "assignee",
    label: "Người",
    long: "Người",
    width: 120,
    cell: (t) =>
      t.assigneeName ? (
        <span className="wbs-person" title={t.assigneeName}>
          <Avatar name={t.assigneeName} avatarUrl={t.assigneeAvatarUrl} className="wbs-avatar" decorative />
          <span className="wbs-person-name">{t.assigneeName}</span>
        </span>
      ) : (
        <span className="wbs-none">—</span>
      ),
  },
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
        <span className="wbs-overdue" title={`Quá hạn ${dm(t.dueDate)}`}>
          {dm(r?.end ?? t.dueDate)}
        </span>
      ) : (
        dm(r?.end ?? t.dueDate)
      ),
  },
  {
    id: "sla",
    label: "SLA",
    long: "SLA",
    width: 104,
    cell: (t, _r, _today, sla) => {
      const r = sla?.byId.get(t.id);
      if (!sla || !r) return "—";
      return (
        <span className={`sla-chip is-${r.state}`} title={`${SLA_STATE_LABEL[r.state]}. ${slaSentence(r, sla.settings, sla.nowMs)}`}>
          {slaShortText(r, sla.settings)}
        </span>
      );
    },
  },
  {
    id: "duration",
    label: "T.lượng",
    long: "Thời lượng",
    width: 66,
    align: "right",
    // A row with no date has no duration worth showing: the stored one is only a default.
    cell: (t, r) => (r ? `${spanDays(r)}d` : t.startDate ? `${t.durationDays}d` : "—"),
  },
  {
    id: "predecessors",
    label: "Phụ thuộc",
    long: "Phụ thuộc lịch",
    width: 96,
    cell: (t) =>
      t.predecessors.length > 0 ? (
        <span className="wbs-preds" title={t.predecessors.map((p) => `${p.taskId} ${p.type}${p.lagDays ? (p.lagDays > 0 ? "+" : "") + p.lagDays : ""}`).join(", ")}>
          {formatPredecessors(t.predecessors)}
        </span>
      ) : (
        "—"
      ),
  },
  { id: "estimate", label: "Ước lượng", long: "Ước lượng", width: 76, align: "right", cell: (t) => hours(t.estimateHours) },
  {
    id: "spent",
    label: "Đã ghi",
    long: "Giờ đã ghi",
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
  { id: "pct", label: "%", long: "% hoàn thành", width: 48, align: "right", cell: (t) => (t.percentComplete > 0 ? `${t.percentComplete}%` : "") },
];

/** The same value a column shows, as plain data for a spreadsheet. */
function csvValue(id: ColumnId, t: Task, r: { start: string; end: string } | undefined, sla: SlaView | null): CsvCell {
  switch (id) {
    case "type":
      return t.issueType;
    case "status":
      return t.statusName;
    case "priority":
      return t.priority;
    case "labels":
      return t.labels.join(", ");
    case "components":
      return t.components.join(", ");
    case "versions":
      return t.fixVersions.join(", ");
    case "sprint":
      return t.sprint?.name ?? "";
    case "assignee":
      return t.assigneeName;
    case "start":
      return r?.start ?? t.startDate;
    case "due":
      return r?.end ?? t.dueDate;
    case "sla": {
      const res = sla?.byId.get(t.id);
      return res && sla ? `${SLA_STATE_LABEL[res.state]}. ${slaSentence(res, sla.settings, sla.nowMs)}` : "";
    }
    case "duration":
      return r ? spanDays(r) : t.startDate ? t.durationDays : "";
    case "predecessors":
      return formatPredecessors(t.predecessors);
    case "estimate":
      return t.estimateHours;
    case "spent":
      return t.spentHours;
    case "pct":
      return t.percentComplete;
  }
}

// What a person scanning a plan reads first: what kind of work, where it stands, how urgent,
// who has it, how far along. The rest (dates, estimates, labels…) is a tick away in "Hiển thị".
// Type is the icon beside the name and priority a mark beside it when it is not the ordinary one,
// so neither needs a column of its own (plan §6.1.2): a column of "Medium" was 180px of nothing.
const DEFAULT_COLUMNS: ColumnId[] = ["status", "assignee", "pct"];

const COLUMNS_KEY = "gms.gantt.columns";
const KEY_COL_WIDTH = 64;
const MIN_NAME_WIDTH = 180;
const MIN_NAME_FLOOR = MIN_NAME_PX;

function loadColumns(): ColumnId[] {
  try {
    const raw = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? "null");
    if (Array.isArray(raw)) return raw.filter((id): id is ColumnId => COLUMNS.some((c) => c.id === id));
  } catch {
    // Private mode or a mangled value — the defaults are a fine answer.
  }
  return DEFAULT_COLUMNS;
}

const LIST_WIDTH_KEY = "gms.gantt.listWidth";

/** Where this person last dragged the divider; null = fit the chosen columns. */
function loadListWidth(): number | null {
  try {
    const n = Number(localStorage.getItem(LIST_WIDTH_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function saveListWidth(width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(LIST_WIDTH_KEY);
    else localStorage.setItem(LIST_WIDTH_KEY, String(Math.round(width)));
  } catch {
    // Not remembered across reloads; still applies now.
  }
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
  /** Ctrl A: select exactly these rows (the ones on screen, after filter and collapse). */
  onSelectMany?: (ids: string[]) => void;
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
  onAddDependency: (successorId: string, predecessorId: string, type: DependencyType) => void | Promise<void>;
  onEditDependency: (
    successorId: string,
    predecessorId: string,
    currentType: DependencyType,
    next: { type: DependencyType; lagDays: number }
  ) => void;
  onDeleteDependency: (successorId: string, predecessorId: string, type: DependencyType) => void | Promise<void>;
  /** Releases to draw as lines on the timeline. */
  versions: ProjectVersion[];
  /** Issue keys Jira returned for `filter.jql`; null until they arrive. */
  jqlKeys: Set<string> | null;
  /** The project's computed SLA; null while SLA is off (no "Trễ SLA" button, the column shows "—"). */
  sla: SlaView | null;
  /** The JQL box. */
  jql: JqlControl;
  /** What undo would take back (null = nothing to undo) and how to do it. */
  undo: { label: string | null; onUndo: () => void };
  onOpenImport: () => void;
  /** Opens the KBKT test-case workbook import — beside "Xuất CSV": import next to export. */
  onImportKbkt: () => void;
  /** The "?" sheet, from the "⋯" menu. */
  onOpenShortcuts?: () => void;
  /** "+ Thêm việc" under the last row: one sentence (quickAdd syntax) → one task. */
  onQuickCreate?: (text: string) => Promise<void>;
  /** In-place editing of the Người / Trạng thái cells (plan §6.1.4). */
  users?: JiraUser[];
  onAssign?: (taskId: string, accountId: string | null) => void;
  onTransition?: (task: Task, transitionId: string, toStatusName: string) => void;
  /** Bản nháp: the plan before the draft began; changed bars get a dashed ghost of where they were. */
  draftBase?: Task[] | null;
  /** One field-level write (name, predecessors) with the workspace's staleness guard; throws when Jira refuses. */
  onUpdate?: (id: string, patch: TaskUpdateInput) => Promise<void>;
  /** Leave and capacity, so the assignee picker can say who is free inside a task's dates. Names only without it. */
  pool?: ResourcePool | null;
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

/**
 * The empty row under the plan (plan §6.1.4): type a name — with quick-add tokens if you like —
 * and Enter makes it. Tab first makes it a child of the selected row ("^KEY").
 */
function AddRow({ top, width, parent, onCreate }: { top: number; width: number; parent: Task | null; onCreate: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [asChild, setAsChild] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="wbs-add"
      style={{ top, width }}
      onSubmit={async (e) => {
        e.preventDefault();
        const t = text.trim();
        if (!t || busy) return;
        setBusy(true);
        try {
          await onCreate(asChild && parent ? `${t} ^${parent.id}` : t);
          setText("");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Icon name="plus" size={14} />
      <input
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Tab" && parent && !e.shiftKey && !asChild) {
            e.preventDefault();
            setAsChild(true);
          } else if (e.key === "Tab" && e.shiftKey && asChild) {
            e.preventDefault();
            setAsChild(false);
          } else if (e.key === "Escape") {
            setText("");
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={asChild && parent ? `Sub-task của ${parent.id}… (Shift Tab để bỏ)` : "Thêm việc…"}
        aria-label="Thêm việc"
      />
      <kbd>Enter</kbd>
    </form>
  );
}

export default function GanttView({
  tasks,
  collapsed,
  onToggleCollapse,
  selectedId,
  onSelect,
  onSelectMany,
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
  versions,
  jqlKeys,
  sla,
  jql,
  undo,
  onOpenImport,
  onImportKbkt,
  onOpenShortcuts,
  onQuickCreate,
  users,
  onAssign,
  onTransition,
  draftBase,
  onUpdate,
  pool,
}: Props) {
  // The one zoom variable everything else derives from — see pickScale.
  const [pixelsPerDay, setPixelsPerDay] = useState(DEFAULT_PIXELS_PER_DAY[ViewMode.Week]);
  const scale = pickScale(pixelsPerDay);
  const { viewMode } = scale;
  const [showCriticalPath, setShowCriticalPath] = useState(false);
  const [showDependencies, setShowDependencies] = useState(true);
  const [showBaseline, setShowBaseline] = useState(loadShowBaseline);
  // "Chưa có ngày" as a filter: only the rows that have no date (and their parents). Local, kept nowhere.
  const [onlyUnscheduled, setOnlyUnscheduled] = useState(false);
  const calendar = useWorkCalendar();
  const [colorBy, setColorBy] = useState<BarColorBy>(loadColorBy);
  const appearance = useAppearance();
  ROW_HEIGHT = ROW_HEIGHTS[appearance.density];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chartPalette = useMemo(() => readPalette(), [appearance.theme]);
  // gantt-task-react scrolls to `viewDate` whenever its value changes. The
  // nonce nudges the millisecond so pressing "Hôm nay" again — after scrolling
  // away — is a different value and scrolls again; a day column can't tell.
  const [viewDate, setViewDate] = useState<Date | undefined>();
  const viewNonce = useRef(0);
  const scrollToDate = useCallback((iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    setViewDate(new Date(y, m - 1, d, 0, 0, 0, viewNonce.current++ % 900));
  }, []);
  // Per browser, not per project: which columns someone reads is a habit, not a property of the plan.
  const [columnIds, setColumnIds] = useState<ColumnId[]>(loadColumns);
  // Kept in COLUMNS order whatever order they were ticked in, so the table never reshuffles.
  const columns = useMemo(() => COLUMNS.filter((c) => columnIds.includes(c.id)), [columnIds]);
  const columnsWidth = columns.reduce((s, c) => s + c.width, 0);

  function toggleColumn(id: ColumnId) {
    setColumnIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      saveColumns(next);
      return next;
    });
    // Let the divider re-fit the new set of columns (and forget the old drag, which was for the old set).
    setListWidthOverride(null);
    saveListWidth(null);
  }

  const criticalIds = useMemo(() => computeCriticalPath(tasks), [tasks]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const bodyRef = useRef<HTMLDivElement>(null);
  // Mirrors bodyRef.current into state: DependencyOverlay needs the element itself
  // (to locate the chart's SVG to portal into), and reading ref.current directly
  // during render isn't safe — this effect is the one place that's allowed to.
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 });
  const [listWidthOverride, setListWidthOverride] = useState<number | null>(loadListWidth);
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
  // A key cut to "DEMO-10…" is useless — every key differs exactly in the cut part. The column is
  // as wide as the project's longest key in the mono face (≈7.3px a character at 12px).
  const keyColWidth = useMemo(() => {
    let longest = 0;
    for (const t of tasks) longest = Math.max(longest, t.id.length);
    return Math.max(KEY_COL_WIDTH, Math.ceil(longest * 7.3) + 18);
  }, [tasks]);
  const neededListWidth = keyColWidth + MIN_NAME_WIDTH + columnsWidth;
  // What the chosen columns and a readable name need, but never more than 45% of the window, so on a
  // narrow screen the time axis still gets most of it. The name keeps a floor of 120px.
  const defaultListWidth = Math.min(
    neededListWidth + 60,
    Math.max(Math.floor(bodySize.width * 0.45), keyColWidth + MIN_NAME_FLOOR + columnsWidth)
  );
  // A dragged divider is respected, but not past 60% of the window.
  const maxListWidth = Math.min(Math.max(MIN_LIST_WIDTH, bodySize.width - MIN_CHART_WIDTH), Math.floor(bodySize.width * 0.6));
  const listWidth = Math.min(maxListWidth, Math.max(MIN_LIST_WIDTH, listWidthOverride ?? defaultListWidth));
  const ganttHeight = Math.max(ROW_HEIGHT, bodySize.height - HEADER_HEIGHT - SCROLLBAR_RESERVE);
  // Narrow table (the detail panel or the assistant is open, or the divider was dragged in): the name keeps
  // MIN_NAME_PX and the columns give way (wbsFit.ts) instead of every one staying put while the name shrinks.
  const fitted = useMemo(() => fitColumns(columns, listWidth - keyColWidth - MIN_NAME_PX), [columns, listWidth, keyColWidth]);
  const shownColumns = fitted.columns;

  // Trackpad pinch (and Ctrl+wheel) only — a plain two-finger scroll must keep
  // panning the chart, not hijack it into a zoom. Browsers report pinch-to-zoom
  // as a wheel event with ctrlKey set specifically so a page can tell the two
  // apart and override the browser's own page-zoom with its own behaviour.
  //
  // Registered as a native, non-passive listener rather than React's onWheel:
  // React attaches wheel handlers as passive by default, where preventDefault()
  // is silently ignored — the browser would still zoom the whole page underneath
  // this chart's own zoom.
  //
  // In the CAPTURE phase, and the event is stopped here: gantt-task-react listens for wheel on
  // its own wrapper (below this element) and treats any wheel without Shift or a sideways delta
  // as a vertical scroll of its rows. Left to bubble up, a pinch scrolled the rows by deltaY
  // on top of zooming — on a long list the rows slid out of view while zooming. Zoom is the time
  // axis only; the rows must not move.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      setPixelsPerDay((prev) => zoomByWheel(prev, e.deltaY, MIN_PIXELS_PER_DAY, MAX_PIXELS_PER_DAY));
    }
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
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
    const skipEvery = scale.columnWidth < MIN_COLUMN_WIDTH + 8 ? 2 : 1;

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
  }, [bodyEl, viewMode, scale.columnWidth]);

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = listWidth;
    let latest = startWidth;
    setDragging(true);
    function onMove(ev: MouseEvent) {
      latest = startWidth + (ev.clientX - startX);
      setListWidthOverride(latest);
    }
    function onUp() {
      setDragging(false);
      // Clamped like the rendered width, so a wild drag is not remembered as an unusable one.
      if (latest !== startWidth) saveListWidth(Math.min(maxListWidth, Math.max(MIN_LIST_WIDTH, latest)));
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
  const slaBreached = useMemo(() => (sla ? slaIds(sla.byId, "breached") : null), [sla]);
  const matchIds = useMemo(
    () => filterTaskIds(tasks, filter, { today, epicOf, jqlKeys, slaBreached }),
    [tasks, filter, today, epicOf, jqlKeys, slaBreached]
  );
  // Tasks with no resolvable date (not even an Epic's rollup): they keep their row, the bar is drawn by dragging.
  const unscheduledIds = useMemo(
    () => new Set(tasks.filter((t) => !ranges.has(t.id) && (!matchIds || matchIds.has(t.id))).map((t) => t.id)),
    [tasks, ranges, matchIds]
  );
  // Switched off by itself when nothing is left to schedule, so a stale toggle cannot hide the whole plan.
  const unscheduledOnly = onlyUnscheduled && unscheduledIds.size > 0;
  const shownIds = unscheduledOnly ? unscheduledIds : matchIds;

  /**
   * Matches plus their ancestors. Keeping matches alone would strip a matched
   * Sub-task of the Epic/Story rows that identify it, and leave gaps in the
   * indentation that make the remaining depth values look arbitrary.
   */
  const searchKeep = useMemo(() => {
    if (!shownIds) return null;
    const keep = new Set<string>();
    for (const id of shownIds) {
      let cur: string | null = id;
      // Doubles as a cycle guard: a malformed parent chain would otherwise spin
      // here and hang the render thread rather than fail visibly.
      while (cur && !keep.has(cur)) {
        keep.add(cur);
        cur = byId.get(cur)?.wbsParentId ?? null;
      }
    }
    return keep;
  }, [shownIds, byId]);

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
  // drift out of row alignment. A task without a date is a row too: its bar is an
  // invisible placeholder (toGanttTasks), which keeps one bar per row.
  const rows = visible;
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
  // Pixels one day is wide at this zoom, and the width of the time pane: today is placed a third of the way
  // in, not on the left edge where the library puts a scrolled-to column.
  const pxPerDay = scale.columnWidth / DAYS_PER_COLUMN[viewMode];
  const chartPaneWidth = Math.max(0, bodySize.width - listWidth - 24);
  function goToToday(quiet = false) {
    let first: string | null = null;
    let last: string | null = null;
    for (const row of rows) {
      const r = ranges.get(row.task.id);
      if (!r) continue;
      if (!first || r.start < first) first = r.start;
      if (!last || r.end > last) last = r.end;
    }
    if (first && today < first) {
      if (!quiet) setTodayNote("Hôm nay nằm trước thanh đầu tiên của biểu đồ.");
      scrollToDate(first);
    } else if (last && today > last) {
      if (!quiet) setTodayNote("Hôm nay nằm sau thanh cuối cùng của biểu đồ.");
      scrollToDate(last);
    } else {
      setTodayNote(null);
      scrollToDate(pxPerDay > 0 ? shiftDay(today, -Math.round(chartPaneWidth / 3 / pxPerDay)) : today);
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

  function exportCsv() {
    // Matches only: the table keeps their ancestors for indentation, but a sheet of
    // "what the filter found" should not list parents the filter excluded.
    const list = ordered.filter((o) => !matchIds || matchIds.has(o.task.id));
    // The overlay block (dependencies, baseline, and % unless it is already a
    // visible column) always follows: it is the data Jira's own export lacks.
    const includePct = !columnIds.includes("pct");
    const header = ["Mã", "Tên việc", ...columns.map((c) => c.long), ...overlayCsvHeader(includePct)];
    const body = list.map((o) => [
      o.task.id,
      o.task.summary,
      ...columns.map((c) => csvValue(c.id, o.task, ranges.get(o.task.id), sla)),
      ...overlayCsvCells(o.task, ranges.get(o.task.id), baselines.get(o.task.id), includePct),
    ]);
    downloadCsv(csvName(`wbs-${tasks[0]?.id.split("-")[0] ?? "du-an"}`, today), [header, ...body]);
  }

  // Replaces the library's English hover card ("Duration: 3 day(s)").
  const TooltipContent = useMemo(
    () =>
      function GanttTooltip({ task }: { task: GanttTaskT; fontSize: string; fontFamily: string }) {
        const full = byId.get(task.id);
        if (full && !ranges.has(full.id)) {
          return (
            <div className="gantt-tip">
              <b>{task.id}</b> · {full.summary}
              <div>Chưa có ngày · kéo để xếp lịch</div>
            </div>
          );
        }
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
    [byId, ranges]
  );
  // Where each bar was before the draft, for the ones the draft moved.
  const draftGhosts = useMemo(() => {
    if (!draftBase) return undefined;
    const m = new Map<string, { start: string; end: string }>();
    for (const b of draftBase) {
      const now = byId.get(b.id);
      if (now && b.startDate && b.dueDate && (now.startDate !== b.startDate || now.dueDate !== b.dueDate)) {
        m.set(b.id, { start: b.startDate, end: b.dueDate });
      }
    }
    return m;
  }, [draftBase, byId]);
  const bracketIds = useMemo(
    () => new Set(rows.filter((r) => r.hasChildren && r.task.issueType === "Epic").map((r) => r.task.id)),
    [rows]
  );
  // An Epic with children is drawn as a bracket in the gap under its label, where its baseline strip
  // would also go; a container has no plan of its own worth a second line there.
  const shownBaselines = useMemo(() => {
    const m = new Map(baselines);
    for (const id of bracketIds) m.delete(id);
    return m;
  }, [baselines, bracketIds]);
  // The day the invisible bars of undated rows sit on: today, kept inside what the dated bars span so the
  // library's date axis (sized from every task it is given) is exactly what it would be without them.
  const placeholderDay = useMemo(() => {
    let first: string | null = null;
    let last: string | null = null;
    for (const r of rows) {
      const range = ranges.get(r.task.id);
      if (!range) continue;
      if (!first || range.start < first) first = range.start;
      if (!last || range.end > last) last = range.end;
    }
    return anchorDay(today, first, last);
  }, [rows, ranges, today]);
  const allGanttTasks = useMemo(() => {
    const palette = readPalette();
    // Category order is stable and meaningful: people by name, Epics in WBS order — never a hash.
    const people = [...new Set(rows.map((r) => r.task.assigneeName).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b, "vi"));
    const personIndex = new Map(people.map((n, i) => [n, i]));
    const epicIndex = new Map(rows.filter((r) => r.task.issueType === "Epic").map((r, i) => [r.task.id, i]));
    const byIdLocal = new Map(rows.map((r) => [r.task.id, r.task]));
    const epicOf = (t: Task): string | null => {
      let cur: Task | undefined = t;
      for (let i = 0; cur && i < 8; i++) {
        if (cur.issueType === "Epic") return cur.id;
        cur = cur.wbsParentId ? byIdLocal.get(cur.wbsParentId) : undefined;
      }
      return null;
    };
    const base = toGanttTasks(
      rows,
      ranges,
      {
        colorBy,
        palette,
        today,
        categoryOf: (t) => {
          if (colorBy === "person") return t.assigneeName ? (personIndex.get(t.assigneeName) ?? null) : null;
          const e = epicOf(t);
          return e ? (epicIndex.get(e) ?? null) : null;
        },
      },
      placeholderDay
    );
    if (!showCriticalPath) return base;
    // Critical path: the chain that sets the end date is drawn in son ("this is what decides
    // the date"), everything else steps back to the quietest tone.
    const crit = { backgroundColor: palette.sonWash, backgroundSelectedColor: palette.sonWash, progressColor: palette.son, progressSelectedColor: palette.son };
    const dim = { backgroundColor: palette.sunken, backgroundSelectedColor: palette.line, progressColor: palette.lineStrong, progressSelectedColor: palette.lineStrong };
    // The invisible bars of undated rows keep their own transparent style.
    return base.map((t) => (!ranges.has(t.id) ? t : { ...t, styles: criticalIds.has(t.id) ? crit : dim }));
    // appearance.theme: re-read the palette when the theme flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, ranges, showCriticalPath, criticalIds, colorBy, today, appearance.theme, placeholderDay]);

  // Month view's axis is short: gantt-task-react ends it at the start of the year after the
  // last task's end, so a project inside one year draws a handful of columns and leaves the
  // rest of the window blank. Those few columns are widened to fill the chart pane instead
  // (the same count the library makes — seedDates, with its default of one step before).
  const columnWidth = useMemo(() => {
    if (viewMode !== ViewMode.Month || allGanttTasks.length === 0) return scale.columnWidth;
    let min = allGanttTasks[0].start;
    let max = allGanttTasks[0].end;
    for (const t of allGanttTasks) {
      if (t.start < min) min = t.start;
      if (t.end > max) max = t.end;
    }
    const first = min.getFullYear() * 12 + min.getMonth() - 1;
    const columns = (max.getFullYear() + 1) * 12 - first + 1;
    // Room for the page's vertical scrollbar beside the chart.
    const available = bodySize.width - listWidth - 24;
    return Math.max(scale.columnWidth, Math.floor(available / columns));
  }, [viewMode, allGanttTasks, scale.columnWidth, bodySize.width, listWidth]);

  /* ---- in-place cell editing (plan C4) ---- */
  // Status and assignee open a list; name, dates, duration, % and predecessors open a small box over the cell.
  const [cellEdit, setCellEdit] = useState<{ task: Task; kind: "assignee" | "status"; rect: DOMRect } | null>(null);
  const [cellTransitions, setCellTransitions] = useState<TaskTransition[] | null>(null);
  const [boxEdit, setBoxEdit] = useState<{ id: string; kind: Exclude<CellKind, "assignee">; rect: DOMRect } | null>(null);
  // The cell Enter edits next: where an edit last ended, for the row that is still selected.
  const [cursor, setCursor] = useState<{ id: string; kind: CellKind } | null>(null);
  const pendingEdit = useRef<number | undefined>(undefined);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const openCellEditor = (task: Task, kind: "assignee" | "status", rect: DOMRect) => {
    setCellEdit({ task, kind, rect });
    setCellTransitions(null);
    if (kind === "status") {
      api.getTaskTransitions(task.id).then(setCellTransitions, () => setCellTransitions([]));
    }
  };
  const openCellEditorRef = useRef(openCellEditor);
  openCellEditorRef.current = openCellEditor;
  const kindsOf = useCallback(
    (row: Pick<WbsRow, "task" | "hasChildren">) =>
      editableKinds({
        issueType: row.task.issueType,
        hasChildren: row.hasChildren,
        canAssign: !!onAssign && isAssignableType(row.task.issueType),
        canUpdate: !!onUpdate,
        canSchedule: true,
        canProgress: true,
      }),
    [onAssign, onUpdate]
  );
  const rowById = useMemo(() => new Map(rows.map((r) => [r.task.id, r])), [rows]);
  const rowOrder = useMemo(() => rows.map((r) => r.task.id), [rows]);

  /** Opens the editor for one cell of a row that is on screen; a row outside the drawn window has no cell to open. */
  function openCell(id: string, kind: CellKind) {
    const el = document.querySelector<HTMLElement>(`.wbs-row[data-row-id="${CSS.escape(id)}"] [data-cell="${kind}"]`);
    const task = byId.get(id);
    if (!el || !task) return;
    openCellAt(task, kind, el.getBoundingClientRect());
  }
  function openCellAt(task: Task, kind: CellKind, rect: DOMRect) {
    setCursor({ id: task.id, kind });
    if (kind === "assignee") {
      setBoxEdit(null);
      openCellEditor(task, "assignee", rect);
    } else {
      setCellEdit(null);
      setBoxEdit({ id: task.id, kind, rect });
    }
  }
  // A click on a cell of an already selected row starts the edit, but a beat later: the second click of a
  // double-click lands on the same cell and must still open the task (the row handler cancels this).
  function armEdit(task: Task, kind: CellKind, el: HTMLElement) {
    window.clearTimeout(pendingEdit.current);
    pendingEdit.current = window.setTimeout(() => {
      pendingEdit.current = undefined;
      if (el.isConnected) openCellAt(task, kind, el.getBoundingClientRect());
    }, 300);
  }
  const cancelArmedEdit = () => {
    window.clearTimeout(pendingEdit.current);
    pendingEdit.current = undefined;
  };

  function writeField(id: string, patch: TaskUpdateInput) {
    onUpdate?.(id, patch).catch((e) => toast(e instanceof Error ? e.message : "Không lưu được thay đổi.", { tone: "error" }));
  }

  /** Saves what was typed into a cell; a returned sentence means "refused", and the box stays open on it. */
  function saveCell(task: Task, kind: CellKind, value: EditValue): string | void {
    if (value === null) return;
    if (kind === "summary") {
      const summary = String(value).trim();
      if (!summary) return "Tên việc không được để trống.";
      writeField(task.id, { summary });
    } else if (kind === "start" || kind === "due" || kind === "duration") {
      const res = changeSchedule(scheduleOf(task.startDate, task.durationDays), kind, value);
      if (res.rejected === "due-before-start") return "Kết thúc trước ngày bắt đầu.";
      if (res.rejected) return "Giá trị không hợp lệ.";
      if (!res.start) return "Đặt ngày bắt đầu trước.";
      onScheduleChange(task.id, res.start, Math.max(1, Math.ceil(res.durationDays)));
    } else if (kind === "pct") {
      onProgressChange(task.id, Math.max(0, Math.min(100, Math.round(Number(value)))));
    } else if (kind === "predecessors") {
      const prefix = task.id.includes("-") ? task.id.slice(0, task.id.lastIndexOf("-")) : "";
      const parsed = parsePredecessors(String(value), prefix);
      if (!parsed.ok) return parsed.error;
      const problem = predecessorProblem(tasksRef.current, task.id, parsed.predecessors);
      if (problem) return problem;
      writeField(task.id, { predecessors: parsed.predecessors });
    }
  }

  function commitBox(edit: { id: string; kind: Exclude<CellKind, "assignee"> }, value: EditValue, move: Move): string | void {
    const task = byId.get(edit.id);
    if (!task) {
      setBoxEdit(null);
      return;
    }
    const refused = saveCell(task, edit.kind, value);
    if (refused) return refused;
    setBoxEdit(null);
    setCursor({ id: edit.id, kind: edit.kind });
    if (move === "stay") return;
    const row = rowById.get(edit.id);
    if (move === "down") {
      const next = nextRowFor(rowOrder, edit.id, (id) => {
        const r = rowById.get(id);
        return !!r && kindsOf(r).has(edit.kind);
      });
      if (!next) return;
      onSelect(next, { toggle: false, range: false }, rowOrder);
      requestAnimationFrame(() => openCell(next, edit.kind));
    } else if (row) {
      const stop = neighbourStop(stopsFor(kindsOf(row), columnIds), edit.kind, move === "next" ? 1 : -1);
      if (stop) requestAnimationFrame(() => openCell(edit.id, stop));
    }
  }

  /** What each box starts with. */
  function initialOf(task: Task, kind: Exclude<CellKind, "assignee">): string | number | null {
    const sched = scheduleOf(task.startDate, task.durationDays);
    switch (kind) {
      case "summary":
        return task.summary;
      case "start":
        return task.startDate ?? "";
      case "due":
        return sched.due;
      case "duration": {
        const r = ranges.get(task.id);
        return r ? spanDays(r) : task.durationDays;
      }
      case "pct":
        return task.percentComplete;
      case "predecessors":
        return formatPredecessors(task.predecessors);
    }
  }

  // Who the picker offers, ranked by who is free inside this task's dates. Only worked out while it is open.
  const assignLoad = useMemo(() => {
    const t = cellEdit?.kind === "assignee" ? cellEdit.task : null;
    if (!t?.startDate || !users) return null;
    return buildResourceLoad({
      tasks,
      users,
      profiles: pool?.profiles ?? [],
      absences: pool?.absences ?? [],
      defaultCapacityHours: pool?.defaultCapacityHours,
      from: t.startDate,
      to: t.dueDate && t.dueDate >= t.startDate ? t.dueDate : t.startDate,
      includeIdle: true,
      calendar,
    });
  }, [cellEdit, tasks, users, pool, calendar]);

  const cellItems: PickItem[] | null =
    !cellEdit || cellEdit.kind === "assignee" || cellTransitions === null
      ? null
      : cellTransitions
          .filter((t) => t.toStatusName !== cellEdit.task.statusName)
          .map((t) => ({
            id: t.id,
            label: t.toStatusName,
            lead: <StatusGlyph category={t.toCategory} />,
            hint: t.fields.some((f) => !f.optional) ? "cần nhập thêm" : t.name !== t.toStatusName ? t.name : undefined,
          }));
  const cellEditor =
    cellEdit &&
    (cellEdit.kind === "assignee" ? (
      <PersonPicker
        anchor={cellEdit.rect}
        people={users ?? null}
        task={assignLoad ? cellEdit.task : null}
        load={assignLoad}
        calendar={calendar}
        currentAccountId={cellEdit.task.assigneeAccountId}
        meAccountId={myAccountId}
        placeholder={`Giao ${cellEdit.task.id} cho…`}
        onClose={() => setCellEdit(null)}
        onPick={(accountId) => {
          const { task } = cellEdit;
          setCellEdit(null);
          onAssign?.(task.id, accountId);
        }}
      />
    ) : (
      <CellPicker
        anchor={cellEdit.rect}
        items={cellItems}
        loading={cellTransitions === null}
        placeholder={`Chuyển ${cellEdit.task.id} sang…`}
        onClose={() => setCellEdit(null)}
        onPick={(it) => {
          const { task } = cellEdit;
          setCellEdit(null);
          onTransition?.(task, it.id, it.label);
        }}
      />
    ));
  const boxTask = boxEdit ? byId.get(boxEdit.id) : undefined;
  const boxEditor = boxEdit && boxTask && (
    <WbsCellEditor
      key={`${boxEdit.id}:${boxEdit.kind}`}
      kind={boxEdit.kind}
      anchor={boxEdit.rect}
      initial={initialOf(boxTask, boxEdit.kind)}
      base={boxEdit.kind === "due" ? (boxTask.startDate ?? undefined) : undefined}
      onCommit={(value, move) => commitBox(boxEdit, value, move)}
      onCancel={() => {
        setBoxEdit(null);
        setCursor({ id: boxEdit.id, kind: boxEdit.kind });
      }}
    />
  );

  // F2 edits the name (or the cell the last edit ended on) of the selected row; Enter does the same once there
  // is such a cell, and opens the task otherwise. Never while typing or with a layer open.
  const keyState = useRef({ selectedId, selectedIds, cursor, columnIds, onOpenEdit });
  keyState.current = { selectedId, selectedIds, cursor, columnIds, onOpenEdit };
  const cellKeys = useRef({ rowById, kindsOf, openCell });
  cellKeys.current = { rowById, kindsOf, openCell };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "F2" && e.key !== "Enter") return;
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isTypingTarget(e.target) || overlayOpen()) return;
      if (e.key === "Enter" && (e.target as HTMLElement | null)?.closest?.("button, a, summary, [role=menuitem]")) return;
      const k = keyState.current;
      const id = k.selectedId;
      if (!id || k.selectedIds.size > 1) return;
      const row = cellKeys.current.rowById.get(id);
      if (!row) return;
      const stops = stopsFor(cellKeys.current.kindsOf(row), k.columnIds);
      const here = k.cursor && k.cursor.id === id && stops.includes(k.cursor.kind) ? k.cursor.kind : null;
      if (e.key === "F2" || here) {
        const kind = here ?? stops[0];
        if (!kind) return;
        e.preventDefault();
        cellKeys.current.openCell(id, kind);
      } else {
        e.preventDefault();
        k.onOpenEdit(row.task);
      }
    }
    // Capture phase: the library's wrapper (which holds focus after a click) calls preventDefault on every key.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // A connection made by dragging from the dot at a bar end: say what was joined, with the way back.
  async function connect(successorId: string, predecessorId: string, type: DependencyType) {
    const already = tasksRef.current.find((t) => t.id === successorId)?.predecessors.some((p) => p.taskId === predecessorId && p.type === type);
    await onAddDependency(successorId, predecessorId, type);
    if (already) return;
    // The workspace applies the answer to its state a tick after its promise settles.
    await new Promise((r) => setTimeout(r, 0));
    const joined = tasksRef.current.find((t) => t.id === successorId)?.predecessors.some((p) => p.taskId === predecessorId && p.type === type);
    if (!joined) return;
    toast(`Đã nối ${predecessorId} → ${successorId} (${type})`, {
      action: { label: "Hoàn tác", run: () => void onDeleteDependency(successorId, predecessorId, type) },
    });
  }

  // "T" anywhere in the workspace (ProjectWorkspace's keyboard layer) scrolls the chart to today.
  const goToTodayRef = useRef(goToToday);
  goToTodayRef.current = goToToday;
  useEffect(() => {
    const onToday = () => goToTodayRef.current();
    window.addEventListener("gms:gantt-today", onToday);
    return () => window.removeEventListener("gms:gantt-today", onToday);
  }, []);
  // J / K, Ctrl A, S and A from the workspace's keyboard layer (ProjectWorkspace dispatches them: it owns the gating
  // for typing and open layers). The row under the cursor is the selected one.
  const planKeys = useRef({ rowOrder, selectedId, onSelect, onSelectMany, byId, onAssign, onTransition });
  planKeys.current = { rowOrder, selectedId, onSelect, onSelectMany, byId, onAssign, onTransition };
  useEffect(() => {
    const onMove = (ev: Event) => {
      const k = planKeys.current;
      const delta = (ev as CustomEvent<{ delta: number }>).detail?.delta ?? 1;
      if (k.rowOrder.length === 0) return;
      const at = k.selectedId ? k.rowOrder.indexOf(k.selectedId) : -1;
      const next = k.rowOrder[Math.max(0, Math.min(k.rowOrder.length - 1, at < 0 ? 0 : at + delta))];
      if (!next) return;
      k.onSelect(next, { toggle: false, range: false }, k.rowOrder);
      document.querySelector(`.wbs-row[data-row-id="${CSS.escape(next)}"]`)?.scrollIntoView({ block: "nearest" });
    };
    const onAll = () => {
      const k = planKeys.current;
      k.onSelectMany?.(k.rowOrder);
    };
    const onPick = (ev: Event) => {
      const k = planKeys.current;
      const kind = (ev as CustomEvent<{ kind: "status" | "assignee" }>).detail?.kind;
      const task = k.selectedId ? k.byId.get(k.selectedId) : null;
      if (!task || !kind) return;
      if (kind === "assignee" && !(k.onAssign && isAssignableType(task.issueType))) return;
      if (kind === "status" && !k.onTransition) return;
      const row = document.querySelector<HTMLElement>(`.wbs-row[data-row-id="${CSS.escape(task.id)}"]`);
      // The cell when its column is shown; the row's own box when not (the picker needs somewhere to hang).
      const anchor = row?.querySelector<HTMLElement>(`[data-cell="${kind}"]`) ?? row;
      if (!anchor) return;
      openCellEditorRef.current(task, kind, anchor.getBoundingClientRect());
    };
    window.addEventListener("gms:gantt-move", onMove);
    window.addEventListener("gms:gantt-select-all", onAll);
    window.addEventListener("gms:gantt-pick", onPick);
    return () => {
      window.removeEventListener("gms:gantt-move", onMove);
      window.removeEventListener("gms:gantt-select-all", onAll);
      window.removeEventListener("gms:gantt-pick", onPick);
    };
  }, []);
  // The first time the plan is on screen it opens at today (a third of the way in), not at the oldest bar.
  const openedAtToday = useRef(false);
  useEffect(() => {
    if (openedAtToday.current || bodySize.width <= 0 || rows.length === 0) return;
    openedAtToday.current = true;
    goToTodayRef.current(true);
  }, [bodySize.width, rows.length]);

  /* ---- a big list is drawn a window at a time (ganttWindow.ts) ---- */
  const windowed = isWindowed(rows.length);
  const viewportRows = Math.ceil(ganttHeight / ROW_HEIGHT);
  // What the page scrollbar asks for, and what the library has actually drawn so far. The
  // library adopts a new window one render late, so anything that reads the DOM (the overlays,
  // the offset below) follows the second, and only the library's own task list follows the first.
  const [wantedStart, setWantedStart] = useState(0);
  const [drawn, setDrawn] = useState({ start: 0, count: 0 });
  const start = windowed ? Math.min(wantedStart, Math.max(0, rows.length - windowRows(viewportRows))) : 0;
  const end = windowed ? windowEnd(start, rows.length, viewportRows) : rows.length;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drawnStartRef = useRef(0);
  // Rows move up by how far the page is scrolled past the first drawn row. A CSS variable on
  // the stage, not state: a scroll event only writes it, and a row the library has just
  // created already has the right offset on its first frame.
  const applyOffset = useCallback(() => {
    const sc = scrollerRef.current;
    const stage = stageRef.current;
    if (!sc || !stage) return;
    stage.style.setProperty("--gms-row-offset", `${sc.scrollTop - drawnStartRef.current * ROW_HEIGHT}px`);
  }, []);
  const onCommitted = useCallback(
    (s: number, count: number) => {
      drawnStartRef.current = s;
      applyOffset();
      setDrawn((prev) => (prev.start === s && prev.count === count ? prev : { start: s, count }));
    },
    [applyOffset]
  );
  const onVScroll = () => {
    const sc = scrollerRef.current;
    if (!sc) return;
    applyOffset();
    const s = windowStartFor(sc.scrollTop, ROW_HEIGHT, rows.length, viewportRows);
    setWantedStart((prev) => (prev === s ? prev : s));
  };
  const ganttTasks = useMemo(() => {
    if (!windowed) return allGanttTasks;
    // Two invisible bars hold the date axis where the whole list puts it (ganttWindow.axisSentinels).
    const sentinels = axisSentinels(allGanttTasks, (id, s, e): GanttTaskT => ({
      id,
      name: "",
      start: s,
      end: e,
      progress: 0,
      type: "task",
      dependencies: [],
      isDisabled: true,
      styles: { backgroundColor: "transparent", progressColor: "transparent", backgroundSelectedColor: "transparent" },
    }));
    return [...allGanttTasks.slice(start, end), ...sentinels];
  }, [windowed, allGanttTasks, start, end]);
  // The bars the DOM has, for the overlays that measure them.
  const drawnGanttTasks = useMemo(
    () => (windowed ? allGanttTasks.slice(drawn.start, drawn.start + drawn.count) : allGanttTasks),
    [windowed, allGanttTasks, drawn]
  );

  // Week view's axis says "W44", an ISO week number in English. Each column is named by the date its week
  // starts on instead ("02/11"), the same as the resource tab's week columns. The library numbers a column by
  // its position, and its first column is a fixed distance before the earliest bar (weekAxisStart).
  const weekOrigin = useMemo(() => {
    let min: Date | null = null;
    for (const t of ganttTasks) if (!min || t.start < min) min = t.start;
    return min ? weekAxisStart(toIso(min)) : null;
  }, [ganttTasks]);
  useEffect(() => {
    if (!bodyEl || viewMode !== ViewMode.Week || !weekOrigin) return;
    const skipEvery = columnWidth < 46 ? 2 : 1;
    function relabel() {
      bodyEl!.querySelectorAll<SVGTextElement>("text._9w8d5").forEach((el) => {
        const raw = el.dataset.fullLabel ?? el.textContent ?? "";
        if (!/^W\d+$/.test(raw)) return;
        if (!el.dataset.fullLabel) el.dataset.fullLabel = raw;
        const i = Math.round(parseFloat(el.getAttribute("x") ?? "0") / columnWidth);
        const next = i % skipEvery === 0 ? weekColumnLabel(shiftDay(weekOrigin!, 7 * i)) : "";
        if (el.textContent !== next) el.textContent = next;
      });
    }
    relabel();
    const observer = new MutationObserver(relabel);
    observer.observe(bodyEl, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [bodyEl, viewMode, weekOrigin, columnWidth]);

  // A label drawn beside a short bar runs on until it meets whatever lies to its right. It is cut at
  // MAX_OUTSIDE_LABEL px with an ellipsis; the whole name stays in the tooltip and the table.
  useEffect(() => {
    if (!bodyEl) return;
    let frame = 0;
    // Measuring a text forces layout, and the label only depends on its own text: one that still reads what
    // this wrote last needs no second look (measuring all of them on every scroll made frames 600 ms long).
    function clip() {
      frame = 0;
      bodyEl!.querySelectorAll<SVGTextElement>("text._3KcaM").forEach((el) => {
        const cur = el.textContent ?? "";
        if (el.dataset.clipped !== undefined && cur === el.dataset.clipped) return;
        // What React last wrote is the full name; what this wrote last is the cut one.
        const full = el.dataset.full === undefined || (cur !== el.dataset.clipped && cur !== el.dataset.full) ? cur : el.dataset.full;
        let next = full;
        if (full.length > 0 && el.getComputedTextLength() > MAX_OUTSIDE_LABEL) {
          let n = full.length;
          do {
            n = Math.max(1, n - Math.max(1, Math.ceil(n / 8)));
            next = full.slice(0, n).trimEnd() + "…";
            el.textContent = next;
          } while (n > 1 && el.getComputedTextLength() > MAX_OUTSIDE_LABEL);
        }
        el.dataset.full = full;
        el.dataset.clipped = next;
        if (el.textContent !== next) el.textContent = next;
      });
    }
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          clip();
          observer.takeRecords();
        });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(bodyEl, { subtree: true, childList: true, characterData: true });
    clip();
    // What clip() itself wrote is not news.
    observer.takeRecords();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [bodyEl]);

  // Bumped whenever a bar's actual on-screen position could have changed, so
  // DependencyOverlay knows when to re-measure. Own dates in ms rather than
  // object identity, since ganttTasks gets a new array/Date identity on every
  // render regardless of whether anything actually moved.
  const measureKey = useMemo(
    () =>
      `${viewMode}:${columnWidth}:${listWidth}:` +
      drawnGanttTasks.map((t) => `${t.id}=${t.start.getTime()}-${t.end.getTime()}`).join(","),
    [viewMode, columnWidth, listWidth, drawnGanttTasks]
  );
  const rowTasks = useMemo(
    () => (windowed ? rows.slice(drawn.start, drawn.start + drawn.count) : rows).map((r) => r.task),
    [windowed, rows, drawn]
  );

  // The month label stays in view: the library centres "Tháng 11, 2026" on its month, so scrolled to the middle of a
  // month the label sits half off the left edge and reads ", 2026". Its x is moved to keep it inside the visible
  // part of its month (the library's own x is remembered in data-cx; a re-render that writes a new x wins).
  const hasHeader = bodySize.width > 0 && rows.length > 0;
  useEffect(() => {
    if (!bodyEl || !hasHeader) return;
    const first = bodyEl.querySelector<SVGTextElement>("text._2q1Kt");
    const headerSvg = first?.closest("svg") ?? null;
    const scroller = headerSvg?.parentElement ?? null;
    if (!headerSvg || !scroller) return;
    let frame = 0;
    function place() {
      frame = 0;
      const labels = Array.from(headerSvg!.querySelectorAll<SVGTextElement>("text._2q1Kt"));
      if (labels.length === 0) return;
      const left = scroller!.scrollLeft;
      const centres = labels.map((el) => {
        const attr = el.getAttribute("x") ?? "0";
        if (el.dataset.sx !== attr) el.dataset.cx = attr;
        // Measured once per text: measuring forces layout, and a label's width only changes with its words.
        if (el.dataset.half === undefined || el.dataset.halfOf !== el.textContent) {
          el.dataset.half = String(el.getComputedTextLength() / 2);
          el.dataset.halfOf = el.textContent ?? "";
        }
        return Number(el.dataset.cx);
      });
      labels.forEach((el, i) => {
        const half = Number(el.dataset.half);
        const c = centres[i];
        const room = i + 1 < centres.length ? (centres[i + 1] - c) / 2 : i > 0 ? (c - centres[i - 1]) / 2 : half;
        const x = Math.min(Math.max(c, left + half + 8), c + Math.max(0, room - half - 4));
        const next = String(Math.round(x));
        if (el.getAttribute("x") !== next) el.setAttribute("x", next);
        el.dataset.sx = el.getAttribute("x") ?? "";
      });
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    scroller.addEventListener("scroll", schedule);
    // Only the header is watched (a zoom rewrites its labels); the rows below change on every scroll step.
    const observer = new MutationObserver(schedule);
    observer.observe(headerSvg, { subtree: true, childList: true, attributes: true, attributeFilter: ["x"] });
    schedule();
    return () => {
      scroller.removeEventListener("scroll", schedule);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [bodyEl, hasHeader, viewMode, columnWidth]);

  // The rows selected in the table get an outline on their bars too (the bars are read by row index, like the overlays).
  useEffect(() => {
    if (!bodyEl) return;
    const bars = bodyEl.querySelectorAll<SVGGElement>("g.bar > g");
    drawnGanttTasks.forEach((t, i) => {
      const el = bars[i];
      if (!el) return;
      if (selectedIds.has(t.id) || t.id === selectedId) el.setAttribute("data-selected", "");
      else el.removeAttribute("data-selected");
    });
  }, [bodyEl, selectedIds, selectedId, drawnGanttTasks, measureKey]);

  // gantt-task-react does NOT size its TaskList wrapper to listCellWidth itself —
  // it only forwards that value as a `rowWidth` prop and expects the consumer's own
  // TaskListHeader/TaskListTable to apply it. Without an explicit width here, these
  // roots stay at their shrink-to-fit content width, so dragging the divider moves
  // only the handle (which follows `listWidth` directly) while the WBS pane itself
  // never actually resizes.
  const header = useMemo(
    () => (
    <div className="wbs-header" style={{ height: HEADER_HEIGHT, width: listWidth }}>
      <div className="wbs-col wbs-col-key">Mã</div>
      <div className="wbs-col wbs-col-name">Tên việc</div>
      {shownColumns.map((c) => (
        <div
          key={c.id}
          className={`wbs-col wbs-col-extra ${c.align === "right" ? "is-right" : ""}${c.compact ? " is-compact" : ""}`}
          style={{ width: c.fitWidth }}
          title={c.long}
        >
          {c.compact ? "" : c.label}
        </div>
      ))}
    </div>
    ),
    [shownColumns, listWidth]
  );

  const buildTable = useCallback(
    (list: WbsRow[]) => (
    <div className="wbs-rows" style={{ width: listWidth }}>
      {list.map((row) => {
        const { task, depth, hasChildren } = row;
        const rowSelected = selectedIds.has(task.id) || task.id === selectedId;
        const kinds = kindsOf(row);
        const loneSelected = rowSelected && selectedIds.size <= 1;
        const cursorKind = rowSelected && cursor?.id === task.id ? cursor.kind : boxEdit?.id === task.id ? boxEdit.kind : null;
        /** A click on a cell of the row that was already selected edits it; on any other row it only selects. */
        const editClick = (kind: CellKind) => (e: React.MouseEvent<HTMLElement>) => {
          if (!loneSelected || e.ctrlKey || e.metaKey || e.shiftKey || !kinds.has(kind)) return;
          e.stopPropagation();
          armEdit(task, kind, e.currentTarget);
        };
        return (
        <div
          key={task.id}
          data-row-id={task.id}
          className={`wbs-row ${matchIds?.has(task.id) ? "wbs-row-match" : ""} ${rowSelected ? "wbs-row-selected" : ""} ${
            showCriticalPath && criticalIds.has(task.id) ? "wbs-row-critical" : ""
          }${unscheduledIds.has(task.id) ? " is-unscheduled" : ""}`}
          style={{ height: ROW_HEIGHT }}
          draggable
          onDragStart={(e) => {
            // Work leaves the plan by hand: this row, or the whole selection when the row is part of it, as in a
            // file manager. Fields inside the row keep their own text selection.
            if ((e.target as HTMLElement).closest("input, select, textarea")) {
              e.preventDefault();
              return;
            }
            const order = rows.map((r) => r.task.id);
            startTaskDrag(e, dragKeysFor(task.id, selectedIds, order), task.summary);
            // Selecting on grab is deferred: re-rendering the row inside dragstart can cancel the drag.
            if (!selectedIds.has(task.id)) window.setTimeout(() => onSelect(task.id, { toggle: false, range: false }, order), 0);
          }}
          onClick={(e) =>
            onSelect(
              task.id,
              { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey },
              rows.map((r) => r.task.id)
            )
          }
          onDoubleClick={() => {
            cancelArmedEdit();
            setBoxEdit(null);
            onOpenEdit(task);
          }}
        >
          <div className="wbs-col wbs-col-key">
            <a href={task.jiraUrl} target="_blank" rel="noreferrer" draggable={false} onClick={(e) => e.stopPropagation()}>
              {task.id}
            </a>
          </div>
          <div
            className={`wbs-col wbs-col-name${cursorKind === "summary" ? " wbs-cell-cursor" : ""}`}
            data-cell="summary"
            style={{ paddingLeft: depth * INDENT_STEP }}
            onClick={editClick("summary")}
          >
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
            {priorityTone(task.priority) === "high" || priorityTone(task.priority) === "low" ? <PriorityMark priority={task.priority} /> : null}
            <span className={hasChildren ? "wbs-summary wbs-summary-parent" : "wbs-summary"}>
              {isMilestone(task) && (
                <span className="wbs-milestone" title="Mốc" aria-hidden="true">
                  ◆{" "}
                </span>
              )}
              {task.summary}
            </span>
          </div>
          {shownColumns.map((c) => {
            const editable = (c.id === "assignee" && onAssign && isAssignableType(task.issueType)) || (c.id === "status" && onTransition);
            const kind = KIND_OF_COLUMN[c.id];
            const boxKind = !editable && kind && kinds.has(kind) ? kind : null;
            return (
              <div
                key={c.id}
                data-cell={c.id}
                className={`wbs-col wbs-col-extra wbs-cell-${c.id} ${c.align === "right" ? "is-right" : ""}${c.compact ? " is-compact" : ""}${editable ? " is-editable" : ""}${
                  cursorKind !== null && cursorKind === kind ? " wbs-cell-cursor" : ""
                }`}
                style={{ width: c.fitWidth }}
                title={editable ? (c.id === "assignee" ? "Bấm để giao người" : "Bấm để đổi trạng thái") : undefined}
                onClick={
                  editable
                    ? (e) => {
                        e.stopPropagation();
                        openCellEditor(task, c.id as "assignee" | "status", (e.currentTarget as HTMLElement).getBoundingClientRect());
                      }
                    : boxKind
                      ? editClick(boxKind)
                      : undefined
                }
                // A double-click still opens the task (the row's handler — CLAUDE.md: double-click
                // anywhere on a row must open it); the picker its first click opened goes away.
                onDoubleClick={editable ? () => setCellEdit(null) : undefined}
              >
                {c.cell(task, ranges.get(task.id), today, sla)}
              </div>
            );
          })}
        </div>
        );
      })}
    </div>
    ),
    // openCellEditor and the edit helpers only set state; onAssign/onTransition/onUpdate decide what is editable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, matchIds, selectedIds, selectedId, showCriticalPath, criticalIds, listWidth, shownColumns, collapsed, ranges, today, sla, onSelect, onOpenEdit, onToggleCollapse, onAssign, onTransition, onUpdate, unscheduledIds, cursor, boxEdit]
  );
  const table = useMemo(() => (windowed ? null : buildTable(rows)), [windowed, buildTable, rows]);
  const rowIndex = useMemo(() => (windowed ? new Map(rows.map((r, i) => [r.task.id, i])) : null), [windowed, rows]);
  const wbsList = useMemo<WbsList>(
    () => ({ header, table, buildTable, rows, rowIndex, onCommitted }),
    [header, table, buildTable, rows, rowIndex, onCommitted]
  );

  return (
    <div className="gantt-wrap">
      {/* One row. Left: find and narrow (search, JQL, saved views, quick switches, the
          "Bộ lọc" panel). Right: how the chart looks and what goes in or out of it. The
          selection bar lays itself over this row rather than pushing the page down. */}
      <FilterBar
        className="gantt-toolbar"
        tasks={tasks}
        filter={filter}
        onChange={onFilterChange}
        myAccountId={myAccountId}
        matched={matchIds?.size}
        total={tasks.length}
        showSearch
        leading={<SavedFilterMenu filter={filter} onApply={onFilterChange} myAccountId={myAccountId} />}
        jql={jql}
        onClearExtras={() => setOnlyUnscheduled(false)}
        quick={[
          // Kept while it is switched on, even if SLA was turned off since, so it can be switched off.
          ...(sla || filter.onlySlaBreached
            ? [
                {
                  key: "sla",
                  label: `Trễ SLA${slaBreached ? ` (${slaBreached.size})` : ""}`,
                  icon: "clock" as const,
                  on: filter.onlySlaBreached,
                  onToggle: () => onFilterChange({ ...filter, onlySlaBreached: !filter.onlySlaBreached }),
                  title: "Quá hạn SLA",
                },
              ]
            : []),
          ...(unscheduledIds.size > 0 || onlyUnscheduled
            ? [
                {
                  key: "unscheduled",
                  label: `Chưa có ngày (${unscheduledIds.size})`,
                  icon: "alert" as const,
                  on: unscheduledOnly,
                  onToggle: () => setOnlyUnscheduled((v) => !v),
                  title: "Chỉ hiện việc chưa có ngày",
                },
              ]
            : []),
        ]}
        trailing={
          <>
            <div className="seg-group" role="group" aria-label="Chia theo">
              {[ViewMode.Day, ViewMode.Week, ViewMode.Month].map((vm) => (
                <button
                  key={vm}
                  type="button"
                  className={viewMode === vm ? "active" : ""}
                  aria-pressed={viewMode === vm}
                  onClick={() => setPixelsPerDay(DEFAULT_PIXELS_PER_DAY[vm])}
                >
                  {VIEW_MODE_LABEL[vm]}
                </button>
              ))}
            </div>
            <span className="tb-today">
              <button type="button" className="tb-btn" onClick={() => goToToday()} title="Cuộn tới hôm nay (T)">
                <Icon name="calendar" size={14} className="tb-today-icon" />
                <span className="fb-label">Về hôm nay</span>
              </button>
              {todayNote && (
                <span className="gantt-today-note" role="status">
                  {todayNote}
                </span>
              )}
            </span>
            <span className="tb-sep" aria-hidden="true" />
            <button
              type="button"
              className="tb-btn tb-icon"
              onClick={undo.onUndo}
              disabled={!undo.label}
              aria-label="Hoàn tác"
              title={undo.label ? `Hoàn tác: ${undo.label} (Ctrl+Z)` : "Hoàn tác (Ctrl+Z)"}
            >
              <Icon name="undo" />
            </button>
            <span className="tb-sep" aria-hidden="true" />
            <Popover
              className="tb-btn tb-icon"
              role="menu"
              align="end"
              caret={false}
              ariaLabel="Thêm"
              menuLabel="Hiển thị, nhập, xuất"
              menuClassName="more-menu view-menu io-menu"
              title="Hiển thị, nhập, xuất"
              label={<Icon name="more" />}
            >
              {({ close }) => (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    disabled={parentIds.length === 0}
                    aria-label="Thu gọn tất cả nhóm"
                    onClick={() => {
                      close();
                      onSetCollapsed(parentIds);
                    }}
                  >
                    <Icon name="collapseAll" />
                    Thu gọn tất cả
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    disabled={collapsed.size === 0}
                    aria-label="Mở rộng tất cả nhóm"
                    onClick={() => {
                      close();
                      onSetCollapsed([]);
                    }}
                  >
                    <Icon name="expandAll" />
                    Mở rộng tất cả
                  </button>
                  <div className="menu-sep" role="separator" />
                  <div className="menu-heading">Tô màu theo</div>
                  <div className="seg-group view-colorby" role="group" aria-label="Tô màu thanh theo">
                    {(Object.keys(COLOR_BY_LABEL) as BarColorBy[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        className={colorBy === k ? "active" : ""}
                        aria-pressed={colorBy === k}
                        onClick={() => {
                          setColorBy(k);
                          saveColorBy(k);
                        }}
                      >
                        {COLOR_BY_LABEL[k]}
                      </button>
                    ))}
                  </div>
                  <div className="menu-heading">Biểu đồ</div>
                  <SwitchRow
                    icon="critical"
                    label="Đường găng"
                    checked={showCriticalPath}
                    onChange={setShowCriticalPath}
                  />
                  <SwitchRow
                    icon="link"
                    label="Phụ thuộc"
                    checked={showDependencies}
                    onChange={setShowDependencies}
                  />
                  <SwitchRow
                    icon="layers"
                    label="Baseline"
                    checked={showBaseline}
                    onChange={(next) => {
                      setShowBaseline(next);
                      saveShowBaseline(next);
                    }}
                  />
                  <div className="menu-sep" role="separator" />
                  <div className="menu-heading">Cột</div>
                  <div className="col-grid">
                    {COLUMNS.map((c) => (
                      <label key={c.id} className="col-chooser-item">
                        <input type="checkbox" checked={columnIds.includes(c.id)} onChange={() => toggleColumn(c.id)} />
                        {c.long}
                      </label>
                    ))}
                  </div>
                  <div className="col-chooser-foot">
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => {
                        setColumnIds(DEFAULT_COLUMNS);
                        saveColumns(DEFAULT_COLUMNS);
                      }}
                    >
                      Mặc định
                    </button>
                    <button
                      type="button"
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
                  <div className="menu-sep" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      close();
                      onOpenImport();
                    }}
                  >
                    <Icon name="upload" />
                    Nhập việc…
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      close();
                      onImportKbkt();
                    }}
                  >
                    <Icon name="upload" />
                    Nhập KBKT…
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      close();
                      exportCsv();
                    }}
                  >
                    <Icon name="download" />
                    Xuất CSV
                  </button>
                  {onOpenShortcuts && (
                    <>
                      <div className="menu-sep" role="separator" />
                      <button
                        type="button"
                        role="menuitem"
                        className="menu-item"
                        onClick={() => {
                          close();
                          onOpenShortcuts();
                        }}
                      >
                        <Icon name="keyboard" />
                        Phím tắt
                        <kbd>?</kbd>
                      </button>
                    </>
                  )}
                </>
              )}
            </Popover>
          </>
        }
      />
      {/* The empty state lives inside .gantt-body rather than replacing it: the
          ResizeObserver attaches to bodyRef once on mount, so unmounting this node
          when a query matches nothing would leave the observer bound to a detached
          element and freeze bodySize once the query was cleared again. */}
      <div className="gantt-body" ref={bodyRef} style={{ "--wbs-key-w": `${keyColWidth}px` } as React.CSSProperties}>
        {rows.length === 0 ? (
          <div className="empty-state">
            {matchIds?.size === 0 ? "Không có việc nào khớp bộ lọc." : "Chưa có việc nào trong dự án."}
          </div>
        ) : (
          bodySize.width > 0 && (
            <>
              <WbsListContext.Provider value={wbsList}>
              <VirtualStage
                windowed={windowed}
                scrollerRef={scrollerRef}
                stageRef={stageRef}
                onScroll={onVScroll}
                totalHeight={rows.length * ROW_HEIGHT + HEADER_HEIGHT + SCROLLBAR_RESERVE}
                height={bodySize.height}
              >
              <Gantt
                tasks={ganttTasks}
                viewMode={viewMode}
                viewDate={viewDate}
                TooltipContent={TooltipContent}
                locale="vi"
                rowHeight={ROW_HEIGHT}
                headerHeight={HEADER_HEIGHT}
                barFill={60}
                barCornerRadius={3}
                handleWidth={6}
                fontFamily="var(--font-sans)"
                fontSize="12px"
                todayColor="transparent"
                arrowColor={chartPalette.ink4}
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
              </VirtualStage>
              </WbsListContext.Provider>
              <div
                className={`gantt-divider ${dragging ? "dragging" : ""}`}
                style={{ left: listWidth }}
                onMouseDown={startDrag}
              />
              {cellEditor}
              {boxEditor}
              {onQuickCreate && !windowed && HEADER_HEIGHT + (rows.length + 1) * ROW_HEIGHT < bodySize.height && (
                <AddRow
                  top={HEADER_HEIGHT + rows.length * ROW_HEIGHT}
                  width={listWidth}
                  parent={selectedId ? (byId.get(selectedId) ?? null) : null}
                  onCreate={onQuickCreate}
                />
              )}
              <TimelineMarkers
                bodyEl={bodyEl}
                rows={rowTasks}
                ranges={ranges}
                versions={versions}
                showReleases
                measureKey={measureKey}
                today={today}
                bracketIds={bracketIds}
                ghosts={draftGhosts}
              />
              <DependencyOverlay
                bodyEl={bodyEl}
                rows={rowTasks}
                showArrows={showDependencies}
                measureKey={measureKey}
                hidden={unscheduledIds}
                onAddDependency={connect}
                onEditDependency={onEditDependency}
                onDeleteDependency={onDeleteDependency}
                onFixViolation={(id, start) => {
                  const t = byId.get(id);
                  if (t) onScheduleChange(id, start, Math.max(1, t.durationDays));
                }}
              />
              {unscheduledIds.size > 0 && (
                <UnscheduledLayer
                  bodyEl={bodyEl}
                  rows={rowTasks}
                  ranges={ranges}
                  anchor={placeholderDay}
                  rowHeight={ROW_HEIGHT}
                  pxPerDay={columnWidth / DAYS_PER_COLUMN[viewMode]}
                  measureKey={measureKey}
                  onSchedule={onScheduleChange}
                />
              )}
              {showBaseline && (
                <BaselineOverlay
                  bodyEl={bodyEl}
                  rows={rowTasks}
                  ranges={ranges}
                  baselines={shownBaselines}
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
