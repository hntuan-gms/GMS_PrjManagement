import { useMemo } from "react";
import { initialsOf } from "../avatar";
import type { Task } from "../types";

const ORDER: Record<Task["statusCategory"], number> = { new: 0, indeterminate: 1, done: 2 };
/** How many cards a column shows while the real board is on its way: enough to look like a board, few enough to be cheap. */
const PER_COLUMN = 6;

/**
 * The Bảng tab's first paint when nothing was saved from an earlier visit. The board itself is a read of
 * Jira (its configuration, sprints, quick filters), but the work on it is already in hand — the plan's
 * tasks — so the columns are drawn from the statuses those tasks sit in, in the order of their category,
 * and the real board replaces them when it lands. Read-only and a little dimmed: it is a preview, not a
 * second board. A page that said "Đang tải board từ Jira..." and nothing else was the blank this replaces.
 */
export default function BoardPreview({ tasks }: { tasks: Task[] }) {
  const columns = useMemo(() => {
    // Epics are containers (the board leaves them off), and a sub-task rides on its parent's card.
    const work = tasks.filter((t) => t.issueType !== "Epic" && t.issueType !== "Sub-task");
    const by = new Map<string, { name: string; category: Task["statusCategory"]; tasks: Task[] }>();
    for (const t of work) {
      const col = by.get(t.statusName) ?? { name: t.statusName, category: t.statusCategory, tasks: [] };
      col.tasks.push(t);
      by.set(t.statusName, col);
    }
    return [...by.values()].sort((a, b) => ORDER[a.category] - ORDER[b.category]);
  }, [tasks]);

  if (columns.length === 0) return null;
  return (
    <div className="bdp" aria-busy="true" aria-label="Bảng đang được đọc từ Jira">
      {columns.map((c) => (
        <section key={c.name} className="bdp-col">
          <h3 className="bdp-head">
            {c.name}
            <span className="bdp-count">{c.tasks.length}</span>
          </h3>
          {c.tasks.slice(0, PER_COLUMN).map((t) => (
            <div key={t.id} className="bdp-card">
              <span className="bdp-title">{t.summary}</span>
              <span className="bdp-meta">
                <span className="bdp-key">{t.id}</span>
                {t.assigneeName && <span className="bdp-who">{initialsOf(t.assigneeName)}</span>}
              </span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
