import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { baselineBox, baselineTitle, slipDays, type Box } from "../baselineGeometry";
import type { DateRange } from "../ganttMapping";
import type { Task } from "../types";

interface Props {
  /** .gantt-body, used to locate the chart's own SVG to portal into. */
  bodyEl: HTMLElement | null;
  /** Tasks with a bar on screen, in the exact order gantt-task-react rendered them. */
  rows: Task[];
  ranges: Map<string, DateRange>;
  baselines: Map<string, DateRange>;
  /** Bumped whenever bar geometry could have changed — the same key DependencyOverlay uses. */
  measureKey: string;
  /** Pixels per day at the current zoom, for bars too short to measure a scale from. */
  pxPerDay: number;
}

interface Measured {
  svg: SVGSVGElement | null;
  width: number;
  bars: Map<string, Box>;
}

function sameBars(a: Map<string, Box>, b: Map<string, Box>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, r] of a) {
    const o = b.get(id);
    if (!o || o.x !== r.x || o.y !== r.y || o.width !== r.width || o.height !== r.height) return false;
  }
  return true;
}

/**
 * Faded baseline strips under the actual bars. gantt-task-react has no slot for
 * this, so it works the way DependencyOverlay does: portal into the library's own
 * bars SVG (shared coordinates, scrolls for free) and read each bar's position
 * straight off its <rect>. The strip lives in the gap the library leaves under
 * every bar, so it never covers a bar or its drag handles.
 */
export default function BaselineOverlay({ bodyEl, rows, ranges, baselines, measureKey, pxPerDay }: Props) {
  const [measured, setMeasured] = useState<Measured>({ svg: null, width: 0, bars: new Map() });

  // Read from inside the long-lived observer callback; see DependencyOverlay.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useLayoutEffect(() => {
    if (!bodyEl) return;

    function measure() {
      const svg = (bodyEl!.querySelector("g.content")?.closest("svg") as SVGSVGElement | null) ?? null;
      const bars = new Map<string, Box>();
      svg?.querySelectorAll("g.bar > g").forEach((g, i) => {
        const task = rowsRef.current[i];
        const rect = task && g.querySelector("g[tabindex] rect");
        if (!task || !rect) return;
        bars.set(task.id, {
          x: parseFloat(rect.getAttribute("x") ?? "0"),
          y: parseFloat(rect.getAttribute("y") ?? "0"),
          width: parseFloat(rect.getAttribute("width") ?? "0"),
          height: parseFloat(rect.getAttribute("height") ?? "0"),
        });
      });
      const width = parseFloat(svg?.getAttribute("width") ?? "0");
      // Our own strips carry x/width attributes too, so this observer also sees
      // them land; keeping the previous state when nothing moved is what stops
      // that from turning into a render loop.
      setMeasured((prev) =>
        prev.svg === svg && prev.width === width && sameBars(prev.bars, bars) ? prev : { svg, width, bars }
      );
    }

    measure();
    const observer = new MutationObserver(measure);
    observer.observe(bodyEl, {
      subtree: true,
      attributes: true,
      attributeFilter: ["x", "y", "width", "height"],
    });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyEl, measureKey]);

  if (!measured.svg) return null;

  const strips: Array<{ id: string; box: Box; slip: number; title: string }> = [];
  for (const t of rows) {
    const bar = measured.bars.get(t.id);
    const range = ranges.get(t.id);
    const baseline = baselines.get(t.id);
    if (!bar || !range || !baseline) continue;
    const box = baselineBox(bar, range, baseline, pxPerDay, measured.width || Infinity);
    if (!box) continue;
    const slip = slipDays(range, baseline);
    strips.push({ id: t.id, box, slip, title: baselineTitle(baseline, slip) });
  }

  return createPortal(
    <g className="baseline-layer">
      {strips.map((s) => (
        <rect
          key={s.id}
          className={`baseline-bar${s.slip > 0 ? " is-late" : ""}`}
          data-task-id={s.id}
          x={s.box.x}
          y={s.box.y}
          width={s.box.width}
          height={s.box.height}
          rx={1.5}
        >
          <title>{s.title}</title>
        </rect>
      ))}
    </g>,
    measured.svg
  );
}
