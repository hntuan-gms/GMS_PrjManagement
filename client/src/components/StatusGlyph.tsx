import type { Task } from "../types";

const LABEL: Record<Task["statusCategory"], string> = {
  new: "Chưa làm",
  indeterminate: "Đang làm",
  done: "Xong",
};

/**
 * Status as a shape, not a filled pill (plan §4.5): ○ not started, a pie that fills with % while
 * in progress, ● with a tick when done. Readable without colour; the colour only confirms it.
 * The workflow's own status name ("In-Progress", "Pending"…) is shown beside it by the caller —
 * names differ per site and cannot be translated safely (BUG-05), the category can.
 */
export default function StatusGlyph({
  category,
  percent = 0,
  size = 14,
  title,
}: {
  category: Task["statusCategory"];
  percent?: number;
  size?: number;
  title?: string;
}) {
  const r = 5.25;
  const c = 7;
  let inner = null;
  if (category === "indeterminate") {
    // At least a quarter so "started" is visible at 0%, at most three quarters so it never reads as done.
    const p = Math.min(0.75, Math.max(0.25, percent / 100));
    const a = p * 2 * Math.PI - Math.PI / 2;
    const x = c + 3.2 * Math.cos(a);
    const y = c + 3.2 * Math.sin(a);
    inner = <path d={`M${c} ${c} L${c} ${c - 3.2} A3.2 3.2 0 ${p > 0.5 ? 1 : 0} 1 ${x} ${y} Z`} className="sg-fill" />;
  } else if (category === "done") {
    inner = (
      <>
        <circle cx={c} cy={c} r={r} className="sg-solid" />
        <path d="M4.6 7.2l1.6 1.6 3.2-3.3" className="sg-tick" />
      </>
    );
  }
  return (
    <svg className={`status-glyph sg-${category}`} width={size} height={size} viewBox="0 0 14 14" role="img" aria-label={title ?? LABEL[category]}>
      <title>{title ?? LABEL[category]}</title>
      <circle cx={c} cy={c} r={r} className="sg-ring" />
      {inner}
    </svg>
  );
}

export { LABEL as STATUS_CATEGORY_LABEL };
