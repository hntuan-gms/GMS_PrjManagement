import { useState } from "react";
import type { DependencyType, JiraUser, Predecessor, Task, TaskUpdateInput } from "../types";

interface Props {
  task: Task;
  allTasks: Task[];
  users: JiraUser[];
  onClose: () => void;
  onSave: (patch: TaskUpdateInput) => Promise<void>;
  onDelete: () => Promise<void>;
}

const DEP_TYPES: DependencyType[] = ["FS", "SS", "FF", "SF"];
const STATUS_OPTIONS = ["Backlog", "To Do", "In Progress", "Done"];

export default function TaskEditModal({ task, allTasks, users, onClose, onSave, onDelete }: Props) {
  const [summary, setSummary] = useState(task.summary);
  const [startDate, setStartDate] = useState(task.startDate ?? "");
  const [durationDays, setDurationDays] = useState(task.durationDays);
  const [percentComplete, setPercentComplete] = useState(task.percentComplete);
  const [assigneeAccountId, setAssigneeAccountId] = useState(task.assigneeAccountId ?? "");
  const [statusTransition, setStatusTransition] = useState("");
  const [predecessors, setPredecessors] = useState<Predecessor[]>(task.predecessors);
  const [newPredId, setNewPredId] = useState("");
  const [newPredType, setNewPredType] = useState<DependencyType>("FS");
  const [newPredLag, setNewPredLag] = useState(0);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidatePreds = allTasks.filter(
    (t) => t.id !== task.id && !predecessors.some((p) => p.taskId === t.id)
  );

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        summary,
        startDate: startDate || null,
        durationDays,
        percentComplete,
        assigneeAccountId: assigneeAccountId || null,
        predecessors,
        ...(statusTransition ? { statusTransition } : {}),
      });
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Xoá task ${task.id} — "${task.summary}"? Hành động này không thể hoàn tác.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
      onClose();
    } catch (e: any) {
      setError(e.message);
      setDeleting(false);
    }
  }

  function addPredecessor() {
    if (!newPredId) return;
    setPredecessors([...predecessors, { taskId: newPredId, type: newPredType, lagDays: newPredLag }]);
    setNewPredId("");
    setNewPredLag(0);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-id">{task.id}</span>
          <a href={task.jiraUrl} target="_blank" rel="noreferrer" className="modal-jira-link">
            Mở trên Jira ↗
          </a>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <label className="field">
          <span>Tên công việc</span>
          <input value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Ngày bắt đầu</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Thời lượng (ngày)</span>
            <input
              type="number"
              min={1}
              value={durationDays}
              onChange={(e) => setDurationDays(Math.max(1, Number(e.target.value)))}
            />
          </label>
          <label className="field">
            <span>Ngày kết thúc (tính từ trên)</span>
            <input
              type="date"
              readOnly
              value={
                startDate
                  ? addDays(startDate, durationDays - 1)
                  : task.dueDate ?? ""
              }
            />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>% Hoàn thành</span>
            <input
              type="range"
              min={0}
              max={100}
              value={percentComplete}
              onChange={(e) => setPercentComplete(Number(e.target.value))}
            />
            <span>{percentComplete}%</span>
          </label>
          <label className="field">
            <span>Người phụ trách</span>
            <select value={assigneeAccountId} onChange={(e) => setAssigneeAccountId(e.target.value)}>
              <option value="">— Chưa gán —</option>
              {users.map((u) => (
                <option key={u.accountId} value={u.accountId}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>
              Trạng thái Jira <small>(hiện tại: {task.statusName})</small>
            </span>
            <select value={statusTransition} onChange={(e) => setStatusTransition(e.target.value)}>
              <option value="">— Giữ nguyên —</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field">
          <span>Phụ thuộc (predecessors)</span>
          <ul className="pred-list">
            {predecessors.map((p) => (
              <li key={p.taskId}>
                <b>{p.taskId}</b> · {p.type} · lag {p.lagDays}d
                <button
                  className="link-btn"
                  onClick={() => setPredecessors(predecessors.filter((x) => x.taskId !== p.taskId))}
                >
                  gỡ
                </button>
              </li>
            ))}
            {predecessors.length === 0 && <li className="muted">Không có</li>}
          </ul>
          <div className="pred-add">
            <select value={newPredId} onChange={(e) => setNewPredId(e.target.value)}>
              <option value="">Chọn task...</option>
              {candidatePreds.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id} · {t.summary.slice(0, 40)}
                </option>
              ))}
            </select>
            <select value={newPredType} onChange={(e) => setNewPredType(e.target.value as DependencyType)}>
              {DEP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              type="number"
              title="Lag (ngày)"
              value={newPredLag}
              onChange={(e) => setNewPredLag(Number(e.target.value))}
              style={{ width: 60 }}
            />
            <button onClick={addPredecessor}>+ Thêm</button>
          </div>
        </div>

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-footer">
          <button className="danger" onClick={handleDelete} disabled={deleting || saving}>
            {deleting ? "Đang xoá..." : "Xoá task"}
          </button>
          <div className="spacer" />
          <button onClick={onClose} disabled={saving}>
            Huỷ
          </button>
          <button className="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Đang lưu..." : "Lưu & đồng bộ Jira"}
          </button>
        </div>
      </div>
    </div>
  );
}

function addDays(iso: string, days: number): string {
  // Parse/advance in UTC (matching the server's date math) so this preview doesn't
  // drift a day off in timezones ahead of UTC when toISOString() converts back.
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
