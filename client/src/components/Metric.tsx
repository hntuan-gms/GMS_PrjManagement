import type { ReactNode } from "react";

/**
 * One figure and what it counts: the number large, the label quiet, no border and no icon. The same piece in
 * Nhịp dự án and Giờ đã ghi (rà soát 2026-11-07, G6); a row of them is a `MetricRow`. With `onClick` it is a button.
 */
export function MetricRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`metric-row ${className}`.trim()}>{children}</div>;
}

export default function Metric({
  value,
  label,
  sub,
  tone,
  onClick,
  title,
  className = "",
}: {
  value: ReactNode;
  label: string;
  /** A second quiet line under the label ("62% / 192h"). */
  sub?: string;
  /** `crit` and `warn` colour the number only; a figure that is fine stays ink. */
  tone?: "crit" | "serious" | "warn";
  onClick?: () => void;
  title?: string;
  className?: string;
}) {
  const cls = `metric${tone ? ` metric-${tone}` : ""}${onClick ? " is-button" : ""} ${className}`.trim();
  const body = (
    <>
      <b className="metric-value">{value}</b>
      <span className="metric-label">{label}</span>
      {sub && <span className="metric-sub">{sub}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} title={title}>
      {body}
    </button>
  ) : (
    <div className={cls} title={title}>
      {body}
    </div>
  );
}
