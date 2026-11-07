import { useMemo } from "react";
import { createPortal } from "react-dom";
import { dateX, isMilestone, type DateRange } from "../timelineGeometry";
import type { ProjectVersion, Task } from "../types";
import { useBarRects } from "../useBarRects";

interface Props {
  /** .gantt-body, used to find the chart's own SVG. */
  bodyEl: HTMLElement | null;
  /** Tasks with a bar, in the order gantt-task-react rendered them. */
  rows: Task[];
  /** Each row's bar span (an Epic's is its children's). */
  ranges: Map<string, DateRange>;
  versions: ProjectVersion[];
  showReleases: boolean;
  measureKey: string;
  /** YYYY-MM-DD: draws the son "now" line. */
  today?: string;
  /** Epics with children: drawn as a bracket (a span), not a solid bar. */
  bracketIds?: Set<string>;
  /** Bản nháp: where moved bars were before the draft (dashed ghosts). */
  ghosts?: Map<string, { start: string; end: string }>;
}

const dmy = (iso: string) => iso.split("-").reverse().join("/");

/** Pixels per day, read off the first bar (the same scale dateX uses). */
function dayWidthOf(refs: Array<{ rect: { width: number }; range: DateRange }>): number {
  const r = refs[0];
  const days = Math.max(1, (Date.parse(r.range.end) - Date.parse(r.range.start)) / 86_400_000 + 1);
  return r.rect.width / days;
}

/**
 * What the Gantt draws besides bars and arrows, portaled into the chart's own SVG
 * like DependencyOverlay so it scrolls and zooms with it: a diamond on milestones and a
 * vertical line at each release date. Baselines are BaselineOverlay's. Nothing here takes
 * pointer events — the bars underneath stay draggable.
 */
export default function TimelineMarkers({ bodyEl, rows, ranges, versions, showReleases, measureKey, today, bracketIds, ghosts }: Props) {
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

  const todayX = today ? dateX(refs, today) : null;
  // Mid-day: the line sits in the middle of today's column, not on its left edge.
  const todayMid = todayX === null || refs.length === 0 ? null : todayX + dayWidthOf(refs) / 2;

  return createPortal(
    <g className="timeline-markers" pointerEvents="none">
      {todayMid !== null && todayMid >= 0 && todayMid <= chartWidth && (
        <g className="today-line">
          <title>{`Hôm nay ${dmy(today!)}`}</title>
          <line x1={todayMid} x2={todayMid} y1={0} y2={chartHeight} />
          <circle cx={todayMid} cy={3} r={3} />
        </g>
      )}
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
                {/* On a plate, so the name does not run into the label of the row it passes over. */}
                <rect className="release-plate" x={x + 2} y={2} width={Math.round(v.name.length * 6.4) + 20} height={14} rx={3} />
                <text x={x + 6} y={12}>
                  ⚑ {v.name}
                </text>
              </g>
            );
          })}

      {rows.map((t) => {
        const rect = rects.get(t.id);
        const range = ranges.get(t.id);
        if (!rect || !range) return null;
        const cy = rect.y + rect.height / 2;
        const bracket = bracketIds?.has(t.id);
        const ghost = ghosts?.get(t.id);
        const gx1 = ghost ? dateX(refs, ghost.start) : null;
        const gx2 = ghost ? dateX(refs, ghost.end) : null;
        // Below the bar, in the gap: at the bar edge it ran through the descenders of the label (ậ, g, y).
        const by = rect.y + rect.height + 4;
        return (
          <g key={t.id}>
            {ghost && gx1 !== null && gx2 !== null && (
              <rect
                className="draft-ghost"
                x={gx1}
                y={rect.y}
                width={Math.max(4, gx2 - gx1 + dayWidthOf(refs))}
                height={rect.height}
                rx={3}
              >
                <title>{`Trước bản nháp: ${dmy(ghost.start)} → ${dmy(ghost.end)}`}</title>
              </rect>
            )}
            {bracket && (
              <path
                className="epic-bracket"
                d={`M${rect.x + 1} ${by - 6} V${by} H${rect.x + rect.width - 1} V${by - 6}`}
              />
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
