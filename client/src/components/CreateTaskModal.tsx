import { useState } from "react";
import { isAssignableType } from "../types";
import type { BulkTaskCreateInput, BulkTaskCreateResult, IssueTypeName, JiraUser, Task } from "../types";
import { filesFromClipboard, hasPending, NO_ATTACHMENTS, uploadPending, type PendingAttachments } from "../attachments";
import { HOURS_PER_DAY, localToday, roundHours } from "../taskForm";
import AttachmentPicker from "./AttachmentPicker";
import DurationHint from "./DurationHint";
import NumberInput from "./NumberInput";

interface Props {
  tasks: Task[];
  users: JiraUser[];
  onClose: () => void;
  onCreate: (input: BulkTaskCreateInput) => Promise<BulkTaskCreateResult>;
}

const ISSUE_TYPES: IssueTypeName[] = ["Task", "Story", "Epic", "Bug", "Sub-task"];

export default function CreateTaskModal({ tasks, users, onClose, onCreate }: Props) {
  // Input modes: "list" (interactive row-by-row) or "bulk" (multi-line text)
  const [mode, setMode] = useState<"list" | "bulk">("list");
  const [taskItems, setTaskItems] = useState<string[]>([""]);
  const [bulkText, setBulkText] = useState("");

  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState<IssueTypeName>("Task");
  const [wbsParentId, setWbsParentId] = useState("");
  const [startDate, setStartDate] = useState(localToday());
  const [durationDays, setDurationDays] = useState(3);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [estimateTouched, setEstimateTouched] = useState(false);
  const [assigneeAccountId, setAssigneeAccountId] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachments>(NO_ATTACHMENTS);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkTaskCreateResult | null>(null);

  // Switch between interactive list and bulk textarea while preserving content
  function handleModeChange(nextMode: "list" | "bulk") {
    if (nextMode === mode) return;
    if (nextMode === "bulk") {
      const active = taskItems.map((s) => s.trim()).filter(Boolean);
      setBulkText(active.join("\n"));
    } else {
      const lines = bulkText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      setTaskItems(lines.length > 0 ? lines : [""]);
    }
    setMode(nextMode);
  }

  function getEffectiveSummaries(): string[] {
    if (mode === "list") {
      return taskItems.map((s) => s.trim()).filter(Boolean);
    }
    return bulkText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const effectiveSummaries = getEffectiveSummaries();
  const taskCount = effectiveSummaries.length;

  function handleTaskItemChange(index: number, value: string) {
    const updated = [...taskItems];
    updated[index] = value;
    setTaskItems(updated);
  }

  function handleAddTaskItem() {
    setTaskItems([...taskItems, ""]);
  }

  function handleRemoveTaskItem(index: number) {
    if (taskItems.length === 1) {
      setTaskItems([""]);
      return;
    }
    setTaskItems(taskItems.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === "Enter") {
      e.preventDefault();
      // If pressing enter on last row, append a new row
      if (index === taskItems.length - 1) {
        handleAddTaskItem();
      }
    }
  }

  async function handleCreate() {
    if (effectiveSummaries.length === 0) {
      setError("Vui lòng nhập ít nhất một tên công việc.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await onCreate({
        summaries: effectiveSummaries,
        description: description.trim() || null,
        issueType,
        wbsParentId: wbsParentId || null,
        startDate,
        // The bar is whole days; a fractional duration's effort rides on the estimate.
        durationDays: Math.max(1, Math.ceil(durationDays)),
        assigneeAccountId: assigneeAccountId || null,
        estimateHours: estimate && estimate > 0 ? estimate : null,
      });

      // Attachments need an issue key, so they go up once each issue exists —
      // the same files and links on every task created in this batch.
      const warnings = [...(res.warnings ?? [])];
      if (hasPending(attachments)) {
        for (const task of res.created) warnings.push(...(await uploadPending(task.id, attachments)));
      }

      // If anything failed or only half-stuck, show the results view; otherwise close
      if (res.errors.length > 0 || warnings.length > 0) {
        setResult({ ...res, warnings });
      } else {
        onClose();
      }
    } catch (e: any) {
      setError(e.message || "Tạo task thất bại.");
    } finally {
      setSaving(false);
    }
  }

  // Result summary view if any task failed during bulk creation
  if (result) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title-wrap">
              <span className="modal-id">Kết quả tạo task</span>
              <p className="modal-subtitle">Báo cáo quá trình đồng bộ lên Jira</p>
            </div>
            <button className="modal-close" onClick={onClose} aria-label="Đóng">
              ✕
            </button>
          </div>

          <div className="import-result-summary">
            Đã tạo thành công <strong>{result.created.length}</strong> /{" "}
            <strong>{result.created.length + result.errors.length}</strong> task trên Jira.
          </div>

          {(result.warnings?.length ?? 0) > 0 && (
            <div className="import-errors-wrap">
              <div className="import-errors-title">Đã tạo nhưng chưa đầy đủ ({result.warnings!.length}):</div>
              <ul className="import-error-list">
                {result.warnings!.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {result.errors.length > 0 && (
            <div className="import-errors-wrap">
              <div className="import-errors-title">Công việc chưa tạo được ({result.errors.length}):</div>
              <ul className="import-error-list">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    <strong>{e.summary}</strong>: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="modal-footer">
            <div className="spacer" />
            <button className="primary" onClick={onClose}>
              Đóng & xem danh sách
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onPaste={(e) => {
          // A screenshot pasted anywhere in the form becomes an attachment;
          // pasting a list of names into the bulk box is left alone.
          const files = filesFromClipboard(e.clipboardData);
          if (files.length === 0) return;
          e.preventDefault();
          setAttachments((a) => ({ ...a, files: [...a.files, ...files] }));
        }}
      >
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="modal-id">
              <span className="modal-title-icon">+</span> Task mới
            </span>
            <p className="modal-subtitle">Thêm một hoặc nhiều công việc vào dự án và đồng bộ với Jira</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="input-mode-header">
          <span className="field-label-text">
            Danh sách công việc{" "}
            <span className="task-count-badge">
              {taskCount > 0 ? `${taskCount} task` : "0 task"}
            </span>
          </span>
          <div className="segmented-control mode-tabs">
            <button
              type="button"
              className={`segmented-btn ${mode === "list" ? "active" : ""}`}
              onClick={() => handleModeChange("list")}
            >
              Từng task
            </button>
            <button
              type="button"
              className={`segmented-btn ${mode === "bulk" ? "active" : ""}`}
              onClick={() => handleModeChange("bulk")}
            >
              Nhập nhanh theo dòng
            </button>
          </div>
        </div>

        {/* Input container based on mode */}
        {mode === "list" ? (
          <div className="task-items-container">
            <div className="task-input-list">
              {taskItems.map((item, index) => (
                <div key={index} className="task-input-row">
                  <span className="task-input-badge">{index + 1}</span>
                  <input
                    autoFocus={index === 0}
                    type="text"
                    className="task-input-field"
                    value={item}
                    onChange={(e) => handleTaskItemChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, index)}
                    placeholder={
                      index === 0
                        ? "Ví dụ: Thiết kế màn hình đăng nhập..."
                        : index === 1
                        ? "Ví dụ: Xây dựng API xác thực..."
                        : "Nhập tên công việc tiếp theo..."
                    }
                  />
                  <button
                    type="button"
                    className="task-remove-btn"
                    onClick={() => handleRemoveTaskItem(index)}
                    title="Xoá dòng này"
                    aria-label="Xoá"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="task-list-actions">
              <button type="button" className="add-task-row-btn" onClick={handleAddTaskItem}>
                + Thêm task khác <span className="kbd-hint">(hoặc nhấn Enter)</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="bulk-input-container">
            <label className="field">
              <textarea
                autoFocus
                rows={5}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={"Thiết kế màn hình đăng nhập\nViết API xác thực\nViết unit test cho auth service\nTích hợp giao diện"}
              />
            </label>
            <div className="field-hint">
              Mỗi dòng tương ứng 1 task. Bạn có thể sao chép và dán nhanh danh sách từ Excel, Sheets hoặc ghi chú vào đây.
            </div>
          </div>
        )}

        {/* Common Settings for created tasks */}
        <label className="field">
          <span className="field-label-text">Mô tả {taskCount > 1 ? "(áp dụng cho tất cả task)" : ""}</span>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Mô tả chi tiết hoặc ghi chú (không bắt buộc)..."
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field-label-text">Loại</span>
            <select value={issueType} onChange={(e) => setIssueType(e.target.value as IssueTypeName)}>
              {ISSUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label-text">Thuộc task cha (WBS)</span>
            <select value={wbsParentId} onChange={(e) => setWbsParentId(e.target.value)}>
              <option value="">— Cấp cao nhất (Không có) —</option>
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
            <span className="field-label-text">Ngày bắt đầu</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label-text">Thời lượng (ngày)</span>
            <NumberInput
              value={durationDays}
              min={0.1}
              max={3650}
              onChange={(n) => {
                if (n === null) return;
                setDurationDays(n);
                if (!estimateTouched && !Number.isInteger(n)) setEstimate(roundHours(n * HOURS_PER_DAY));
              }}
            />
            <DurationHint days={durationDays} />
          </label>
          <label className="field">
            <span className="field-label-text">Ước lượng (giờ)</span>
            <NumberInput
              value={estimate}
              min={0.01}
              max={10000}
              allowEmpty
              placeholder="Original estimate"
              onChange={(n) => {
                setEstimate(n);
                setEstimateTouched(true);
              }}
            />
          </label>
          <label className="field">
            <span className="field-label-text">Người phụ trách</span>
            {isAssignableType(issueType) ? (
              <select value={assigneeAccountId} onChange={(e) => setAssigneeAccountId(e.target.value)}>
                <option value="">— Chưa gán —</option>
                {users.map((u) => (
                  <option key={u.accountId} value={u.accountId}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            ) : (
              <span className="field-note">
                Epic không gán người phụ trách — hãy gán cho các công việc con.
              </span>
            )}
          </label>
        </div>

        <div className="field">
          <span className="field-label-text">
            Đính kèm &amp; liên kết {taskCount > 1 ? "(gắn vào tất cả task)" : ""}
          </span>
          <AttachmentPicker value={attachments} onChange={setAttachments} />
        </div>

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-footer">
          <div className="footer-summary">
            {taskCount > 0 && (
              <span className="footer-count">
                Sẽ tạo <strong>{taskCount}</strong> task trên Jira
              </span>
            )}
          </div>
          <div className="spacer" />
          <button type="button" onClick={onClose} disabled={saving}>
            Huỷ
          </button>
          <button
            type="button"
            className="primary"
            onClick={handleCreate}
            disabled={saving || taskCount === 0}
          >
            {saving
              ? "Đang tạo..."
              : taskCount <= 1
              ? "Tạo task & đẩy lên Jira"
              : `Tạo ${taskCount} task & đẩy lên Jira`}
          </button>
        </div>
      </div>
    </div>
  );
}
