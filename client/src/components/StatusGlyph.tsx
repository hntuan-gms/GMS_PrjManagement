import { statusKind, STATUS_KIND_LABEL, type StatusKind } from "../statusKind";
import type { Task } from "../types";

const LABEL: Record<Task["statusCategory"], string> = {
  new: "Chưa làm",
  indeterminate: "Đang làm",
  done: "Xong",
};

/**
 * Status as a shape, not a filled pill (plan §4.5), readable without colour; the colour only confirms it.
 * Each state a workflow can be in has its own shape (`statusKind`): ○ to do, ◌ backlog, ▷ ready,
 * a pie that fills with % while in progress, ◉ in review/testing, ⏸ on hold, ⊖ blocked, ↺ reopened,
 * ✓ done, ⊘ cancelled. The workflow's own status name ("In-Progress", "Pending"…) is shown beside it
 * by the caller — names differ per site and cannot be translated safely (BUG-05), the kind is a best
 * reading of the name and falls back to the category.
 */

const R = 5.25;
const C = 7;

function inner(kind: StatusKind, percent: number) {
  switch (kind) {
    case "doing": {
      // At least a quarter so "started" is visible at 0%, at most three quarters so it never reads as done.
      const p = Math.min(0.75, Math.max(0.25, percent / 100));
      const a = p * 2 * Math.PI - Math.PI / 2;
      const x = C + 3.2 * Math.cos(a);
      const y = C + 3.2 * Math.sin(a);
      return <path d={`M${C} ${C} L${C} ${C - 3.2} A3.2 3.2 0 ${p > 0.5 ? 1 : 0} 1 ${x} ${y} Z`} className="sg-fill" />;
    }
    case "done":
      return (
        <>
          <circle cx={C} cy={C} r={R} className="sg-solid" />
          <path d="M4.6 7.2l1.6 1.6 3.2-3.3" className="sg-mark" />
        </>
      );
    case "blocked":
      return (
        <>
          <circle cx={C} cy={C} r={R} className="sg-solid" />
          <path d="M4.5 7h5" className="sg-mark" />
        </>
      );
    case "dropped":
      return <path d="M3.4 10.6l7.2-7.2" className="sg-slash" />;
    case "review":
      return <circle cx={C} cy={C} r={2.1} className="sg-fill" />;
    case "ready":
      return <path d="M5.9 4.7L9.5 7 5.9 9.3z" className="sg-fill" />;
    case "hold":
      return <path d="M5.5 4.9v4.2M8.5 4.9v4.2" className="sg-bars" />;
    case "reopened":
      return (
        <>
          <path d="M8.98 5.02A2.8 2.8 0 1 0 7 9.8" className="sg-arc" />
          <path d="M9.76 5.8L9.41 3.89 7.85 5.45z" className="sg-fill" />
        </>
      );
    default:
      return null;
  }
}

export default function StatusGlyph({
  category,
  percent = 0,
  size = 14,
  title,
  name,
}: {
  category: Task["statusCategory"];
  percent?: number;
  size?: number;
  title?: string;
  /** The workflow status name: lets a blocked, in-review or cancelled item look like what it is. */
  name?: string;
}) {
  const kind = statusKind(category, name);
  const label = title ?? name ?? (kind === "doing" || kind === "todo" || kind === "done" ? LABEL[category] : STATUS_KIND_LABEL[kind]);
  return (
    <svg className={`status-glyph sg-${kind}`} width={size} height={size} viewBox="0 0 14 14" role="img" aria-label={label}>
      <title>{label}</title>
      <circle cx={C} cy={C} r={R} className="sg-ring" />
      {inner(kind, percent)}
    </svg>
  );
}

export { LABEL as STATUS_CATEGORY_LABEL };
