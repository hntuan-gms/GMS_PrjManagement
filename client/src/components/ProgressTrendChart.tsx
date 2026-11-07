import { useLayoutEffect, useMemo, useRef, useState } from "react";
/** The minimum a point needs: a day and the two figures. A saved report also carries an id that opens it. */
export interface TrendPoint {
  asOf: string;
  actualPct: number;
  plannedPct: number;
  id?: string;
}

interface Props {
  points: TrendPoint[];
  /** Clicking a point that has an id opens that report; without it the chart is read-only. */
  onSelect?: (id: string) => void;
  /** What the points are, for the screen-reader label ("báo cáo", "ngày"). */
  unit?: string;
}

/**
 * Done vs planned % over time: two lines on one axis, so the gap between them is the schedule variance.
 *
 * Drawn in real pixels at the width it is given (measured), never scaled through a viewBox: a scaled SVG
 * grew its axis text to 20px on a wide page and left the plot in one half. 160px tall — a trend is
 * context under the verdict, not the page's subject. No end labels: the figures for today are the bar at
 * the top of the page; hovering gives any day's pair. X is real time, so a gap in measurements reads as one.
 */

const H = 160;
const PAD = { top: 10, right: 12, bottom: 22, left: 36 };
const DAY_MS = 86_400_000;

function toUtc(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

const pct = (n: number) => `${Math.round(n)}%`;

export default function ProgressTrendChart({ points, onSelect, unit = "báo cáo" }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geometry = useMemo(() => {
    const times = points.map((p) => toUtc(p.asOf));
    let t0 = Math.min(...times);
    let t1 = Math.max(...times);
    // Several points on the same day would collapse the axis to zero width.
    if (t1 - t0 < DAY_MS) {
      t0 -= DAY_MS;
      t1 += DAY_MS;
    }
    const innerW = width - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * innerW;
    const y = (v: number) => PAD.top + (1 - Math.min(100, Math.max(0, v)) / 100) * innerH;
    const xs = times.map(x);
    const line = (key: "actualPct" | "plannedPct") =>
      points.map((p, i) => `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
    return { xs, y, actualPath: line("actualPct"), plannedPath: line("plannedPct"), innerH };
  }, [points, width]);

  const last = points[points.length - 1];

  function nearestIndex(clientX: number): number {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return 0;
    const px = clientX - box.left;
    let best = 0;
    for (let i = 1; i < geometry.xs.length; i++) {
      if (Math.abs(geometry.xs[i] - px) < Math.abs(geometry.xs[best] - px)) best = i;
    }
    return best;
  }

  const hovered = hover !== null ? points[hover] : null;
  const hoverX = hover !== null ? geometry.xs[hover] : 0;

  return (
    <div className="pr-trend np-trend">
      <div className="np-legend" aria-hidden="true">
        <span>
          <i className="np-swatch is-actual" /> Đã xong
        </span>
        <span>
          <i className="np-swatch is-planned" /> Kế hoạch
        </span>
      </div>
      <div className="np-trend-plot" ref={boxRef}>
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={`Xu hướng tiến độ qua ${points.length} ${unit}: gần nhất đã xong ${pct(last.actualPct)}, kế hoạch ${pct(last.plannedPct)}`}
          onPointerMove={(e) => setHover(nearestIndex(e.clientX))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            const id = points[nearestIndex(e.clientX)].id;
            if (id && onSelect) onSelect(id);
          }}
          style={{ cursor: onSelect ? "pointer" : undefined }}
        >
          {[0, 50, 100].map((tick) => (
            <g key={tick}>
              <line className={tick === 0 ? "np-axis" : "np-grid"} x1={PAD.left} x2={width - PAD.right} y1={geometry.y(tick)} y2={geometry.y(tick)} />
              <text className="np-tick" x={PAD.left - 8} y={geometry.y(tick) + 4} textAnchor="end">
                {tick}%
              </text>
            </g>
          ))}
          <text className="np-tick" x={geometry.xs[0]} y={H - 6} textAnchor="start">
            {shortDate(points[0].asOf)}
          </text>
          <text className="np-tick" x={geometry.xs[geometry.xs.length - 1]} y={H - 6} textAnchor="end">
            {shortDate(last.asOf)}
          </text>

          <path className="np-path is-planned" d={geometry.plannedPath} />
          <path className="np-path is-actual" d={geometry.actualPath} />

          {hovered && (
            <>
              <line className="np-crosshair" x1={hoverX} x2={hoverX} y1={PAD.top} y2={PAD.top + geometry.innerH} />
              <circle className="np-dot is-planned" cx={hoverX} cy={geometry.y(hovered.plannedPct)} r={3.5} />
              <circle className="np-dot is-actual" cx={hoverX} cy={geometry.y(hovered.actualPct)} r={3.5} />
            </>
          )}
        </svg>

        {hovered && (
          <div className={`np-tip${hoverX > width / 2 ? " is-left" : ""}`} style={{ left: hoverX }} role="status">
            <b>
              {shortDate(hovered.asOf)}/{hovered.asOf.slice(0, 4)}
            </b>
            <span>
              Đã xong <b>{pct(hovered.actualPct)}</b> · kế hoạch {pct(hovered.plannedPct)}
            </span>
            {hovered.id && onSelect && <span className="np-tip-hint">Bấm để mở báo cáo này</span>}
          </div>
        )}
      </div>
    </div>
  );
}
