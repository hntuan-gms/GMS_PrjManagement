import { useRef, useState, type DragEvent } from "react";
import { api } from "../api";
import { canonicalIssueType, idleDays, initials, isOverdue, lanesOf, shortDate, totalWeight, type Swimlane } from "../boardModel";
import { cardAccent, subtaskProgress, type CardOptions } from "../cardOptions";
import AssigneePicker, { type Member } from "./AssigneePicker";
import { Icon } from "./Icons";
import IssueTypeIcon from "./IssueTypeIcon";
import PriorityMark from "./PriorityMark";
import QuickCreateOptions, { type QuickOptions } from "./QuickCreateOptions";
import type { BoardColumn, BoardIssue, BoardSnapshot } from "../types";

interface Props {
  snapshot: BoardSnapshot;
  /** Already scoped (active sprint, or everything on a Kanban board) and filtered. */
  issues: BoardIssue[];
  swimlane: Swimlane;
  today: string;
  onMove: (key: string, column: BoardColumn, beforeKey: string | null, laneAccountId: string | null | undefined) => void;
  onOpen: (key: string) => void;
  /** `column` is where the new card should land, not just the board's first column. */
  onQuickCreate?: (summary: string, opts: QuickOptions, column: BoardColumn) => Promise<void>;
  members: Member[];
  /** Issue types offered by quick create. */
  createTypes: string[];
  onAssign: (key: string, accountId: string | null) => void;
  /** What a card shows and how it is tinted (the toolbar's "Thẻ" panel). */
  options: CardOptions;
  /** Sub-tasks by parent key, from the whole board — a card lists its own even when they are filtered out. */
  subtasks: Map<string, BoardIssue[]>;
  onFlag: (key: string, flagged: boolean) => void;
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

/** Columns the user folded away, per board: a column's name is the only stable handle Jira gives it. */
const collapsedKey = (snapshot: BoardSnapshot) => `gms.board.collapsedColumns.${snapshot.board?.id ?? "status"}`;

function readCollapsed(snapshot: BoardSnapshot): Set<string> {
  try {
    const raw = localStorage.getItem(collapsedKey(snapshot));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

const COLLAPSED_WIDTH = 40;
const COLUMN_MIN_WIDTH = 250;
const COLUMN_GAP = 10;

export default function KanbanBoard({ snapshot, issues, swimlane, today, onMove, onOpen, onQuickCreate, members, createTypes, onAssign, options, subtasks, onFlag }: Props) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  /** Index of the column whose quick-create box is open — one at a time. */
  const [creating, setCreating] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [quickOpts, setQuickOpts] = useState<QuickOptions>({ issueType: createTypes[0] ?? "Task", assigneeAccountId: null });
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(new Set());
  const [folded, setFolded] = useState<Set<string>>(() => readCollapsed(snapshot));
  const transitionCache = useRef(new Map<string, Set<string>>());

  const columns = snapshot.columns;
  const columnOf = (issue: BoardIssue) => columns.findIndex((c) => c.statusIds.includes(issue.statusId));
  const lanes = lanesOf(issues, swimlane);
  const counts = columns.map((_, ci) => issues.filter((i) => columnOf(i) === ci).length);
  // Only an empty column folds: a card that lands in one (a drop, a move made elsewhere)
  // must never be hidden behind a strip, so it simply unfolds while it holds anything.
  const isFolded = (ci: number) => folded.has(columns[ci].name) && counts[ci] === 0;

  function setFold(name: string, on: boolean) {
    setFolded((prev) => {
      if (prev.has(name) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      try {
        localStorage.setItem(collapsedKey(snapshot), JSON.stringify([...next]));
      } catch {
        // Private mode: the fold just isn't remembered.
      }
      return next;
    });
  }

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
    setFold(columns[column].name, false);
    onMove(key, columns[column], beforeKey, laneAccountId);
  }

  async function submitDraft() {
    const summary = draft.trim();
    if (!summary || !onQuickCreate || creating === null) return;
    const column = columns[creating];
    setDraft("");
    await onQuickCreate(summary, quickOpts, column);
  }

  if (columns.length === 0) {
    return <div className="bd-empty">Board chưa có cột nào được cấu hình trạng thái.</div>;
  }

  // A folded column is a 40px strip and the rest share what is left, so the grid is
  // described per column rather than as `repeat(n, …)`.
  const foldedCount = columns.filter((_, ci) => isFolded(ci)).length;
  const openCount = columns.length - foldedCount;
  const template = columns.map((_, ci) => (isFolded(ci) ? `${COLLAPSED_WIDTH}px` : `minmax(${COLUMN_MIN_WIDTH}px, 1fr)`)).join(" ");
  const minWidth = openCount * (COLUMN_MIN_WIDTH + COLUMN_GAP) + foldedCount * (COLLAPSED_WIDTH + COLUMN_GAP);

  return (
    <div
      className="bd-board"
      style={{ ["--bd-template" as string]: template, ["--bd-minw" as string]: `${minWidth}px` }}
    >
      <div className="bd-colheads">
        {columns.map((c, ci) => {
          const inCol = counts[ci];
          const over = c.max !== null && inCol > c.max;
          const under = c.min !== null && inCol < c.min;
          if (isFolded(ci)) {
            return (
              <div key={c.name} className="bd-colhead is-folded">
                <button
                  type="button"
                  className="bd-col-toggle"
                  aria-label={`Mở rộng cột ${c.name}`}
                  title={`Mở rộng cột ${c.name}`}
                  onClick={() => setFold(c.name, false)}
                >
                  <Icon name="chevronRight" size={14} />
                </button>
              </div>
            );
          }
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
                {inCol}
                {c.max !== null && <span className="bd-wip">/{c.max}</span>}
              </span>
              {snapshot.estimation && inCol > 0 && (
                <span className="bd-colweight" title="Tổng ước lượng">
                  {totalWeight(
                    issues.filter((i) => columnOf(i) === ci),
                    snapshot
                  )}
                </span>
              )}
              {over && <span className="bd-wip-flag">Vượt giới hạn</span>}
              {inCol === 0 && (
                <button
                  type="button"
                  className="bd-col-toggle"
                  aria-label={`Thu gọn cột ${c.name}`}
                  title="Thu gọn cột trống"
                  onClick={() => setFold(c.name, true)}
                >
                  <Icon name="collapseColumn" size={14} />
                </button>
              )}
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
                  if (isFolded(ci)) {
                    // Still a drop target — it unfolds as soon as the card lands.
                    return (
                      <div
                        key={c.name}
                        className={`bd-col is-folded ${drag ? (allowed ? "is-droppable" : "is-blocked") : ""} ${isHint ? "is-hover" : ""}`}
                        onDragOver={(e) => overColumn(e, ci, lane.id)}
                        onDrop={(e) => drop(e, ci, lane.accountId)}
                      >
                        <button type="button" className="bd-fold-label" title={`Mở rộng cột ${c.name}`} onClick={() => setFold(c.name, false)}>
                          {c.name}
                        </button>
                      </div>
                    );
                  }
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
                            members={members}
                            options={options}
                            subs={subtasks.get(issue.key) ?? []}
                            onOpenKey={onOpen}
                            onFlag={() => onFlag(issue.key, !issue.flagged)}
                            onAssign={(accountId) => onAssign(issue.key, accountId)}
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
                      {lane === lanes[0] && onQuickCreate && !c.unmapped && (
                        creating === ci ? (
                          <div
                            className="bd-quick"
                            // Focus moving to the pickers below is not leaving the form.
                            onBlur={(e) => {
                              if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !draft.trim()) setCreating(null);
                            }}
                          >
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
                                  setCreating(null);
                                  setDraft("");
                                }
                              }}
                            />
                            <QuickCreateOptions types={createTypes} members={members} value={quickOpts} onChange={setQuickOpts} />
                          </div>
                        ) : (
                          <button className="bd-add" onClick={() => setCreating(ci)}>
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
  members,
  options,
  subs,
  onOpenKey,
  onFlag,
  onAssign,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragOver,
}: {
  members: Member[];
  options: CardOptions;
  subs: BoardIssue[];
  onOpenKey: (key: string) => void;
  onFlag: () => void;
  onAssign: (accountId: string | null) => void;
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
  const show = options.fields;
  const accent = cardAccent(issue, options.colorBy);
  const [subsOpen, setSubsOpen] = useState(false);
  const progress = subtaskProgress(subs);
  return (
    <div
      style={accent ? ({ ["--card-accent" as string]: accent } as React.CSSProperties) : undefined}
      className={`bd-card ${accent ? "has-accent" : ""} ${dragging ? "is-dragging" : ""} ${blocked ? "is-blocked" : ""} ${issue.flagged ? "is-flagged" : ""} ${issue.statusCategory === "done" ? "is-done" : ""}`}
      draggable
      tabIndex={0}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      title={issue.summary}
    >
      <button
        type="button"
        className={`bd-card-flag ${issue.flagged ? "is-on" : ""}`}
        aria-pressed={issue.flagged}
        aria-label={issue.flagged ? `Bỏ cờ ${issue.key}` : `Gắn cờ ${issue.key}`}
        title={issue.flagged ? "Bỏ cờ" : "Gắn cờ — báo việc này đang vướng"}
        onClick={(e) => {
          e.stopPropagation();
          onFlag();
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Icon name="critical" size={12} />
      </button>
      <div className="bd-card-summary">{issue.summary}</div>
      {/* One line for everything that qualifies the card: the Epic gives way (it truncates)
          so the warnings keep their words and the card stays a row shorter. */}
      {(show.epic && issue.epicSummary) || blocked || issue.flagged || idle >= 3 ? (
        <div className="bd-card-meta">
          {show.epic && issue.epicSummary && (
            <span className="bd-epic" title={`${issue.epicKey ?? "Epic"} · ${issue.epicSummary}`}>
              {issue.epicSummary}
            </span>
          )}
          {blocked && (
            <span className="bd-alert bd-alert-blocked" title={`Việc đi trước chưa xong (theo phụ thuộc trên Gantt): ${issue.blockedBy.join(", ")}`}>
              <Icon name="lock" size={11} />
              <span className="bd-alert-text">Chờ {issue.blockedBy.join(", ")}</span>
            </span>
          )}
          {issue.flagged && (
            <span className="bd-alert bd-alert-flag" title="Đã gắn cờ trên Jira">
              <Icon name="critical" size={11} />
              Gắn cờ
            </span>
          )}
          {idle >= 3 && (
            <span className="bd-alert bd-alert-idle" title={`${idle} ngày làm việc chưa có cập nhật nào`}>
              <Icon name="clock" size={11} />
              {idle} ngày
            </span>
          )}
        </div>
      ) : null}
      {((show.labels && issue.labels.length > 0) || (show.versions && issue.fixVersions.length > 0)) && (
        <div className="bd-card-tags">
          {show.labels && issue.labels.map((l) => <span key={`l-${l}`} className="bd-tag">{l}</span>)}
          {show.versions && issue.fixVersions.map((v) => <span key={`v-${v}`} className="bd-tag bd-tag-version" title="Phiên bản">{v}</span>)}
        </div>
      )}
      {show.subtasks && subs.length > 0 && (
        <div className="bd-subtasks">
          <button
            type="button"
            className="bd-subtasks-toggle"
            aria-expanded={subsOpen}
            onClick={(e) => {
              e.stopPropagation();
              setSubsOpen((v) => !v);
            }}
            onKeyDown={(e) => e.stopPropagation()}
            title="Sub-task của việc này"
          >
            <span className={`bd-chevron ${subsOpen ? "is-open" : ""}`} aria-hidden="true" />
            <span>
              {progress.done}/{progress.total} sub-task
            </span>
            <span className="bd-subtasks-bar" aria-hidden="true">
              <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </span>
          </button>
          {subsOpen && (
            <ul className="bd-subtasks-list">
              {subs.map((c) => (
                <li key={c.key} className={c.statusCategory === "done" ? "is-done" : ""}>
                  <button
                    type="button"
                    className="bd-subtask"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenKey(c.key);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                    title={c.summary}
                  >
                    <span className="bd-key">{c.key}</span>
                    <span className="bd-subtask-summary">{c.summary}</span>
                  </button>
                  <span className={`bl-status bl-status-${c.statusCategory}`}>{c.statusName}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="bd-card-foot">
        {show.type && <IssueTypeIcon type={canonicalIssueType(issue.issueType)} label={issue.issueType} size={14} />}
        {show.key && <span className={`bd-key ${issue.statusCategory === "done" ? "is-done" : ""}`}>{issue.key}</span>}
        {show.due && issue.dueDate && (
          <span className={`bd-due ${overdue ? "is-overdue" : ""}`} title={overdue ? "Quá hạn" : "Hạn"}>
            {shortDate(issue.dueDate)}
          </span>
        )}
        <span className="bd-spacer" />
        {show.priority && <PriorityMark priority={issue.priority} />}
        {show.estimate && snapshot.estimation && (
          <span className={`bd-est ${issue.estimate === null ? "is-empty" : ""}`} title={snapshot.estimation.name}>
            {issue.estimate ?? "–"}
          </span>
        )}
        {show.assignee && (
          <AssigneePicker
            issueType={issue.issueType}
            accountId={issue.assigneeAccountId}
            name={issue.assigneeName}
            members={members}
            onAssign={onAssign}
          />
        )}
      </div>
    </div>
  );
}
