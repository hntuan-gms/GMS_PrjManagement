import { useMemo } from "react";
import { createPortal } from "react-dom";
import { baselineStrip, dateX, isMilestone, type DateRange } from "../timelineGeometry";
import type { ProjectVersion, Task } from "../types";
import { useBarRects } from "../useBarRects";

interface Props {
  /** .gantt-body, used to find the chart's own SVG. */
  bodyEl: HTMLElement | null;
  /** Tasks with a bar, in the order gantt-task-react rendered them. */
  rows: Task[];
  /** Each row's bar span (an Epic's is its children's). */
  ranges: Map<string, DateRange>;
  /** The same, from baselines — an Epic's again rolled up from its children's. */
  baselineRanges: Map<string, DateRange>;
  versions: ProjectVersion[];
  showBaseline: boolean;
  showReleases: boolean;
  measureKey: string;
}

const dmy = (iso: string) => iso.split("-").reverse().join("/");

/**
 * What the Gantt draws besides bars and arrows, portaled into the chart's own SVG
 * like DependencyOverlay so it scrolls and zooms with it: a thin strip under each bar
 * showing where it was baselined, a diamond on milestones, and a vertical line at each
 * release date. Nothing here takes pointer events — the bars underneath stay draggable.
 */
export default function TimelineMarkers({ bodyEl, rows, ranges, baselineRanges, versions, showBaseline, showReleases, measureKey }: Props) {
  const { portalTarget, rects } = useBarRects(bodyEl, rows, measureKey);

  const refs = useMemo(
    () =>
      rows.flatMap((t) => {
        const rect = rects.get(t.id);
        const range = ranges.get(t.id);
        return rect && range ? [{ rect, range }] : [];
      }),
    [rows, rects, ranges]
  );

  if (!portalTarget) return null;
  const chartHeight = parseFloat(portalTarget.getAttribute("height") ?? "0") || 0;
  const chartWidth = parseFloat(portalTarget.getAttribute("width") ?? "0") || Infinity;

  return createPortal(
    <g className="timeline-markers" pointerEvents="none">
      {showReleases &&
        versions
          .filter((v) => v.releaseDate && !v.archived)
          .map((v) => {
            const x = dateX(refs, v.releaseDate!);
            if (x === null || x < 0 || x > chartWidth) return null;
            return (
              <g key={v.id} className={`release-line${v.released ? " is-released" : ""}`}>
                <title>{`Phiên bản ${v.name} · phát hành ${dmy(v.releaseDate!)}${v.released ? " (đã phát hành)" : ""}`}</title>
                <line x1={x} x2={x} y1={0} y2={chartHeight} />
                <text x={x + 4} y={12}>
                  ⚑ {v.name}
                </text>
              </g>
            );
          })}

      {rows.map((t) => {
        const rect = rects.get(t.id);
        const range = ranges.get(t.id);
        if (!rect || !range) return null;
        const base = baselineRanges.get(t.id);
        const strip = showBaseline && base ? baselineStrip(rect, range, base) : null;
        const cy = rect.y + rect.height / 2;
        return (
          <g key={t.id}>
            {strip && (
              <rect
                className={`baseline-strip${strip.slipped ? " is-slipped" : ""}`}
                x={strip.x}
                y={rect.y + rect.height + 2}
                width={Math.max(2, strip.width)}
                height={4}
                rx={2}
              >
                <title>{`Baseline ${dmy(base!.start)} – ${dmy(base!.end)}${strip.slipped ? " · đang trễ so với baseline" : ""}`}</title>
              </rect>
            )}
            {isMilestone(t) && (
              <polygon
                className="milestone-diamond"
                points={`${rect.x + rect.width},${cy - 9} ${rect.x + rect.width + 9},${cy} ${rect.x + rect.width},${cy + 9} ${rect.x + rect.width - 9},${cy}`}
              >
                <title>{`Mốc: ${t.summary}`}</title>
              </polygon>
            )}
          </g>
        );
      })}
    </g>,
    portalTarget
  );
}
