import { useState } from "react";
import type { BulkTaskCreateInput, BulkTaskCreateResult, IssueTypeName, JiraUser, Task } from "../types";

interface Props {
  tasks: Task[];
  users: JiraUser[];
  onClose: () => void;
  onImport: (input: BulkTaskCreateInput) => Promise<BulkTaskCreateResult>;
}

const ISSUE_TYPES: IssueTypeName[] = ["Epic", "Story", "Task", "Bug", "Sub-task"];

/** Bulk create: one shared set of fields (type, parent, dates, assignee) applied to
 * many summaries at once — same shape as Jira's own "create several issues" dialog. */
export default function ImportTasksModal({ tasks, users, onClose, onImport }: Props) {
  const [summariesText, setSummariesText] = useState("");
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState<IssueTypeName>("Task");
  const [wbsParentId, setWbsParentId] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [durationDays, setDurationDays] = useState(3);
  const [assigneeAccountId, setAssigneeAccountId] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkTaskCreateResult | null>(null);

  const summaries = summariesText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  async function handleImport() {
    if (summaries.length === 0) {
      setError("Cần nhập ít nhất một tên công việc, mỗi dòng một task.");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const res = await onImport({
        summaries,
        issueType,
        description: description.trim() || null,
        wbsParentId: wbsParentId || null,
        startDate,
        durationDays,
        assigneeAccountId: assigneeAccountId || null,
      });
      setResult(res);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  }

  if (result) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <span className="modal-id">Kết quả import</span>
            <button className="modal-close" onClick={onClose}>
              ✕
            </button>
          </div>
          <div className="import-result-summary">
            Đã tạo {result.created.length}/{result.created.length + result.errors.length} task trên Jira.
          </div>
          {result.errors.length > 0 && (
            <ul className="import-error-list">
              {result.errors.map((e, i) => (
                <li key={i}>
                  <b>{e.summary}</b> — {e.message}
                </li>
              ))}
            </ul>
          )}
          <div className="modal-footer">
            <div className="spacer" />
            <button className="primary" onClick={onClose}>
              Xong
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-id">Import nhiều task</span>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <label className="field">
          <span>Danh sách công việc (mỗi dòng 1 task)</span>
          <textarea
            autoFocus
            rows={6}
            value={summariesText}
            onChange={(e) => setSummariesText(e.target.value)}
            placeholder={"Thiết kế màn hình đăng nhập\nViết API xác thực\nViết test cho API xác thực"}
          />
        </label>
        <div className="import-count">{summaries.length} công việc sẽ được tạo</div>

        <label className="field">
          <span>Mô tả (áp dụng cho tất cả)</span>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Không bắt buộc"
          />
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
          <button onClick={onClose} disabled={importing}>
            Huỷ
          </button>
          <button className="primary" onClick={handleImport} disabled={importing || summaries.length === 0}>
            {importing ? "Đang tạo..." : `Tạo ${summaries.length} task & đẩy lên Jira`}
          </button>
        </div>
      </div>
    </div>
  );
}
