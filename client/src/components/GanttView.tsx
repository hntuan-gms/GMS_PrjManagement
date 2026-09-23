import { Gantt, ViewMode, type Task as GanttTaskT } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { computeCriticalPath } from "../criticalPath";
import { orderByWbs, resolveRanges, toGanttTasks } from "../ganttMapping";
import type { DependencyType, Task } from "../types";
import DependencyOverlay from "./DependencyOverlay";
import IssueTypeIcon from "./IssueTypeIcon";

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
  onOpenEdit,
  onScheduleChange,
  onProgressChange,
  onAddDependency,
  onEditDependency,
  onDeleteDependency,
}: Props) {
  // The one zoom variable everything else derives from — see pickScale.
  const [pixelsPerDay, setPixelsPerDay] = useState(DEFAULT_PIXELS_PER_DAY[ViewMode.Week]);
  const { viewMode, columnWidth } = pickScale(pixelsPerDay);
  const [showCriticalPath, setShowCriticalPath] = useState(false);
  const [showDependencies, setShowDependencies] = useState(true);
  const [query, setQuery] = useState("");
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
  const defaultListWidth = bodySize.width > 0 ? Math.round(bodySize.width / 2) : 320;
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

  const needle = query.trim().toLowerCase();
  const matchIds = useMemo(() => {
    if (!needle) return null;
    const ids = new Set<string>();
    for (const t of tasks) {
      if (t.id.toLowerCase().includes(needle) || t.summary.toLowerCase().includes(needle)) {
        ids.add(t.id);
      }
    }
    return ids;
  }, [tasks, needle]);

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
  const TaskListHeader = () => (
    <div className="wbs-header" style={{ height: HEADER_HEIGHT, width: listWidth }}>
      <div className="wbs-col wbs-col-key">Mã</div>
      <div className="wbs-col wbs-col-name">Tên công việc</div>
      <div className="wbs-col wbs-col-assignee">Phụ trách</div>
      <div className="wbs-col wbs-col-pct">%</div>
    </div>
  );

  const TaskListTable = () => (
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
          <div className="wbs-col wbs-col-assignee">{task.assigneeName ?? "—"}</div>
          <div className="wbs-col wbs-col-pct">{task.percentComplete}%</div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="gantt-wrap">
      <div className="gantt-toolbar">
        {[ViewMode.Day, ViewMode.Week, ViewMode.Month].map((vm) => (
          <button
            key={vm}
            className={viewMode === vm ? "active" : ""}
            onClick={() => setPixelsPerDay(DEFAULT_PIXELS_PER_DAY[vm])}
          >
            {vm}
          </button>
        ))}
        <span className="gantt-toolbar-divider" aria-hidden="true" />
        <button
          className={showCriticalPath ? "active critical-toggle" : "critical-toggle"}
          onClick={() => setShowCriticalPath((v) => !v)}
          title="Chuỗi công việc quyết định thời gian hoàn thành dự án — trễ bất kỳ task nào trong chuỗi này sẽ làm trễ cả dự án"
        >
          Đường găng
        </button>
        <button
          className={showDependencies ? "active" : ""}
          onClick={() => setShowDependencies((v) => !v)}
          title="Ẩn/hiện mũi tên phụ thuộc giữa các task (FS/SS/FF/SF). Kéo từ đầu hoặc đuôi một task sang task khác để tạo phụ thuộc mới."
        >
          Phụ thuộc
        </button>

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
          {matchIds && <span className="gantt-search-count">{matchIds.size} kết quả</span>}
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
      <div className="gantt-body" ref={bodyRef}>
        {rows.length === 0 ? (
          <div className="empty-state">
            {matchIds?.size === 0
              ? `Không tìm thấy công việc nào khớp với "${query.trim()}".`
              : "Chưa có task nào có ngày bắt đầu để hiển thị trên Gantt. Hãy tạo task hoặc đặt ngày bắt đầu cho task hiện có."}
          </div>
        ) : (
          bodySize.width > 0 && (
            <>
              <Gantt
                tasks={ganttTasks}
                viewMode={viewMode}
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
                TaskListHeader={TaskListHeader}
                TaskListTable={TaskListTable}
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
            </>
          )
        )}
      </div>
    </div>
  );
}
