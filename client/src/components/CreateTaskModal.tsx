import { useState } from "react";
import type { IssueTypeName, JiraUser, Task, TaskCreateInput } from "../types";

interface Props {
  tasks: Task[];
  users: JiraUser[];
  onClose: () => void;
  onCreate: (input: TaskCreateInput) => Promise<void>;
}

const ISSUE_TYPES: IssueTypeName[] = ["Epic", "Story", "Task", "Bug", "Sub-task"];

export default function CreateTaskModal({ tasks, users, onClose, onCreate }: Props) {
  const [summary, setSummary] = useState("");
  const [issueType, setIssueType] = useState<IssueTypeName>("Task");
  const [wbsParentId, setWbsParentId] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [durationDays, setDurationDays] = useState(3);
  const [assigneeAccountId, setAssigneeAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!summary.trim()) {
      setError("Cần nhập tên công việc");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        summary: summary.trim(),
        issueType,
        wbsParentId: wbsParentId || null,
        startDate,
        durationDays,
        assigneeAccountId: assigneeAccountId || null,
      });
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-id">Task mới</span>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <label className="field">
          <span>Tên công việc</span>
          <input autoFocus value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Loại</span>
            <select value={issueType} onChange={(e) => setIssueType(e.target.value as IssueTypeName)}>
              {ISSUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Thuộc task cha (WBS)</span>
            <select value={wbsParentId} onChange={(e) => setWbsParentId(e.target.value)}>
              <option value="">— Không có —</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id} · {t.summary.slice(0, 40)}
                </option>
              ))}
            </select>
          </label>
        </div>

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
        </div>

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-footer">
          <div className="spacer" />
          <button onClick={onClose} disabled={saving}>
            Huỷ
          </button>
          <button className="primary" onClick={handleCreate} disabled={saving}>
            {saving ? "Đang tạo..." : "Tạo & đẩy lên Jira"}
          </button>
        </div>
      </div>
    </div>
  );
}
