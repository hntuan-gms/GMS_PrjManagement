import { useState, type DragEvent, type MouseEvent } from "react";
import { initials, localDate, shortDate, totalWeight, typeClass, velocityAverage, weightOf } from "../boardModel";
import type { BoardIssue, BoardSnapshot, EstimateSuggestion, Sprint } from "../types";

/**
 * Backlog + sprint planning, the Scrum half of the Bảng tab.
 *
 * What it adds over Jira's backlog, all in place rather than behind dialogs:
 * - Each sprint shows how full it is against the team's real velocity, so
 *   over-commitment is visible while dragging, not at the retro.
 * - Multi-select (Ctrl/Shift, like the Gantt) and drag a whole block.
 * - Estimates edit inline — click the chip, type, Enter.
 * - AI estimates appear as ghost chips next to the real one, each accepted or
 *   dismissed with one click; AI sprint planning opens from the sprint header.
 * - Cards blocked by an unfinished dependency are marked, so a sprint isn't
 *   planned around work that can't start.
 */

export type SectionId = number | "backlog";

interface Props {
  snapshot: BoardSnapshot;
  /** Filtered, plannable issues (no sub-tasks), in rank order. */
  issues: BoardIssue[];
  unit: string;
  canUseAi: boolean;
  busy: boolean;
  onOpen: (key: string) => void;
  onMove: (keys: string[], to: SectionId, beforeKey: string | null) => void;
  onCreateSprint: () => void;
  onStartSprint: (sprint: Sprint) => void;
  onCompleteSprint: (sprint: Sprint) => void;
  onEditSprint: (sprint: Sprint) => void;
  onPlanSprint: (sprint: Sprint) => void;
  onSetEstimate: (key: string, value: number | null) => void;
  onQuickCreate: (summary: string, to: SectionId) => Promise<void>;
  suggestions: Map<string, EstimateSuggestion>;
  estimating: boolean;
  onRequestEstimates: () => void;
  onAcceptSuggestion: (key: string) => void;
  onDismissSuggestion: (key: string) => void;
  onAcceptAllSuggestions: () => void;
}

interface Hint {
  section: SectionId;
  beforeKey: string | null;
}

export default function BacklogView(props: Props) {
  const { snapshot, issues, unit, canUseAi, busy } = props;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [dragKeys, setDragKeys] = useState<string[] | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  const [collapsed, setCollapsed] = useState<Set<SectionId>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [creatingIn, setCreatingIn] = useState<SectionId | null>(null);
  const [draft, setDraft] = useState("");

  const budget = velocityAverage(snapshot);
  const sprints = snapshot.sprints;
  const firstFuture = sprints.find((s) => s.state === "future");
  const hasActive = sprints.some((s) => s.state === "active");

  const sections: Array<{ id: SectionId; sprint: Sprint | null; items: BoardIssue[] }> = [
    ...sprints.map((s) => ({ id: s.id as SectionId, sprint: s, items: issues.filter((i) => i.sprintId === s.id) })),
    { id: "backlog" as SectionId, sprint: null, items: issues.filter((i) => i.sprintId === null && i.statusCategory !== "done") },
  ];
  const visibleOrder = sections.flatMap((s) => (collapsed.has(s.id) ? [] : s.items.map((i) => i.key)));
  const unestimatedBacklog = snapshot.estimation
    ? issues.filter((i) => i.estimate === null && i.statusCategory !== "done" && i.issueType.toLowerCase() !== "epic").length
    : 0;

  function select(e: MouseEvent, key: string) {
    if (e.shiftKey && anchor) {
      const a = visibleOrder.indexOf(anchor);
      const b = visibleOrder.indexOf(key);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected(new Set(visibleOrder.slice(lo, hi + 1)));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      setAnchor(key);
      return;
    }
    setSelected(new Set([key]));
    setAnchor(key);
  }

  function startDrag(e: DragEvent, key: string) {
    // Dragging an unselected row drags just that row, as in a file manager.
    const keys = selected.has(key) ? visibleOrder.filter((k) => selected.has(k)) : [key];
    if (!selected.has(key)) setSelected(new Set([key]));
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", keys.join(","));
    setDragKeys(keys);
  }

  function endDrag() {
    setDragKeys(null);
    setHint(null);
  }

  function overRow(e: DragEvent, section: SectionId, list: BoardIssue[], issue: BoardIssue) {
    if (!dragKeys) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const idx = list.indexOf(issue);
    const beforeKey = after ? list[idx + 1]?.key ?? null : issue.key;
    if (!hint || hint.section !== section || hint.beforeKey !== beforeKey) setHint({ section, beforeKey });
  }

  function overSection(e: DragEvent, section: SectionId) {
    if (!dragKeys) return;
    e.preventDefault();
    if (!hint || hint.section !== section) setHint({ section, beforeKey: null });
  }

  function drop(e: DragEvent, section: SectionId) {
    e.preventDefault();
    if (!dragKeys || !hint) return endDrag();
    const keys = dragKeys;
    const beforeKey = hint.beforeKey && keys.includes(hint.beforeKey) ? null : hint.beforeKey;
    endDrag();
    props.onMove(keys, section, beforeKey);
  }

  function toggleSection(id: SectionId) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submitDraft(to: SectionId) {
    const summary = draft.trim();
    if (!summary) return;
    setDraft("");
    await props.onQuickCreate(summary, to);
  }

  return (
    <div className="bl">
      {selected.size > 1 && (
        <div className="bl-selection">
          Đã chọn <b>{selected.size}</b> việc
          {snapshot.estimation && (
            <span className="bd-muted">
              · {totalWeight(issues.filter((i) => selected.has(i.key)), snapshot)} {unit}
            </span>
          )}
          <span className="bd-muted">— kéo để chuyển cả nhóm</span>
          <button className="link-btn" onClick={() => setSelected(new Set())}>
            Bỏ chọn
          </button>
        </div>
      )}

      {sections.map((section) => {
        const { sprint, items } = section;
        const isCollapsed = collapsed.has(section.id);
        const weight = totalWeight(items, snapshot);
        const done = items.filter((i) => i.statusCategory === "done");
        const isHint = hint?.section === section.id;
        const fill = budget ? Math.min(140, (weight / budget) * 100) : null;
        const over = budget !== null && weight > budget * 1.1;
        return (
          <section
            key={String(section.id)}
            className={`bl-section ${sprint ? `bl-sprint bl-${sprint.state}` : "bl-backlog"} ${isHint ? "is-hover" : ""}`}
            onDragOver={(e) => overSection(e, section.id)}
            onDrop={(e) => drop(e, section.id)}
          >
            <header className="bl-head">
              <button className="bl-toggle" onClick={() => toggleSection(section.id)} aria-expanded={!isCollapsed}>
                <span className={`bd-chevron ${isCollapsed ? "" : "is-open"}`} aria-hidden="true" />
                <b>{sprint ? sprint.name : "Backlog"}</b>
              </button>
              {sprint?.state === "active" && <span className="bl-badge bl-badge-active">Đang chạy</span>}
              {sprint && (sprint.startDate || sprint.endDate) && (
                <span className="bd-muted">
                  {shortDate(localDate(sprint.startDate))} → {shortDate(localDate(sprint.endDate))}
                </span>
              )}
              <span className="bd-muted">
                {items.length} việc
                {snapshot.estimation && ` · ${weight} ${unit}`}
                {sprint?.state === "active" && done.length > 0 && ` · xong ${done.length}`}
              </span>

              {sprint && sprint.state !== "closed" && fill !== null && (
                <span
                  className={`bl-meter ${over ? "is-over" : ""}`}
                  title={`${weight} / vận tốc trung bình ${budget} ${unit}`}
                  aria-label={`Đã lên kế hoạch ${weight} trên vận tốc ${budget} ${unit}`}
                >
                  <span className="bl-meter-fill" style={{ width: `${Math.min(100, (fill / 140) * 100)}%` }} />
                  <span className="bl-meter-mark" style={{ left: `${(100 / 140) * 100}%` }} />
                  <span className="bl-meter-text">
                    {Math.round((weight / budget!) * 100)}% vận tốc
                  </span>
                </span>
              )}

              <span className="bd-spacer" />
              {sprint?.state === "future" && canUseAi && (
                <button className="bd-ai-btn" onClick={() => props.onPlanSprint(sprint)} disabled={busy}>
                  ✦ Lập kế hoạch AI
                </button>
              )}
              {sprint?.state === "future" && sprint === firstFuture && !hasActive && (
                <button className="primary bl-action" onClick={() => props.onStartSprint(sprint)} disabled={busy || items.length === 0}>
                  Bắt đầu sprint
                </button>
              )}
              {sprint?.state === "active" && (
                <button className="bl-action" onClick={() => props.onCompleteSprint(sprint)} disabled={busy}>
                  Hoàn thành sprint
                </button>
              )}
              {sprint && (
                <button className="bl-icon" onClick={() => props.onEditSprint(sprint)} title="Sửa sprint" aria-label="Sửa sprint">
                  ✎
                </button>
              )}
              {!sprint && (
                <>
                  {canUseAi && unestimatedBacklog > 0 && (
                    <button className="bd-ai-btn" onClick={props.onRequestEstimates} disabled={props.estimating}>
                      {props.estimating ? "Đang ước lượng..." : `✦ Ước lượng ${Math.min(30, unestimatedBacklog)} việc`}
                    </button>
                  )}
                  {props.suggestions.size > 1 && (
                    <button className="bl-action" onClick={props.onAcceptAllSuggestions}>
                      Áp dụng {props.suggestions.size} gợi ý
                    </button>
                  )}
                  <button className="bl-action" onClick={props.onCreateSprint} disabled={busy}>
                    + Tạo sprint
                  </button>
                </>
              )}
            </header>

            {sprint?.goal && !isCollapsed && <div className="bl-goal">🎯 {sprint.goal}</div>}

            {!isCollapsed && (
              <div className="bl-rows">
                {items.length === 0 && (
                  <div className={`bl-empty ${dragKeys ? "is-target" : ""}`}>
                    {sprint ? "Kéo việc từ backlog vào đây để lên kế hoạch sprint." : "Backlog trống."}
                  </div>
                )}
                {items.map((issue) => {
                  const suggestion = props.suggestions.get(issue.key);
                  return (
                    <div key={issue.key}>
                      {isHint && hint!.beforeKey === issue.key && <div className="bd-dropline" />}
                      <div
                        className={`bl-row ${selected.has(issue.key) ? "is-selected" : ""} ${dragKeys?.includes(issue.key) ? "is-dragging" : ""} ${issue.statusCategory === "done" ? "is-done" : ""}`}
                        draggable
                        onDragStart={(e) => startDrag(e, issue.key)}
                        onDragEnd={endDrag}
                        onDragOver={(e) => overRow(e, section.id, items, issue)}
                        onClick={(e) => select(e, issue.key)}
                        onDoubleClick={() => props.onOpen(issue.key)}
                      >
                        <span className={`bd-type bd-type-${typeClass(issue.issueType)}`} title={issue.issueType} />
                        <button
                          className={`bl-key ${issue.statusCategory === "done" ? "is-done" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            props.onOpen(issue.key);
                          }}
                        >
                          {issue.key}
                        </button>
                        <span className="bl-summary" title={issue.summary}>
                          {issue.summary}
                        </span>
                        {issue.blockedBy.length > 0 && (
                          <span className="bd-alert bd-alert-blocked" title={`Chờ ${issue.blockedBy.join(", ")} xong`}>
                            ⛔ {issue.blockedBy.length}
                          </span>
                        )}
                        {issue.flagged && <span className="bd-alert bd-alert-flag">⚑</span>}
                        {issue.epicSummary && (
                          <span className="bd-epic bl-epic" title={issue.epicKey ?? ""}>
                            {issue.epicSummary}
                          </span>
                        )}
                        <span className={`bl-status bl-status-${issue.statusCategory}`}>{issue.statusName}</span>
                        <span className={`bd-avatar ${issue.assigneeName ? "" : "is-none"}`} title={issue.assigneeName ?? "Chưa gán"}>
                          {initials(issue.assigneeName)}
                        </span>
                        {suggestion && issue.estimate === null && (
                          <span className={`bl-suggest bl-conf-${suggestion.confidence}`} title={suggestion.reason} onClick={(e) => e.stopPropagation()}>
                            ✦ {suggestion.value}
                            <button onClick={() => props.onAcceptSuggestion(issue.key)} title="Áp dụng" aria-label="Áp dụng">
                              ✓
                            </button>
                            <button onClick={() => props.onDismissSuggestion(issue.key)} title="Bỏ qua" aria-label="Bỏ qua">
                              ✕
                            </button>
                          </span>
                        )}
                        {snapshot.estimation &&
                          (editing === issue.key ? (
                            <input
                              className="bl-est-input"
                              autoFocus
                              type="number"
                              min={0}
                              step={snapshot.estimation.unit === "hours" ? 0.5 : 1}
                              defaultValue={issue.estimate ?? ""}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  const raw = (e.target as HTMLInputElement).value;
                                  props.onSetEstimate(issue.key, raw === "" ? null : Number(raw));
                                  setEditing(null);
                                }
                                if (e.key === "Escape") {
                                  e.stopPropagation();
                                  setEditing(null);
                                }
                              }}
                              onBlur={(e) => {
                                const raw = e.target.value;
                                const next = raw === "" ? null : Number(raw);
                                if (next !== issue.estimate) props.onSetEstimate(issue.key, next);
                                setEditing(null);
                              }}
                            />
                          ) : (
                            <button
                              className={`bd-est bl-est ${issue.estimate === null ? "is-empty" : ""}`}
                              title={`${snapshot.estimation.name} — bấm để sửa`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditing(issue.key);
                              }}
                            >
                              {issue.estimate ?? "–"}
                            </button>
                          ))}
                        {!snapshot.estimation && <span className="bd-muted bl-weight">{weightOf(issue, snapshot)}</span>}
                      </div>
                    </div>
                  );
                })}
                {isHint && hint!.beforeKey === null && items.length > 0 && <div className="bd-dropline" />}

                {creatingIn === section.id ? (
                  <div className="bl-quick">
                    <input
                      autoFocus
                      value={draft}
                      placeholder="Tên công việc — Enter để tạo, Esc để đóng"
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitDraft(section.id);
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setCreatingIn(null);
                          setDraft("");
                        }
                      }}
                      onBlur={() => !draft.trim() && setCreatingIn(null)}
                    />
                  </div>
                ) : (
                  sprint?.state !== "closed" && (
                    <button className="bd-add bl-add" onClick={() => setCreatingIn(section.id)}>
                      + Tạo việc
                    </button>
                  )
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
