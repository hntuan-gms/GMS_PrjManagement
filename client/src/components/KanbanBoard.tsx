import { useRef, useState, type DragEvent } from "react";
import { api } from "../api";
import { idleDays, initials, isOverdue, lanesOf, shortDate, totalWeight, typeClass, type Swimlane } from "../boardModel";
import type { BoardColumn, BoardIssue, BoardSnapshot } from "../types";

interface Props {
  snapshot: BoardSnapshot;
  /** Already scoped (active sprint, or everything on a Kanban board) and filtered. */
  issues: BoardIssue[];
  swimlane: Swimlane;
  today: string;
  onMove: (key: string, column: BoardColumn, beforeKey: string | null, laneAccountId: string | null | undefined) => void;
  onOpen: (key: string) => void;
  onQuickCreate?: (summary: string) => Promise<void>;
}

/**
 * The board. Columns are the board's own (from its Jira configuration), and a
 * drop is a real workflow transition — so the board asks Jira which transitions
 * the card actually has the moment a drag starts, and lights up only the columns
 * it can legally reach. Jira's board does the same; doing it before the drop,
 * rather than failing after it, is the difference between guiding a user and
 * scolding them.
 *
 * Swimlanes by assignee double as assignment: dropping a card into another
 * person's lane gives it to them, which Jira's board doesn't allow at all.
 */

interface DragState {
  key: string;
  fromStatusId: string;
  /** Status ids this card can reach; null while the transitions are loading. */
  allowed: Set<string> | null;
}

interface Hint {
  column: number;
  lane: string;
  beforeKey: string | null;
}

export default function KanbanBoard({ snapshot, issues, swimlane, today, onMove, onOpen, onQuickCreate }: Props) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(new Set());
  const transitionCache = useRef(new Map<string, Set<string>>());

  const columns = snapshot.columns;
  const columnOf = (issue: BoardIssue) => columns.findIndex((c) => c.statusIds.includes(issue.statusId));
  const lanes = lanesOf(issues, swimlane);

  function startDrag(e: DragEvent, issue: BoardIssue) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", issue.key);
    const cacheKey = `${issue.key}:${issue.statusId}`;
    const cached = transitionCache.current.get(cacheKey) ?? null;
    setDrag({ key: issue.key, fromStatusId: issue.statusId, allowed: cached });
    if (!cached) {
      api
        .getTransitions(issue.key)
        .then((ts) => {
          const allowed = new Set([issue.statusId, ...ts.map((t) => t.toStatusId)]);
          transitionCache.current.set(cacheKey, allowed);
          setDrag((d) => (d && d.key === issue.key ? { ...d, allowed } : d));
        })
        // Unknown transitions: let every column accept, and let the server say no.
        .catch(() => setDrag((d) => (d && d.key === issue.key ? { ...d, allowed: new Set(columns.flatMap((c) => c.statusIds)) } : d)));
    }
  }

  function endDrag() {
    setDrag(null);
    setHint(null);
  }

  const canDrop = (column: BoardColumn) => !drag || !drag.allowed || column.statusIds.some((s) => drag.allowed!.has(s));

  function overCard(e: DragEvent, column: number, lane: string, issue: BoardIssue, list: BoardIssue[]) {
    if (!drag || !canDrop(columns[column])) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const idx = list.indexOf(issue);
    const beforeKey = after ? list[idx + 1]?.key ?? null : issue.key;
    if (!hint || hint.column !== column || hint.lane !== lane || hint.beforeKey !== beforeKey) setHint({ column, lane, beforeKey });
  }

  function overColumn(e: DragEvent, column: number, lane: string) {
    if (!drag || !canDrop(columns[column])) return;
    e.preventDefault();
    if (!hint || hint.column !== column || hint.lane !== lane) setHint({ column, lane, beforeKey: null });
  }

  function drop(e: DragEvent, column: number, laneAccountId: string | null | undefined) {
    e.preventDefault();
    if (!drag || !hint) return endDrag();
    const key = drag.key;
    const beforeKey = hint.beforeKey === key ? null : hint.beforeKey;
    endDrag();
    onMove(key, columns[column], beforeKey, laneAccountId);
  }

  async function submitDraft() {
    const summary = draft.trim();
    if (!summary || !onQuickCreate) return;
    setDraft("");
    await onQuickCreate(summary);
  }

  if (columns.length === 0) {
    return <div className="bd-empty">Board chưa có cột nào được cấu hình trạng thái.</div>;
  }

  return (
    <div className="bd-board" style={{ ["--bd-cols" as string]: columns.length }}>
      <div className="bd-colheads">
        {columns.map((c, ci) => {
          const inCol = issues.filter((i) => columnOf(i) === ci);
          const over = c.max !== null && inCol.length > c.max;
          const under = c.min !== null && inCol.length < c.min;
          return (
            <div
              key={c.name}
              className={`bd-colhead ${over ? "is-over" : ""} ${under ? "is-under" : ""} ${c.unmapped ? "is-unmapped" : ""}`}
              title={
                c.unmapped
                  ? "Trạng thái này chưa được gắn vào cột nào trong cấu hình board trên Jira (Board settings → Columns), nên board của Jira không hiển thị nó. Hiện ở đây để các việc không bị mất."
                  : undefined
              }
            >
              <span className="bd-colname">
                {c.name}
                {c.unmapped && <span className="bd-unmapped-tag">chưa gắn cột</span>}
              </span>
              <span className="bd-colcount" title={c.max !== null ? `Giới hạn WIP: tối đa ${c.max}` : undefined}>
                {inCol.length}
                {c.max !== null && <span className="bd-wip">/{c.max}</span>}
              </span>
              {snapshot.estimation && inCol.length > 0 && (
                <span className="bd-colweight" title="Tổng ước lượng">
                  {totalWeight(inCol, snapshot)}
                </span>
              )}
              {over && <span className="bd-wip-flag">Vượt WIP</span>}
            </div>
          );
        })}
      </div>

      {lanes.map((lane) => {
        const collapsed = collapsedLanes.has(lane.id);
        return (
          <div key={lane.id} className="bd-lane">
            {swimlane !== "none" && (
              <button
                className="bd-lanehead"
                onClick={() =>
                  setCollapsedLanes((prev) => {
                    const next = new Set(prev);
                    if (next.has(lane.id)) next.delete(lane.id);
                    else next.add(lane.id);
                    return next;
                  })
                }
              >
                <span className={`bd-chevron ${collapsed ? "" : "is-open"}`} aria-hidden="true" />
                {swimlane === "assignee" && <span className="bd-avatar">{lane.id === "none" ? "?" : initials(lane.label)}</span>}
                <b>{lane.label}</b>
                <span className="bd-muted">{lane.issues.length} việc</span>
              </button>
            )}
            {!collapsed && (
              <div className="bd-cols">
                {columns.map((c, ci) => {
                  const list = lane.issues.filter((i) => columnOf(i) === ci);
                  const allowed = canDrop(c);
                  const isHint = hint && hint.column === ci && hint.lane === lane.id;
                  return (
                    <div
                      key={c.name}
                      className={`bd-col ${drag ? (allowed ? "is-droppable" : "is-blocked") : ""} ${isHint ? "is-hover" : ""}`}
                      onDragOver={(e) => overColumn(e, ci, lane.id)}
                      onDrop={(e) => drop(e, ci, lane.accountId)}
                    >
                      {list.map((issue) => (
                        <div key={issue.key}>
                          {isHint && hint!.beforeKey === issue.key && <div className="bd-dropline" />}
                          <Card
                            issue={issue}
                            snapshot={snapshot}
                            today={today}
                            dragging={drag?.key === issue.key}
                            onOpen={() => onOpen(issue.key)}
                            onDragStart={(e) => startDrag(e, issue)}
                            onDragEnd={endDrag}
                            onDragOver={(e) => overCard(e, ci, lane.id, issue, list)}
                          />
                        </div>
                      ))}
                      {isHint && hint!.beforeKey === null && <div className="bd-dropline" />}
                      {drag && !allowed && drag.allowed && (
                        <div className="bd-col-note">Quy trình không cho chuyển tới đây</div>
                      )}
                      {ci === 0 && lane === lanes[0] && onQuickCreate && (
                        creating ? (
                          <div className="bd-quick">
                            <textarea
                              autoFocus
                              value={draft}
                              placeholder="Cần làm gì? Enter để tạo, Esc để huỷ"
                              onChange={(e) => setDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  submitDraft();
                                }
                                if (e.key === "Escape") {
                                  e.stopPropagation();
                                  setCreating(false);
                                  setDraft("");
                                }
                              }}
                              onBlur={() => !draft.trim() && setCreating(false)}
                            />
                          </div>
                        ) : (
                          <button className="bd-add" onClick={() => setCreating(true)}>
                            + Tạo việc
                          </button>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Card({
  issue,
  snapshot,
  today,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragOver,
}: {
  issue: BoardIssue;
  snapshot: BoardSnapshot;
  today: string;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent) => void;
}) {
  const overdue = isOverdue(issue, today);
  const idle = issue.statusCategory === "indeterminate" ? idleDays(issue, today) : 0;
  const blocked = issue.blockedBy.length > 0;
  return (
    <div
      className={`bd-card ${dragging ? "is-dragging" : ""} ${blocked ? "is-blocked" : ""} ${issue.flagged ? "is-flagged" : ""} ${issue.statusCategory === "done" ? "is-done" : ""}`}
      draggable
      tabIndex={0}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      title={issue.summary}
    >
      <div className="bd-card-summary">{issue.summary}</div>
      {(blocked || issue.flagged || idle >= 3) && (
        <div className="bd-card-alerts">
          {blocked && (
            <span className="bd-alert bd-alert-blocked" title="Việc đi trước chưa xong (theo phụ thuộc trên Gantt)">
              ⛔ Chờ {issue.blockedBy.join(", ")}
            </span>
          )}
          {issue.flagged && <span className="bd-alert bd-alert-flag">⚑ Gắn cờ</span>}
          {idle >= 3 && <span className="bd-alert bd-alert-idle">⏸ {idle} ngày chưa cập nhật</span>}
        </div>
      )}
      {issue.epicSummary && (
        <span className="bd-epic" title={issue.epicKey ?? ""}>
          {issue.epicSummary}
        </span>
      )}
      <div className="bd-card-foot">
        <span className={`bd-type bd-type-${typeClass(issue.issueType)}`} title={issue.issueType} />
        <span className={`bd-key ${issue.statusCategory === "done" ? "is-done" : ""}`}>{issue.key}</span>
        {issue.dueDate && (
          <span className={`bd-due ${overdue ? "is-overdue" : ""}`} title={overdue ? "Quá hạn" : "Hạn"}>
            {shortDate(issue.dueDate)}
          </span>
        )}
        <span className="bd-spacer" />
        {snapshot.estimation && (
          <span className={`bd-est ${issue.estimate === null ? "is-empty" : ""}`} title={snapshot.estimation.name}>
            {issue.estimate ?? "–"}
          </span>
        )}
        <span className={`bd-avatar ${issue.assigneeName ? "" : "is-none"}`} title={issue.assigneeName ?? "Chưa gán"}>
          {initials(issue.assigneeName)}
        </span>
      </div>
    </div>
  );
}
