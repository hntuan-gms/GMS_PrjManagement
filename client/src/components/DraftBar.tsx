import { useMemo, useState } from "react";
import { formatDayMonth, formatDayRange } from "../humanDate";
import { draftChanges, planEnd, type PlanDraft } from "../planDraft";
import { todayIso } from "../resourceAllocation";
import type { Task } from "../types";

/**
 * The strip that says "you are drafting" (plan §6.1.6): nothing has gone to Jira, how much has moved,
 * what it does to the project's end, and the two ways out. It sits in the flow under the header —
 * entering a draft is a mode change, not a selection, so moving the page once is expected.
 */
export default function DraftBar({
  draft,
  tasks,
  applying,
  onApply,
  onDiscard,
  onOpenTask,
}: {
  draft: PlanDraft;
  tasks: Task[];
  applying: string | null;
  onApply: () => void;
  onDiscard: () => void;
  onOpenTask: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const changes = useMemo(() => draftChanges(draft, tasks), [draft, tasks]);
  const today = todayIso();
  const endBefore = planEnd(draft.base);
  const endAfter = planEnd(tasks);
  const range = (r: { start: string | null; end: string | null }) =>
    r.start && r.end ? formatDayRange(r.start, r.end, today) : r.start ? formatDayMonth(r.start, today) : "—";

  return (
    <div className="draft-bar" role="region" aria-label="Bản nháp kế hoạch">
      <span className="draft-tag">Nháp</span>
      <span className="draft-text">
        Chưa ghi gì lên Jira · <b>{changes.length}</b> việc thay đổi
        {endBefore && endAfter && endBefore !== endAfter && (
          <>
            {" "}
            · kết thúc dự án {formatDayMonth(endBefore, today)} → <b className={endAfter > endBefore ? "is-later" : "is-earlier"}>{formatDayMonth(endAfter, today)}</b>
          </>
        )}
      </span>
      {changes.length > 0 && (
        <button type="button" className="draft-link" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Ẩn thay đổi" : "Xem thay đổi"}
        </button>
      )}
      <span className="draft-spacer" />
      <button type="button" onClick={onDiscard} disabled={!!applying}>
        Bỏ nháp
      </button>
      <button type="button" className="primary" onClick={onApply} disabled={!!applying || draft.edits.length === 0}>
        {applying ? `Đang ghi ${applying}…` : `Áp dụng${draft.edits.length > 0 ? ` (${new Set(draft.edits.map((e) => e.id)).size})` : ""}`}
      </button>
      {open && changes.length > 0 && (
        <div className="draft-list" role="list">
          {changes.map((c) => (
            <button key={c.id} type="button" role="listitem" className="draft-item" onClick={() => onOpenTask(c.id)}>
              <span className="draft-key">{c.id}</span>
              <span className="draft-sum">{c.summary}</span>
              <span className="draft-dates">
                {range(c.from)} → <b>{range(c.to)}</b>
              </span>
              <span className={`draft-kind is-${c.kind}`}>{c.kind === "edited" ? "bạn dời" : "bị đẩy theo"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
