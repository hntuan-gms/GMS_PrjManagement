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
}

interface DragState {
  taskId: string;
  edge: "start" | "end";
  x: number;
  y: number;
}

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
export default function DependencyOverlay({ bodyEl, rows, showArrows, measureKey, onAddDependency }: Props) {
  const [portalTarget, setPortalTarget] = useState<SVGSVGElement | null>(null);
  const [rects, setRects] = useState<Map<string, BarRect>>(new Map());
  const [hover, setHover] = useState<{ taskId: string; edge: "start" | "end" } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

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
    const edges: Array<{ predId: string; succId: string; type: DependencyType }> = [];
    for (const t of rows) {
      for (const p of t.predecessors) edges.push({ predId: p.taskId, succId: t.id, type: p.type });
    }
    return edges;
  }, [rows]);

  if (!portalTarget) return null;

  function startConnect(taskId: string, edge: "start" | "end", e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const svg = portalTarget!;
    const toLocal = (clientX: number, clientY: number) => {
      const r = svg.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };
    const start = toLocal(e.clientX, e.clientY);
    setDrag({ taskId, edge, x: start.x, y: start.y });

    function onMove(ev: MouseEvent) {
      const p = toLocal(ev.clientX, ev.clientY);
      setDrag((d) => (d ? { ...d, x: p.x, y: p.y } : d));
    }
    function onUp(ev: MouseEvent) {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const dot = (el as Element | null)?.closest("[data-dep-task]");
      if (dot) {
        const toTaskId = dot.getAttribute("data-dep-task")!;
        const toEdge = dot.getAttribute("data-dep-edge") as "start" | "end";
        if (toTaskId !== taskId) {
          const type: DependencyType =
            edge === "end" && toEdge === "start"
              ? "FS"
              : edge === "start" && toEdge === "start"
                ? "SS"
                : edge === "end" && toEdge === "end"
                  ? "FF"
                  : "SF";
          onAddDependency(toTaskId, taskId, type);
        }
      }
      setDrag(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const dragFromRect = drag ? rects.get(drag.taskId) : null;
  const dragFrom = drag && dragFromRect ? anchorPoint(dragFromRect, drag.edge) : null;

  return createPortal(
    <g className="dep-overlay">
      {showArrows && (
        <g className="dep-arrows">
          {dependencies.map(({ predId, succId, type }) => {
            const predRect = rects.get(predId);
            const succRect = rects.get(succId);
            if (!predRect || !succRect) return null;
            const { path, arrow } = buildDependencyPath(type, predRect, succRect);
            return (
              <g key={`${predId}->${succId}:${type}`} className="dep-arrow">
                <path d={path} />
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
            return (
              <g key={`${task.id}:${edge}`}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={6}
                  className="dep-hitzone"
                  data-dep-task={task.id}
                  data-dep-edge={edge}
                  onMouseEnter={() => setHover({ taskId: task.id, edge })}
                  onMouseLeave={() => setHover((h) => (h?.taskId === task.id && h.edge === edge ? null : h))}
                  onMouseDown={(e) => startConnect(task.id, edge, e)}
                />
                {isHovered && !drag && <circle cx={p.x} cy={p.y} r={4} className="dep-dot" />}
              </g>
            );
          });
        })}
      </g>

      {drag && dragFrom && (
        <line x1={dragFrom.x} y1={dragFrom.y} x2={drag.x} y2={drag.y} className="dep-rubberband" />
      )}
    </g>,
    portalTarget
  );
}
