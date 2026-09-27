import { useMemo, useState, type ReactNode } from "react";
import { addDaysLocal, localDate, toJiraDateTime, totalWeight } from "../boardModel";
import type { BoardIssue, BoardSnapshot, Sprint, SprintPlanProposal } from "../types";

/**
 * The three sprint dialogs. Each asks only what Jira's own dialog asks, with
 * the defaults a team almost always wants already filled in (same length as
 * last time, starting today, next sprint as the carry-over target).
 */

/* -------------------------------------------------------- start / edit sprint */

const DURATIONS = [
  { weeks: 1, label: "1 tuần" },
  { weeks: 2, label: "2 tuần" },
  { weeks: 3, label: "3 tuần" },
  { weeks: 4, label: "4 tuần" },
];

export function SprintFormModal({
  mode,
  sprint,
  today,
  defaultWeeks,
  onClose,
  onSubmit,
}: {
  mode: "start" | "edit";
  sprint: Sprint;
  today: string;
  defaultWeeks: number;
  onClose: () => void;
  onSubmit: (input: { name: string; goal: string; startDate?: string; endDate?: string }) => Promise<void>;
}) {
  const initialStart = localDate(sprint.startDate) ?? today;
  const initialEnd = localDate(sprint.endDate) ?? addDaysLocal(initialStart, defaultWeeks * 7 - 1);
  const [name, setName] = useState(sprint.name);
  const [goal, setGoal] = useState(sprint.goal ?? "");
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const datesLocked = mode === "edit" && sprint.state === "closed";

  async function submit() {
    if (!name.trim()) return setError("Sprint cần có tên.");
    if (!datesLocked && end <= start) return setError("Ngày kết thúc phải sau ngày bắt đầu.");
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        goal: goal.trim(),
        // Start of the first morning, end of the last afternoon, local time.
        ...(datesLocked ? {} : { startDate: toJiraDateTime(start, 9), endDate: toJiraDateTime(end, 18) }),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được sprint.");
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal bd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-id">{mode === "start" ? "Bắt đầu sprint" : "Sửa sprint"}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <label className="field">
          <span>Tên sprint</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {!datesLocked && (
          <>
            <div className="field">
              <span>Thời lượng</span>
              <div className="bd-seg">
                {DURATIONS.map((d) => {
                  const active = end === addDaysLocal(start, d.weeks * 7 - 1);
                  return (
                    <button key={d.weeks} className={active ? "is-active" : ""} onClick={() => setEnd(addDaysLocal(start, d.weeks * 7 - 1))}>
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Bắt đầu</span>
                <input
                  type="date"
                  value={start}
                  onChange={(e) => {
                    // Moving the start keeps the length, as Jira's dialog does.
                    const len = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
                    setStart(e.target.value);
                    if (e.target.value) setEnd(addDaysLocal(e.target.value, Math.max(1, len)));
                  }}
                />
              </label>
              <label className="field">
                <span>Kết thúc</span>
                <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </div>
          </>
        )}
        <label className="field">
          <span>Mục tiêu sprint</span>
          <textarea
            rows={2}
            value={goal}
            placeholder="Sprint này giao được giá trị gì? (ví dụ: Người dùng đăng nhập được bằng Google)"
            onChange={(e) => setGoal(e.target.value)}
          />
        </label>
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-footer">
          <span className="bd-spacer" />
          <button onClick={onClose}>Huỷ</button>
          <button className="primary" onClick={submit} disabled={saving}>
            {saving ? "Đang lưu..." : mode === "start" ? "Bắt đầu" : "Lưu"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ complete sprint */

export function CompleteSprintModal({
  sprint,
  snapshot,
  issues,
  unit,
  onClose,
  onSubmit,
}: {
  sprint: Sprint;
  snapshot: BoardSnapshot;
  issues: BoardIssue[];
  unit: string;
  onClose: () => void;
  onSubmit: (moveTo: number | "backlog" | "new") => Promise<void>;
}) {
  const futures = snapshot.sprints.filter((s) => s.state === "future");
  const done = issues.filter((i) => i.statusCategory === "done");
  const open = issues.filter((i) => i.statusCategory !== "done");
  const [target, setTarget] = useState<string>(futures[0] ? String(futures[0].id) : "new");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await onSubmit(target === "backlog" || target === "new" ? target : Number(target));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không hoàn thành được sprint.");
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal bd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-id">Hoàn thành {sprint.name}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="bd-complete-stats">
          <div>
            <b>{done.length}</b>
            <span>việc đã xong · {totalWeight(done, snapshot)} {unit}</span>
          </div>
          <div className={open.length > 0 ? "is-open" : ""}>
            <b>{open.length}</b>
            <span>việc chưa xong · {totalWeight(open, snapshot)} {unit}</span>
          </div>
        </div>
        {open.length > 0 ? (
          <label className="field">
            <span>Chuyển {open.length} việc chưa xong sang</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {futures.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
              <option value="new">Sprint mới</option>
              <option value="backlog">Backlog</option>
            </select>
          </label>
        ) : (
          <p className="bd-muted">Mọi việc đều đã xong. 🎉</p>
        )}
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-footer">
          <span className="bd-spacer" />
          <button onClick={onClose}>Huỷ</button>
          <button className="primary" onClick={submit} disabled={saving}>
            {saving ? "Đang hoàn thành..." : "Hoàn thành sprint"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ AI sprint plan */

/**
 * The AI sprint plan, reviewed before anything moves. Picks start ticked;
 * deferred items start unticked but can be pulled in; the fill meter recomputes
 * as the reviewer changes the selection, so the budget check is the reviewer's
 * own final choice, not the model's.
 */
export function SprintPlanModal({
  sprint,
  snapshot,
  proposal,
  loading,
  error,
  unit,
  issueButton,
  onClose,
  onApply,
}: {
  sprint: Sprint;
  snapshot: BoardSnapshot;
  proposal: SprintPlanProposal | null;
  loading: boolean;
  error: string | null;
  unit: string;
  issueButton: (key: string) => ReactNode;
  onClose: () => void;
  onApply: (keys: string[], goal: string) => Promise<void>;
}) {
  const [checked, setChecked] = useState<Set<string> | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const picked = checked ?? new Set(proposal?.picks.map((p) => p.key) ?? []);
  const goalText = goal ?? proposal?.goal ?? "";
  const byKey = useMemo(() => new Map(snapshot.issues.map((i) => [i.key, i])), [snapshot.issues]);
  const existing = snapshot.issues.filter((i) => i.sprintId === sprint.id && !i.subtask);
  const selectedIssues = [...picked].map((k) => byKey.get(k)).filter((i): i is BoardIssue => !!i);
  // Keyed by issue, so a pick that is already in the sprint isn't counted twice.
  const weight = totalWeight([...new Map([...existing, ...selectedIssues].map((i) => [i.key, i])).values()], snapshot);
  const budget = proposal?.totals.budget ?? null;
  const over = budget !== null && weight > budget * 1.1;

  function toggle(key: string) {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setChecked(next);
  }

  async function apply() {
    setSaving(true);
    setApplyError(null);
    try {
      await onApply([...picked], goalText.trim());
      onClose();
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Không áp dụng được kế hoạch.");
      setSaving(false);
    }
  }

  const row = (key: string, reason: string) => {
    const issue = byKey.get(key);
    return (
      <li key={key} className={picked.has(key) ? "is-on" : ""}>
        <label>
          <input type="checkbox" checked={picked.has(key)} onChange={() => toggle(key)} />
          {issueButton(key)}
          <span className="bd-plan-summary">{issue?.summary ?? key}</span>
          {snapshot.estimation && <span className={`bd-est ${issue?.estimate == null ? "is-empty" : ""}`}>{issue?.estimate ?? "–"}</span>}
        </label>
        {reason && <span className="bd-plan-reason">{reason}</span>}
      </li>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal bd-modal bd-plan" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header bd-plan-head">
          <span className="ai-spark" aria-hidden="true">✦</span>
          <span className="modal-id">Kế hoạch AI cho {sprint.name}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {loading && (
          <div className="bd-plan-loading">
            <div className="ai-thinking">
              <span className="chat-spinner" /> AI đang cân backlog, vận tốc, người vắng mặt và chuỗi phụ thuộc...
            </div>
            <div className="ai-skeleton" />
            <div className="ai-skeleton ai-skeleton-short" />
          </div>
        )}
        {error && <div className="modal-error">{error}</div>}

        {proposal && !loading && (
          <>
            <label className="field">
              <span>Mục tiêu sprint (AI đề xuất — sửa được)</span>
              <input value={goalText} onChange={(e) => setGoal(e.target.value)} />
            </label>
            {proposal.rationale && <p className="bd-plan-rationale">{proposal.rationale}</p>}

            <div className={`bd-plan-meter ${over ? "is-over" : ""}`}>
              <div className="bd-plan-meter-top">
                <b>
                  {weight} {unit}
                </b>
                <span className="bd-muted">
                  {budget !== null ? `/ vận tốc trung bình ${budget} ${unit}` : "— chưa có lịch sử vận tốc"}
                  {existing.length > 0 && ` · gồm ${existing.length} việc đã có trong sprint`}
                </span>
              </div>
              {budget !== null && (
                <div className="bl-meter bd-plan-bar">
                  <span className="bl-meter-fill" style={{ width: `${Math.min(100, (weight / (budget * 1.4)) * 100)}%` }} />
                  <span className="bl-meter-mark" style={{ left: `${(1 / 1.4) * 100}%` }} />
                </div>
              )}
            </div>

            {proposal.warnings.length > 0 && (
              <ul className="bd-plan-warnings">
                {proposal.warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            )}

            <div className="bd-plan-cols">
              <div>
                <h4>Đưa vào sprint ({proposal.picks.length})</h4>
                <ul className="bd-plan-list">{proposal.picks.map((p) => row(p.key, p.reason))}</ul>
              </div>
              {proposal.deferred.length > 0 && (
                <div>
                  <h4>Chưa nên đưa vào</h4>
                  <ul className="bd-plan-list is-deferred">{proposal.deferred.map((d) => row(d.key, d.reason))}</ul>
                </div>
              )}
            </div>

            {proposal.risks.length > 0 && (
              <div className="bd-plan-risks">
                <h4>Rủi ro</h4>
                <ul>
                  {proposal.risks.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {applyError && <div className="modal-error">{applyError}</div>}
        <div className="modal-footer">
          <span className="bd-muted bd-plan-note">Chưa có gì thay đổi trên Jira cho tới khi bạn bấm Áp dụng.</span>
          <span className="bd-spacer" />
          <button onClick={onClose}>Đóng</button>
          <button className="primary" onClick={apply} disabled={!proposal || loading || saving}>
            {saving ? "Đang áp dụng..." : `Áp dụng (${picked.size} việc)`}
          </button>
        </div>
      </div>
    </div>
  );
}
