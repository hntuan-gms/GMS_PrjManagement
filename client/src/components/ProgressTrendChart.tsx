import { useMemo, useRef, useState } from "react";
import type { ReportPoint } from "../types";

interface Props {
  points: ReportPoint[];
  onSelect: (id: string) => void;
}

/**
 * Actual vs planned % across saved reports.
 *
 * Emphasis form, not categorical: "actual" is the story, in the accent blue;
 * "planned" is the context it's measured against, in the de-emphasis gray. Two
 * series, so there is a legend AND direct end labels — identity never rests on
 * colour alone. The gap between the lines is the schedule variance a PM cares
 * about, which is why this is two lines on one axis rather than a single SPI
 * line: a ratio hides whether "0.9" means 9% of 10% or 54% of 60%.
 *
 * X is real time (report dates), not report index — reports are generated when
 * someone asks, so an evenly spaced axis would make a two-month gap look like a
 * two-day one. Hover snaps a crosshair to the nearest report; the history table
 * beside the chart is the no-hover view of the same values.
 */

const W = 520;
const H = 220;
const PAD = { top: 14, right: 104, bottom: 26, left: 36 };
const DAY_MS = 86_400_000;

function toUtc(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export default function ProgressTrendChart({ points, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const times = points.map((p) => toUtc(p.asOf));
    let t0 = Math.min(...times);
    let t1 = Math.max(...times);
    // Several reports on the same day would collapse the axis to zero width.
    if (t1 - t0 < DAY_MS) {
      t0 -= DAY_MS;
      t1 += DAY_MS;
    }
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * innerW;
    const y = (pct: number) => PAD.top + (1 - Math.min(100, Math.max(0, pct)) / 100) * innerH;
    const xs = times.map(x);
    const line = (key: "actualPct" | "plannedPct") =>
      points.map((p, i) => `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
    return { xs, y, actualPath: line("actualPct"), plannedPath: line("plannedPct"), innerH };
  }, [points]);

  const last = points[points.length - 1];
  const lastX = geometry.xs[geometry.xs.length - 1];
  const yActual = geometry.y(last.actualPct);
  const yPlanned = geometry.y(last.plannedPct);
  // End labels that would overlap are pushed apart just enough to both read;
  // the end-dots stay on the true values so nothing is misplotted.
  const minGap = 14;
  let labelActual = yActual;
  let labelPlanned = yPlanned;
  if (Math.abs(labelActual - labelPlanned) < minGap) {
    const mid = (labelActual + labelPlanned) / 2;
    const actualAbove = last.actualPct >= last.plannedPct;
    labelActual = mid + (actualAbove ? -minGap / 2 : minGap / 2);
    labelPlanned = mid + (actualAbove ? minGap / 2 : -minGap / 2);
  }

  function nearestIndex(clientX: number): number {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < geometry.xs.length; i++) {
      if (Math.abs(geometry.xs[i] - px) < Math.abs(geometry.xs[best] - px)) best = i;
    }
    return best;
  }

  const hovered = hover !== null ? points[hover] : null;
  const hoverX = hover !== null ? geometry.xs[hover] : 0;

  return (
    <div className="pr-trend">
      <div className="pr-legend" aria-hidden="true">
        <span>
          <i className="pr-key pr-key-actual" /> Thực tế
        </span>
        <span>
          <i className="pr-key pr-key-planned" /> Kế hoạch
        </span>
      </div>
      <div className="pr-trend-plot">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Xu hướng tiến độ qua ${points.length} báo cáo: gần nhất thực tế ${last.actualPct}%, kế hoạch ${last.plannedPct}%`}
          onPointerMove={(e) => setHover(nearestIndex(e.clientX))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => onSelect(points[nearestIndex(e.clientX)].id)}
        >
          {[0, 25, 50, 75, 100].map((tick) => (
            <g key={tick}>
              <line
                className={tick === 0 ? "pr-axis" : "pr-grid"}
                x1={PAD.left}
                x2={W - PAD.right}
                y1={geometry.y(tick)}
                y2={geometry.y(tick)}
              />
              <text className="pr-tick" x={PAD.left - 6} y={geometry.y(tick) + 3.5} textAnchor="end">
                {tick}%
              </text>
            </g>
          ))}

          <text className="pr-tick" x={geometry.xs[0]} y={H - 8} textAnchor="start">
            {shortDate(points[0].asOf)}
          </text>
          {points.length > 1 && (
            <text className="pr-tick" x={lastX} y={H - 8} textAnchor="end">
              {shortDate(last.asOf)}
            </text>
          )}

          <path className="pr-line pr-line-planned" d={geometry.plannedPath} />
          <path className="pr-line pr-line-actual" d={geometry.actualPath} />

          {hovered && (
            <line
              className="pr-crosshair"
              x1={hoverX}
              x2={hoverX}
              y1={PAD.top}
              y2={PAD.top + geometry.innerH}
            />
          )}

          {/* End dots with a surface ring, then direct labels in text ink. */}
          <circle className="pr-dot pr-dot-planned" cx={lastX} cy={yPlanned} r={4} />
          <circle className="pr-dot pr-dot-actual" cx={lastX} cy={yActual} r={4} />
          <text className="pr-endlabel" x={lastX + 10} y={labelActual + 4}>
            Thực tế {last.actualPct}%
          </text>
          <text className="pr-endlabel pr-endlabel-muted" x={lastX + 10} y={labelPlanned + 4}>
            Kế hoạch {last.plannedPct}%
          </text>

          {hovered && hover !== points.length - 1 && (
            <>
              <circle className="pr-dot pr-dot-planned" cx={hoverX} cy={geometry.y(hovered.plannedPct)} r={4} />
              <circle className="pr-dot pr-dot-actual" cx={hoverX} cy={geometry.y(hovered.actualPct)} r={4} />
            </>
          )}
        </svg>

        {hovered && (
          <div
            className="pr-tooltip"
            style={{ left: `${(hoverX / W) * 100}%` }}
            role="status"
          >
            <div className="pr-tooltip-date">{shortDate(hovered.asOf)}/{hovered.asOf.slice(0, 4)}</div>
            <div className="pr-tooltip-row">
              <i className="pr-key pr-key-actual" />
              <b>{hovered.actualPct}%</b> <span>Thực tế</span>
            </div>
            <div className="pr-tooltip-row">
              <i className="pr-key pr-key-planned" />
              <b>{hovered.plannedPct}%</b> <span>Kế hoạch</span>
            </div>
            <div className="pr-tooltip-hint">Bấm để xem báo cáo này</div>
          </div>
        )}
      </div>
    </div>
  );
}
