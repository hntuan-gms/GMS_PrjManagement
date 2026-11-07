import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { dateAtX, dateEdgeX, dragSpan, shiftDay, type DateRange, type DateRef } from "../timelineGeometry";
import type { Task } from "../types";
import { useBarRects } from "../useBarRects";

interface Props {
  /** .gantt-body, used to find the chart's own SVG. */
  bodyEl: HTMLElement | null;
  /** Every row drawn, in the order gantt-task-react rendered them (the undated ones as invisible bars). */
  rows: Task[];
  /** Each dated row's bar span. A row without one is unscheduled. */
  ranges: Map<string, DateRange>;
  /** Where the invisible bars sit, as a day. */
  anchor: string;
  rowHeight: number;
  /** Pixels per day at the current zoom: the ruler for bars the library drew at its minimum width. */
  pxPerDay: number;
  measureKey: string;
  onSchedule: (id: string, startDate: string, durationDays: number) => void;
}

interface Drawing {
  id: string;
  from: string;
  to: string;
}

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Drag on an undated row to draw its bar (plan C1): press on a day, drag to another, release. A click
 * without a drag is one day. The lane is a transparent rectangle laid over the row inside the chart's own
 * SVG (the technique TimelineMarkers uses), pixels become days through the bars the library really drew
 * (timelineGeometry.dateAtX), and the result goes out as onScheduleChange, the same call a bar drag makes.
 */
export default function UnscheduledLayer({ bodyEl, rows, ranges, anchor, rowHeight, pxPerDay, measureKey, onSchedule }: Props) {
  const { portalTarget, rects } = useBarRects(bodyEl, rows, measureKey);
  const [drawing, setDrawing] = useState<Drawing | null>(null);

  // The rulers: every row's bar with the dates it stands for (an invisible bar stands for the anchor day).
  const refs = useMemo<DateRef[]>(
    () =>
      rows.flatMap((t) => {
        const rect = rects.get(t.id);
        if (!rect) return [];
        const range = ranges.get(t.id) ?? { start: anchor, end: anchor };
        return [{ rect, range }];
      }),
    [rows, rects, ranges, anchor]
  );

  const lanes = useMemo(() => rows.filter((t) => !ranges.has(t.id) && rects.has(t.id)), [rows, ranges, rects]);
  if (!portalTarget || lanes.length === 0) return null;
  const svg = portalTarget;
  const chartWidth = parseFloat(svg.getAttribute("width") ?? "0") || 0;

  function dayAt(clientX: number): string | null {
    const box = svg.getBoundingClientRect();
    return dateAtX(refs, clientX - box.left, pxPerDay);
  }

  function begin(task: Task, e: React.MouseEvent) {
    if (e.button !== 0) return;
    const day = dayAt(e.clientX);
    if (!day) return;
    e.preventDefault();
    e.stopPropagation();
    let current = day;
    setDrawing({ id: task.id, from: day, to: day });
    function move(ev: MouseEvent) {
      const d = dayAt(ev.clientX);
      if (d && d !== current) {
        current = d;
        setDrawing({ id: task.id, from: day!, to: d });
      }
    }
    function finish(ev: MouseEvent) {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("keydown", key, true);
      const end = dayAt(ev.clientX) ?? current;
      setDrawing(null);
      const { start, durationDays } = dragSpan(day!, end);
      onSchedule(task.id, start, durationDays);
    }
    function key(ev: KeyboardEvent) {
      if (ev.key !== "Escape") return;
      ev.stopPropagation();
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("keydown", key, true);
      setDrawing(null);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", finish);
    window.addEventListener("keydown", key, true);
  }

  const span = drawing ? dragSpan(drawing.from, drawing.to) : null;
  const lane = drawing ? lanes.find((t) => t.id === drawing.id) : null;
  const laneRect = lane ? rects.get(lane.id) : null;
  let preview: { x: number; width: number; y: number; height: number; label: string } | null = null;
  if (span && laneRect) {
    const endDay = shiftDay(span.start, span.durationDays - 1);
    const x1 = dateEdgeX(refs, span.start, pxPerDay);
    const x2 = dateEdgeX(refs, shiftDay(endDay, 1), pxPerDay);
    if (x1 !== null && x2 !== null) {
      preview = {
        x: x1,
        width: Math.max(4, x2 - x1),
        y: laneRect.y,
        height: laneRect.height,
        label: `${dm(span.start)} – ${dm(endDay)} (${span.durationDays} ngày)`,
      };
    }
  }

  return createPortal(
    <g className="unscheduled-layer">
      {lanes.map((t) => {
        const r = rects.get(t.id)!;
        const top = r.y - (rowHeight - r.height) / 2;
        return (
          <rect
            key={t.id}
            className="unsched-lane"
            data-task-id={t.id}
            x={0}
            y={top}
            width={chartWidth || "100%"}
            height={rowHeight}
            onMouseDown={(e) => begin(t, e)}
          >
            <title>Kéo để xếp lịch</title>
          </rect>
        );
      })}
      {preview && (
        <g className="unsched-draw" pointerEvents="none">
          <rect x={preview.x} y={preview.y} width={preview.width} height={preview.height} rx={3} />
          <g transform={`translate(${preview.x}, ${Math.max(0, preview.y - 24)})`}>
            <rect className="unsched-tip" width={preview.label.length * 6.6 + 14} height={20} rx={4} />
            <text x={7} y={14}>
              {preview.label}
            </text>
          </g>
        </g>
      )}
    </g>,
    svg
  );
}
