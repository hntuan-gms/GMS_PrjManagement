import { useEffect, useMemo, useRef, useState } from "react";
import DateField from "./DateField";
import { api } from "../api";
import { isAssignableType } from "../types";
import { analyzeLine, mergeFormFields, type FormFields } from "../createForm";
import type { QuickAddContext } from "../quickAdd";
import type { BulkTaskCreateInput, BulkTaskCreateResult, IssueTypeName, JiraUser, Task } from "../types";
import { filesFromClipboard, hasPending, NO_ATTACHMENTS, uploadPending, type PendingAttachments } from "../attachments";
import { durationBetween, endDateOf, HOURS_PER_DAY, localToday, roundHours } from "../taskForm";
import AttachmentPicker from "./AttachmentPicker";
import { Icon } from "./Icons";
import DurationHint from "./DurationHint";
import LabelsInput from "./LabelsInput";
import NumberInput from "./NumberInput";

interface Props {
  tasks: Task[];
  users: JiraUser[];
  onClose: () => void;
  onCreate: (input: BulkTaskCreateInput) => Promise<BulkTaskCreateResult>;
  /** Opened from "+ Sub-task": the parent is chosen and the type defaults to a sub-task type. */
  initialParentId?: string;
  /** The signed-in person: what "@tôi" in a name box means. Without it that word stays in the title. */
  meAccountId?: string;
}

const ISSUE_TYPES: IssueTypeName[] = ["Task", "Story", "Epic", "Bug", "Sub-task"];

export default function CreateTaskModal({ tasks, users, onClose, onCreate, initialParentId, meAccountId = "" }: Props) {
  // Input modes: "list" (interactive row-by-row) or "bulk" (multi-line text)
  const [mode, setMode] = useState<"list" | "bulk">("list");
  const [taskItems, setTaskItems] = useState<string[]>([""]);
  const [bulkText, setBulkText] = useState("");

  const [description, setDescription] = useState("");
  // An Epic's children are stories and tasks — Jira refuses a sub-task directly under one.
  const parent = initialParentId ? tasks.find((t) => t.id === initialParentId) : undefined;
  const wantSubtask = !!parent && parent.issueType.toLowerCase() !== "epic";
  const [issueType, setIssueType] = useState<string>(wantSubtask ? "Sub-task" : "Task");
  // What this project's Jira really calls its types. Until it answers (or if it
  // fails) the old fixed list stands, so the form never waits on it.
  const [projectTypes, setProjectTypes] = useState<Array<{ name: string; subtask: boolean }> | null>(null);
  const [wbsParentId, setWbsParentId] = useState(initialParentId ?? "");
  const [startDate, setStartDate] = useState(
    () => parent?.startDate ?? localToday()
  );
  const [durationDays, setDurationDays] = useState(3);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [estimateTouched, setEstimateTouched] = useState(false);
  const [assigneeAccountId, setAssigneeAccountId] = useState("");
  // "" leaves the priority to the project's default, as Jira's own create dialog does.
  const [priority, setPriority] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  // Both lists only decorate the form: a failure leaves it usable without them.
  const [priorityOptions, setPriorityOptions] = useState<string[]>([]);
  const [labelSuggestions, setLabelSuggestions] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<PendingAttachments>(NO_ATTACHMENTS);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkTaskCreateResult | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .listIssueTypes()
      .then((types) => {
        if (!alive || types.length === 0) return;
        setProjectTypes(types);
        // Keep the choice if this project has it; otherwise fall to its first
        // sensible type (a sub-task type when opened from a parent).
        setIssueType((cur) => {
          if (types.some((t) => t.name === cur)) return cur;
          return (types.find((t) => t.subtask === wantSubtask) ?? types[0]).name;
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [wantSubtask]);

  useEffect(() => {
    let alive = true;
    api
      .listPriorities()
      .then((p) => alive && setPriorityOptions(p))
      .catch(() => {});
    api
      .listLabels()
      .then((l) => alive && setLabelSuggestions(l))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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

  // The name boxes speak Ctrl K's words (createForm.ts): "Dựng API @Chi t6 3n" is a title and three fields.
  const quickCtx = useMemo<QuickAddContext>(
    () => ({
      today: localToday(),
      users,
      meAccountId,
      tasks,
      issueTypes: projectTypes?.map((t) => t.name) ?? [],
      priorities: priorityOptions,
      projectKey: tasks[0]?.id.replace(/-\d+$/, "") ?? "",
    }),
    [users, meAccountId, tasks, projectTypes, priorityOptions]
  );
  const rawKey = (mode === "list" ? taskItems : bulkText.split("\n")).join("\n");
  const lines = useMemo(() => rawKey.split("\n").map((l) => analyzeLine(l, quickCtx)), [rawKey, quickCtx]);
  const effectiveSummaries = lines.map((l) => l.title).filter(Boolean);
  const taskCount = effectiveSummaries.length;

  // A word that names a field fills it, once, when that word first appears or changes; after that the field
  // below is the person's to edit. (The last line to name a field wins; labels add up.) Done where the text
  // is typed, not in an effect: it is a consequence of that change, not something to keep in sync.
  const prevDerived = useRef<FormFields>({});
  function absorb(nextLines: string[]) {
    const d = mergeFormFields(nextLines.map((l) => analyzeLine(l, quickCtx).fields));
    const prev = prevDerived.current;
    prevDerived.current = d;
    if (d.issueType && d.issueType !== prev.issueType) setIssueType(d.issueType);
    if (d.assigneeAccountId && d.assigneeAccountId !== prev.assigneeAccountId) setAssigneeAccountId(d.assigneeAccountId);
    if (d.startDate && d.startDate !== prev.startDate) setStartDate(d.startDate);
    if (d.durationDays !== undefined && d.durationDays !== prev.durationDays) {
      const days = d.durationDays;
      setDurationDays(days);
      if (!Number.isInteger(days)) setEstimate((cur) => cur ?? roundHours(days * HOURS_PER_DAY));
    }
    if (d.estimateHours !== undefined && d.estimateHours !== prev.estimateHours) {
      setEstimate(d.estimateHours);
      setEstimateTouched(true);
    }
    if (d.priority && d.priority !== prev.priority) setPriority(d.priority);
    if (d.parentId && d.parentId !== prev.parentId) setWbsParentId(d.parentId);
    const labels = d.labels ?? [];
    if (labels.length > 0 && labels.join("\n") !== (prev.labels ?? []).join("\n")) setLabels((cur) => [...new Set([...cur, ...labels])]);
  }
  const endDate = endDateOf(startDate, durationDays);

  function handleTaskItemChange(index: number, value: string) {
    const updated = [...taskItems];
    updated[index] = value;
    setTaskItems(updated);
    absorb(updated);
  }

  function handleAddTaskItem() {
    setTaskItems([...taskItems, ""]);
  }

  function handleRemoveTaskItem(index: number) {
    if (taskItems.length === 1) {
      setTaskItems([""]);
      absorb([""]);
      return;
    }
    const rest = taskItems.filter((_, i) => i !== index);
    setTaskItems(rest);
    absorb(rest);
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
      setError("Vui lòng nhập ít nhất một tên việc.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await onCreate({
        summaries: effectiveSummaries,
        description: description.trim() || null,
        issueType: issueType as IssueTypeName,
        wbsParentId: wbsParentId || null,
        startDate,
        // The bar is whole days; a fractional duration's effort rides on the estimate.
        durationDays: Math.max(1, Math.ceil(durationDays)),
        assigneeAccountId: assigneeAccountId || null,
        estimateHours: estimate && estimate > 0 ? estimate : null,
        priority: priority || undefined,
        labels: labels.length > 0 ? labels : undefined,
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
      setError(e.message || "Tạo việc thất bại.");
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
              <span className="modal-id">Kết quả tạo việc</span>
            </div>
            <button className="modal-close" onClick={onClose} aria-label="Đóng">
              <Icon name="x" size={16} />
            </button>
          </div>

          <div className="import-result-summary">
            Đã tạo thành công <strong>{result.created.length}</strong> /{" "}
            <strong>{result.created.length + result.errors.length}</strong> việc trên Jira.
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
              <div className="import-errors-title">Việc chưa tạo được ({result.errors.length}):</div>
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
        className="modal modal-create"
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
            <span className="modal-id">Tạo việc</span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Đóng">
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* Header and footer stay put; only this body scrolls, so "Huỷ" / "Tạo" are always on screen. */}
        <div className="mc-body">
        {/* Mode Switcher */}
        <div className="input-mode-header">
          <span className="field-label-text">
            Việc
            {taskCount > 0 && (
              <span className="task-count-badge" aria-live="polite">
                {taskCount}
              </span>
            )}
          </span>
          <div className="segmented-control mode-tabs">
            <button
              type="button"
              className={`segmented-btn ${mode === "list" ? "active" : ""}`}
              onClick={() => handleModeChange("list")}
            >
              Từng dòng
            </button>
            <button
              type="button"
              className={`segmented-btn ${mode === "bulk" ? "active" : ""}`}
              onClick={() => handleModeChange("bulk")}
            >
              Dán nhiều dòng
            </button>
          </div>
        </div>

        {/* Input container based on mode */}
        {mode === "list" ? (
          <div className="task-items-container">
            <div className="task-input-list">
              {taskItems.map((item, index) => (
                <div key={index} className="task-input-item">
                <div className="task-input-row">
                  <span className="task-input-badge">{index + 1}</span>
                  <input
                    autoFocus={index === 0}
                    type="text"
                    className="task-input-field"
                    value={item}
                    onChange={(e) => handleTaskItemChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, index)}
                    placeholder={index === 0 ? "Dựng API @Chi t6 3n" : "Tên việc"}
                  />
                  {/* A lone empty row has nothing to remove; the spacer keeps the input's width steady
                      when the button appears with the first character typed. */}
                  {taskItems.length > 1 || item.trim() ? (
                    <button
                      type="button"
                      className="task-remove-btn"
                      onClick={() => handleRemoveTaskItem(index)}
                      title={taskItems.length > 1 ? "Xoá dòng này" : "Xoá nội dung"}
                      aria-label={taskItems.length > 1 ? "Xoá dòng này" : "Xoá nội dung"}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  ) : (
                    <span className="task-remove-spacer" aria-hidden="true" />
                  )}
                </div>
                {(lines[index]?.chips.length ?? 0) > 0 && (
                  <span className="task-chips">
                    {lines[index].chips.map((c, k) => (
                      <span key={k} className={`qa-chip qa-${c.kind}${c.warn ? " is-warn" : ""}`}>
                        {c.label}
                      </span>
                    ))}
                  </span>
                )}
                </div>
              ))}
            </div>
            <div className="task-list-actions">
              <button type="button" className="add-task-row-btn" onClick={handleAddTaskItem}>
                + Thêm dòng
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
                onChange={(e) => {
                  setBulkText(e.target.value);
                  absorb(e.target.value.split("\n"));
                }}
                placeholder={"Thiết kế màn hình đăng nhập\nDựng API @Chi t6 3n\nViết unit test"}
              />
            </label>
          </div>
        )}

        {/* Everything below is one set of values stamped on every task named above. */}
        <div className="form-section-label" role="separator">
          <span>{taskCount > 1 ? "Áp dụng chung" : "Thông tin"}</span>
        </div>

        <label className="field">
          <span className="field-label-text">Mô tả</span>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Không bắt buộc"
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field-label-text">Loại</span>
            <select value={issueType} onChange={(e) => setIssueType(e.target.value)}>
              {(projectTypes ? projectTypes.map((t) => t.name) : ISSUE_TYPES).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label-text">Thuộc việc cha (WBS)</span>
            <select value={wbsParentId} onChange={(e) => setWbsParentId(e.target.value)}>
              <option value="">Không có</option>
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
            <DateField value={startDate} onChange={setStartDate} ariaLabel="Ngày bắt đầu" />
          </label>
          <label className="field">
            <span className="field-label-text">Ngày kết thúc</span>
            <DateField
              value={endDate ?? startDate}
              base={startDate}
              onChange={(v) => {
                // Typing the end sets the duration (both days count); the start stays where it is.
                const days = durationBetween(startDate, v);
                if (days === null) return;
                setDurationDays(days);
                if (!estimateTouched && !Number.isInteger(days)) setEstimate(roundHours(days * HOURS_PER_DAY));
              }}
              ariaLabel="Ngày kết thúc"
            />
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
              placeholder="Ước lượng ban đầu"
              onChange={(n) => {
                setEstimate(n);
                setEstimateTouched(true);
              }}
            />
          </label>
        </div>

        <div className="field-row field-row-2">
          <label className="field">
            <span className="field-label-text">Người</span>
            {isAssignableType(issueType) ? (
              <select value={assigneeAccountId} onChange={(e) => setAssigneeAccountId(e.target.value)}>
                <option value="">Chưa gán</option>
                {users.map((u) => (
                  <option key={u.accountId} value={u.accountId}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            ) : (
              <span className="field-note">
                Epic không gán người.
              </span>
            )}
          </label>
          <label className="field">
            <span className="field-label-text">Ưu tiên</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">Mặc định</option>
              {priorityOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field">
          <span className="field-label-text">Nhãn</span>
          <LabelsInput value={labels} onChange={setLabels} suggestions={labelSuggestions} />
        </div>

        <div className="field">
          <span className="field-label-text">Đính kèm &amp; liên kết</span>
          <AttachmentPicker value={attachments} onChange={setAttachments} />
        </div>

        </div>

        {error && <div className="modal-error mc-error">{error}</div>}

        <div className="modal-footer">
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
            {saving ? "Đang tạo..." : taskCount <= 1 ? "Tạo" : `Tạo ${taskCount} việc`}
          </button>
        </div>
      </div>
    </div>
  );
}
