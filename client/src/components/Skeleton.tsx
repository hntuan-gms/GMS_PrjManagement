/**
 * Where something is on its way, drawn at the size it will have. It appears only if the wait outlasts
 * 200ms (a CSS delay), so an answer that comes quickly shows nothing at all instead of a flash, and the
 * real content replaces it without moving what is below. Never a sentence like "Đang tải…" in place of a
 * whole area (MASTER.md, "Chờ dữ liệu").
 */
export default function Skeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`skel${className ? ` ${className}` : ""}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skel-line" style={{ width: i === lines - 1 && lines > 1 ? "62%" : "100%" }} />
      ))}
    </div>
  );
}

/**
 * The plan's first paint with nothing saved: a table's worth of rows at the size real ones have, under the
 * header that is already on screen. The rows' widths vary a little so it reads as a list, not a grid of bars.
 */
export function PlanSkeleton({ rows = 12 }: { rows?: number }) {
  return (
    <div className="skel-plan" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skel-plan-row">
          <span className="skel-line" style={{ width: 56 }} />
          <span className="skel-line" style={{ width: `${34 + ((i * 17) % 38)}%` }} />
          <span className="skel-line" style={{ width: 84, marginLeft: "auto" }} />
        </div>
      ))}
    </div>
  );
}
