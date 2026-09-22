import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { anchorPoint, buildDependencyPath, type BarRect } from "../dependencyGeometry";
import type { DependencyType, Task } from "../types";

interface Props {
  /** .gantt-body, used to locate the chart's own SVG to portal into. */
  bodyEl: HTMLElement | null;
  /** Tasks with a bar on screen, in the exact order gantt-task-react rendered them. */
  rows: Task[];
  /** Show/hide toggle for the drawn arrows — connection points stay active either way. */
  showArrows: boolean;
  /** Bumped whenever bar geometry could have changed (dates, viewMode, columnWidth, listWidth). */
  measureKey: string;
  onAddDependency: (successorId: string, predecessorId: string, type: DependencyType) => void;
  onEditDependency: (
    successorId: string,
    predecessorId: string,
    currentType: DependencyType,
    next: { type: DependencyType; lagDays: number }
  ) => void;
  onDeleteDependency: (successorId: string, predecessorId: string, type: DependencyType) => void;
}

interface DragState {
  taskId: string;
  edge: "start" | "end";
  x: number;
  y: number;
  /** The anchor the cursor is currently over, if any — the drop target. */
  over: { taskId: string; edge: "start" | "end" } | null;
}

interface SelectedEdge {
  predId: string;
  succId: string;
  type: DependencyType;
  lagDays: number;
}

const TYPE_LABELS: Record<DependencyType, string> = {
  FS: "FS — Kết thúc ▸ Bắt đầu",
  SS: "SS — Bắt đầu ▸ Bắt đầu",
  FF: "FF — Kết thúc ▸ Kết thúc",
  SF: "SF — Bắt đầu ▸ Kết thúc",
};

const POPOVER_WIDTH = 248;
const POPOVER_HEIGHT = 104;

/**
 * gantt-task-react exposes no slot for custom chart-area content and its own
 * dependency arrows carry no FS/SS/FF/SF distinction (`Task.dependencies` is just
 * `string[]`, always drawn as a Finish-to-Start elbow) — see ganttMapping.ts. This
 * portals a custom <g> directly into the library's own bars SVG (found via the
 * stable, unhashed `g.content` element) so it shares that SVG's exact coordinate
 * space and scrolls with it for free, with no manual scroll-offset math. Bar
 * positions are read straight off each bar's own <rect> attributes rather than
 * recomputed, so they're pixel-exact regardless of view mode.
 */
export default function DependencyOverlay({
  bodyEl,
  rows,
  showArrows,
  measureKey,
  onAddDependency,
  onEditDependency,
  onDeleteDependency,
}: Props) {
  const [portalTarget, setPortalTarget] = useState<SVGSVGElement | null>(null);
  const [rects, setRects] = useState<Map<string, BarRect>>(new Map());
  const [hover, setHover] = useState<{ taskId: string; edge: "start" | "end" } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selected, setSelected] = useState<SelectedEdge | null>(null);

  // Always current, read from inside the long-lived MutationObserver callback
  // below rather than `rows` directly, which would otherwise close over a stale
  // array from whichever render first set up the observer.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useLayoutEffect(() => {
    if (!bodyEl) return;

    function measure() {
      const contentG = bodyEl!.querySelector("g.content");
      const svg = contentG?.closest("svg") as SVGSVGElement | null;
      setPortalTarget((prev) => (prev === svg ? prev : svg));
      if (!svg) return;
      const barGroups = svg.querySelectorAll("g.bar > g");
      const next = new Map<string, BarRect>();
      barGroups.forEach((g, i) => {
        const task = rowsRef.current[i];
        const rect = task && g.querySelector("g[tabindex] rect");
        if (!task || !rect) return;
        next.set(task.id, {
          x: parseFloat(rect.getAttribute("x") ?? "0"),
          y: parseFloat(rect.getAttribute("y") ?? "0"),
          width: parseFloat(rect.getAttribute("width") ?? "0"),
          height: parseFloat(rect.getAttribute("height") ?? "0"),
        });
      });
      setRects(next);
    }

    measure();

    // gantt-task-react recomputes bar x/y/width/height (e.g. after a viewMode
    // change) through its own internal effects, which can land a render *after*
    // the one that changed measureKey — measuring only on measureKey can then
    // read stale (pre-recompute) positions. Watching the actual bar attributes
    // catches the library's real final DOM state regardless of its own timing.
    const observer = new MutationObserver(measure);
    observer.observe(bodyEl, {
      subtree: true,
      attributes: true,
      attributeFilter: ["x", "y", "width", "height"],
    });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyEl, measureKey]);

  const dependencies = useMemo(() => {
    const edges: Array<{ predId: string; succId: string; type: DependencyType; lagDays: number }> = [];
    for (const t of rows) {
      for (const p of t.predecessors) {
        edges.push({ predId: p.taskId, succId: t.id, type: p.type, lagDays: p.lagDays });
      }
    }
    return edges;
  }, [rows]);

  if (!portalTarget) return null;

  /** The task/edge anchor under a screen point, if the cursor is over one. */
  function anchorUnder(clientX: number, clientY: number) {
    const el = document.elementFromPoint(clientX, clientY);
    const dot = (el as Element | null)?.closest("[data-dep-task]");
    if (!dot) return null;
    return {
      taskId: dot.getAttribute("data-dep-task")!,
      edge: dot.getAttribute("data-dep-edge") as "start" | "end",
    };
  }

  function startConnect(taskId: string, edge: "start" | "end", e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setSelected(null);
    const svg = portalTarget!;
    const toLocal = (clientX: number, clientY: number) => {
      const r = svg.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };
    const start = toLocal(e.clientX, e.clientY);
    setDrag({ taskId, edge, x: start.x, y: start.y, over: null });

    function onMove(ev: MouseEvent) {
      const p = toLocal(ev.clientX, ev.clientY);
      // Hit-test during the drag, not just on release, so the target anchor can
      // light up and the rubber band can snap to it — otherwise connecting is a
      // guess until you let go and find out whether it took.
      const over = anchorUnder(ev.clientX, ev.clientY);
      setDrag((d) => (d ? { ...d, x: p.x, y: p.y, over: over?.taskId === taskId ? null : over } : d));
    }
    function onUp(ev: MouseEvent) {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const target = anchorUnder(ev.clientX, ev.clientY);
      if (target && target.taskId !== taskId) {
        const type: DependencyType =
          edge === "end" && target.edge === "start"
            ? "FS"
            : edge === "start" && target.edge === "start"
              ? "SS"
              : edge === "end" && target.edge === "end"
                ? "FF"
                : "SF";
        onAddDependency(target.taskId, taskId, type);
      }
      setDrag(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const dragFromRect = drag ? rects.get(drag.taskId) : null;
  const dragFrom = drag && dragFromRect ? anchorPoint(dragFromRect, drag.edge) : null;
  // Snap the loose end to the anchor being hovered, so the line visibly commits
  // to a target before the mouse is released.
  const dragToRect = drag?.over ? rects.get(drag.over.taskId) : null;
  const dragTo =
    drag?.over && dragToRect ? anchorPoint(dragToRect, drag.over.edge) : drag ? { x: drag.x, y: drag.y } : null;

  const selectedPath =
    selected && rects.get(selected.predId) && rects.get(selected.succId)
      ? buildDependencyPath(selected.type, rects.get(selected.predId)!, rects.get(selected.succId)!)
      : null;

  return createPortal(
    <g className="dep-overlay">
      {showArrows && (
        <g className="dep-arrows">
          {dependencies.map(({ predId, succId, type, lagDays }) => {
            const predRect = rects.get(predId);
            const succRect = rects.get(succId);
            if (!predRect || !succRect) return null;
            const { path, arrow } = buildDependencyPath(type, predRect, succRect);
            const isSelected =
              selected?.predId === predId && selected.succId === succId && selected.type === type;
            return (
              <g
                key={`${predId}->${succId}:${type}`}
                className={isSelected ? "dep-arrow dep-arrow-selected" : "dep-arrow"}
              >
                {/* A 1.5px line is nearly impossible to hit. This invisible fat
                    stroke sits underneath and takes the pointer events for it. */}
                <path
                  className="dep-arrow-hit"
                  d={path}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setSelected({ predId, succId, type, lagDays });
                  }}
                />
                <path className="dep-arrow-line" d={path} />
                <polygon points={arrow} />
              </g>
            );
          })}
        </g>
      )}

      <g className="dep-endpoints">
        {rows.map((task) => {
          const rect = rects.get(task.id);
          if (!rect) return null;
          return (["start", "end"] as const).map((edge) => {
            const p = anchorPoint(rect, edge);
            const isHovered = hover?.taskId === task.id && hover.edge === edge;
            const isDropTarget = drag != null && drag.taskId !== task.id;
            const isActiveTarget = drag?.over?.taskId === task.id && drag.over.edge === edge;
            const dotClass = isActiveTarget
              ? "dep-dot dep-dot-active"
              : isDropTarget
                ? "dep-dot dep-dot-target"
                : isHovered
                  ? "dep-dot dep-dot-hover"
                  : "dep-dot";
            return (
              <g key={`${task.id}:${edge}`}>
                {/* Always rendered, not just on hover: a handle you cannot see is
                    a handle nobody drags from. */}
                <circle cx={p.x} cy={p.y} r={4} className={dotClass} />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={9}
                  className="dep-hitzone"
                  data-dep-task={task.id}
                  data-dep-edge={edge}
                  onMouseEnter={() => setHover({ taskId: task.id, edge })}
                  onMouseLeave={() => setHover((h) => (h?.taskId === task.id && h.edge === edge ? null : h))}
                  onMouseDown={(e) => startConnect(task.id, edge, e)}
                />
              </g>
            );
          });
        })}
      </g>

      {drag && dragFrom && dragTo && (
        <line
          x1={dragFrom.x}
          y1={dragFrom.y}
          x2={dragTo.x}
          y2={dragTo.y}
          className={drag.over ? "dep-rubberband dep-rubberband-locked" : "dep-rubberband"}
        />
      )}

      {selected && selectedPath && (
        // foreignObject rather than an HTML overlay in .gantt-body: this lives in
        // the chart's own SVG, so it scrolls with the bars instead of drifting
        // away from its arrow the moment the chart is scrolled.
        <foreignObject
          x={Math.max(4, selectedPath.label.x - POPOVER_WIDTH / 2)}
          y={Math.max(4, selectedPath.label.y - POPOVER_HEIGHT - 10)}
          width={POPOVER_WIDTH}
          height={POPOVER_HEIGHT}
          className="dep-popover-host"
        >
          <div className="dep-popover" onMouseDown={(e) => e.stopPropagation()}>
            <div className="dep-popover-title">
              {selected.predId} → {selected.succId}
            </div>
            <div className="dep-popover-row">
              <select
                value={selected.type}
                onChange={(e) => {
                  const type = e.target.value as DependencyType;
                  onEditDependency(selected.succId, selected.predId, selected.type, {
                    type,
                    lagDays: selected.lagDays,
                  });
                  setSelected({ ...selected, type });
                }}
              >
                {(Object.keys(TYPE_LABELS) as DependencyType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="dep-popover-row">
              <label>
                Trễ
                <input
                  type="number"
                  value={selected.lagDays}
                  onChange={(e) => setSelected({ ...selected, lagDays: Number(e.target.value) })}
                  onBlur={() =>
                    onEditDependency(selected.succId, selected.predId, selected.type, {
                      type: selected.type,
                      lagDays: selected.lagDays,
                    })
                  }
                />
                ngày
              </label>
              <button
                className="dep-popover-delete"
                onClick={() => {
                  onDeleteDependency(selected.succId, selected.predId, selected.type);
                  setSelected(null);
                }}
              >
                Xoá
              </button>
              <button className="dep-popover-close" onClick={() => setSelected(null)}>
                Đóng
              </button>
            </div>
          </div>
        </foreignObject>
      )}
    </g>,
    portalTarget
  );
}
