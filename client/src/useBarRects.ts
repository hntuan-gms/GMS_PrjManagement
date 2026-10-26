import { useLayoutEffect, useRef, useState } from "react";
import type { BarRect } from "./dependencyGeometry";
import type { Task } from "./types";

/**
 * Where gantt-task-react drew each bar, read straight off the DOM, plus the chart's own
 * SVG for overlays to portal into (it scrolls with the bars for free).
 *
 * The library has no slot for custom chart content and exposes no geometry, so both
 * DependencyOverlay (arrows) and TimelineMarkers (baselines, milestones, releases)
 * measure the same way: the bars are `g.bar > g` in row order, and each one's pixel
 * box is its `<rect>`. `rows` must be the exact list, in the exact order, that was
 * handed to <Gantt>.
 *
 * Re-measured on `measureKey` AND whenever a bar's own x/y/width/height attribute
 * changes: the library recomputes bar boxes in its own effects, which can land a
 * render after the one that changed the key, so measuring on the key alone can read
 * pre-recompute positions.
 */
function sameRects(a: Map<string, BarRect>, b: Map<string, BarRect>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, r] of a) {
    const o = b.get(id);
    if (!o || o.x !== r.x || o.y !== r.y || o.width !== r.width || o.height !== r.height) return false;
  }
  return true;
}

export function useBarRects(bodyEl: HTMLElement | null, rows: Task[], measureKey: string) {
  const [portalTarget, setPortalTarget] = useState<SVGSVGElement | null>(null);
  const [rects, setRects] = useState<Map<string, BarRect>>(new Map());

  // Read from inside the long-lived MutationObserver callback rather than `rows`
  // directly, which would close over whichever array first set the observer up.
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
      // Same boxes → same state. A new Map every time re-rendered every arrow on any attribute
      // change in the chart — including the ones the overlays' own output makes — which on a
      // big project was a render loop (React's "Maximum update depth exceeded").
      setRects((prev) => (sameRects(prev, next) ? prev : next));
    }

    // One measurement per frame however many bars changed (a drag moves many at once).
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    measure();
    const observer = new MutationObserver(schedule);
    observer.observe(bodyEl, {
      subtree: true,
      attributes: true,
      attributeFilter: ["x", "y", "width", "height"],
    });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyEl, measureKey]);

  return { portalTarget, rects };
}
