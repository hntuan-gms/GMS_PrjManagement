import { useEffect, useState } from "react";
import { api } from "../api";
import { isAssignableType } from "../types";
import type { DependencyType, JiraUser, Predecessor, Task, TaskAttachments, TaskTransition, TaskUpdateInput } from "../types";
import { filesFromClipboard, hasPending, NO_ATTACHMENTS, uploadPending, type PendingAttachments } from "../attachments";
import AttachmentPicker from "./AttachmentPicker";
import NumberInput from "./NumberInput";
import { HOURS_PER_DAY, localToday, roundHours } from "../taskForm";
import DurationHint from "./DurationHint";

interface Props {
  task: Task;
  allTasks: Task[];
  users: JiraUser[];
  onClose: () => void;
  onSave: (patch: TaskUpdateInput) => Promise<void>;
  onDelete: () => Promise<void>;
  /** Time was logged from here — the task's "spent" needs a refresh. */
  onWorkLogged: () => void;
}

const DEP_TYPES: DependencyType[] = ["FS", "SS", "FF", "SF"];

export default function TaskEditModal({ task, allTasks, users, onClose, onSave, onDelete, onWorkLogged }: Props) {
  const [summary, setSummary] = useState(task.summary);
  const [description, setDescription] = useState(task.description ?? "");
  const [startDate, setStartDate] = useState(task.startDate ?? "");
  const [durationDays, setDurationDays] = useState(task.durationDays);
  const [estimate, setEstimate] = useState<number | null>(task.estimateHours !== null ? roundHours(task.estimateHours) : null);
  // A task that already has an estimate keeps it: only an empty one is filled
  // from a fractional duration.
  const [estimateTouched, setEstimateTouched] = useState(task.estimateHours !== null);
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

  // The statuses offered are the ones this issue's workflow allows from where
  // it is now. A fixed Backlog/To Do/In Progress/Done list was BUG-05: a site
  // whose status is "In-Progress" or "Pending" either failed on save or never
  // showed the status at all.
  const [transitions, setTransitions] = useState<TaskTransition[] | null>(null);
  const [transitionsError, setTransitionsError] = useState<string | null>(null);

  const [existing, setExisting] = useState<TaskAttachments | null>(null);
  const [pending, setPending] = useState<PendingAttachments>(NO_ATTACHMENTS);

  const [spent, setSpent] = useState(task.spentHours ?? 0);
  const [logHours, setLogHours] = useState<number | null>(null);
  const [logDate, setLogDate] = useState(localToday());
  const [logComment, setLogComment] = useState("");
  const [logging, setLogging] = useState(false);
  const [logNote, setLogNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getTaskTransitions(task.id)
      .then((t) => alive && setTransitions(t))
      .catch((e) => alive && setTransitionsError(e instanceof Error ? e.message : "Không tải được trạng thái."));
    api
      .getTaskAttachments(task.id)
      .then((a) => alive && setExisting(a))
      .catch(() => alive && setExisting({ files: [], links: [] }));
    return () => {
      alive = false;
    };
  }, [task.id]);

  const candidatePreds = allTasks.filter(
    (t) => t.id !== task.id && !predecessors.some((p) => p.taskId === t.id)
  );
  const calendarDays = Math.max(1, Math.ceil(durationDays));

  function changeDuration(n: number | null) {
    if (n === null) return;
    setDurationDays(n);
    if (!estimateTouched && !Number.isInteger(n)) setEstimate(roundHours(n * HOURS_PER_DAY));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const estimateChanged = estimate !== null && estimate > 0 && estimate !== roundHours(task.estimateHours ?? -1);
      await onSave({
        summary,
        description: description.trim() || null,
        startDate: startDate || null,
        durationDays: calendarDays,
        percentComplete,
        assigneeAccountId: assigneeAccountId || null,
        predecessors,
        ...(statusTransition ? { statusTransition } : {}),
        ...(estimateChanged ? { estimateHours: estimate! } : {}),
      });
      if (hasPending(pending)) {
        const failures = await uploadPending(task.id, pending);
        setPending(NO_ATTACHMENTS);
        if (failures.length > 0) {
          setError(`Đã lưu công việc, nhưng một số đính kèm chưa lên Jira:\n${failures.join("\n")}`);
          api.getTaskAttachments(task.id).then(setExisting).catch(() => {});
          setSaving(false);
          return;
        }
      }
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

  async function handleLogWork() {
    if (!logHours || logHours <= 0) return;
    setLogging(true);
    setLogNote(null);
    try {
      const entry = await api.logWork({ issueKey: task.id, date: logDate, hours: logHours, comment: logComment || null });
      setSpent((s) => roundHours(s + entry.hours));
      setLogNote({ ok: true, text: `Đã ghi ${entry.hours}h ngày ${logDate.split("-").reverse().join("/")}.` });
      setLogHours(null);
      setLogComment("");
      onWorkLogged();
    } catch (e) {
      setLogNote({ ok: false, text: e instanceof Error ? e.message : "Không ghi được giờ." });
    } finally {
      setLogging(false);
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
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onPaste={(e) => {
          // A screenshot pasted anywhere in the form becomes an attachment;
          // pasting text into a field is left alone.
          const files = filesFromClipboard(e.clipboardData);
          if (files.length === 0) return;
          e.preventDefault();
          setPending((p) => ({ ...p, files: [...p.files, ...files] }));
        }}
      >
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

        <label className="field">
          <span>Mô tả</span>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Ngày bắt đầu</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Thời lượng (ngày)</span>
            <NumberInput value={durationDays} min={0.1} max={3650} onChange={changeDuration} />
            <DurationHint days={durationDays} />
          </label>
          <label className="field">
            <span>Ngày kết thúc (tính từ trên)</span>
            <input
              type="date"
              readOnly
              value={startDate ? addDays(startDate, calendarDays - 1) : task.dueDate ?? ""}
            />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Ước lượng — Original estimate (giờ)</span>
            <NumberInput
              value={estimate}
              min={0.01}
              max={10000}
              allowEmpty
              placeholder="VD: 12"
              onChange={(n) => {
                setEstimate(n);
                setEstimateTouched(true);
              }}
            />
          </label>
          <div className="field">
            <span>Đã ghi</span>
            <div className={`time-spent ${estimate && spent > estimate ? "is-over" : ""}`}>
              <b>{roundHours(spent)}h</b>
              {estimate ? <span> / {estimate}h ước lượng</span> : null}
              {estimate && spent > estimate ? <span className="time-over">▲ vượt {roundHours(spent - estimate)}h</span> : null}
            </div>
          </div>
        </div>

        <div className="field">
          <span>Ghi giờ nhanh — ghi lên Jira dưới tên bạn</span>
          <div className="log-inline">
            <NumberInput value={logHours} min={0.02} max={24} allowEmpty placeholder="Số giờ" className="log-hours" onChange={setLogHours} />
            <input type="date" className="log-date" value={logDate} onChange={(e) => setLogDate(e.target.value)} />
            <input
              className="log-comment"
              value={logComment}
              onChange={(e) => setLogComment(e.target.value)}
              placeholder="Đã làm gì (không bắt buộc)"
            />
            <button type="button" onClick={handleLogWork} disabled={logging || !logHours}>
              {logging ? "Đang ghi..." : "Ghi giờ"}
            </button>
          </div>
          {logNote && <span className={logNote.ok ? "log-note" : "log-note is-error"}>{logNote.text}</span>}
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
          {/* An Epic is a container, not work — see isAssignableType. Shown as a
              disabled field with the reason rather than hidden, so the field
              doesn't appear to vanish at random when switching between tasks. */}
          <label className="field">
            <span>Người phụ trách</span>
            {isAssignableType(task.issueType) ? (
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
          <label className="field">
            <span>
              Trạng thái Jira <small>(hiện tại: {task.statusName})</small>
            </span>
            <select
              value={statusTransition}
              onChange={(e) => setStatusTransition(e.target.value)}
              disabled={!transitions}
            >
              <option value="">
                {transitions ? "— Giữ nguyên —" : transitionsError ? "Không tải được" : "Đang tải..."}
              </option>
              {(transitions ?? [])
                .filter((t) => t.toStatusName !== task.statusName)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.toStatusName}
                    {t.name.toLowerCase() !== t.toStatusName.toLowerCase() ? ` (${t.name})` : ""}
                  </option>
                ))}
            </select>
            {transitionsError && <small className="field-note">{transitionsError}</small>}
            {transitions && transitions.filter((t) => t.toStatusName !== task.statusName).length === 0 && (
              <small className="field-note">Quy trình không cho chuyển tiếp từ trạng thái này.</small>
            )}
          </label>
        </div>

        <div className="field">
          <span>Đính kèm &amp; liên kết</span>
          {existing && (existing.files.length > 0 || existing.links.length > 0) && (
            <ul className="att-existing">
              {existing.files.map((f) => (
                <li key={f.id}>
                  <span className="att-ext">{f.filename.split(".").pop()?.slice(0, 4)}</span>
                  <span className="att-name" title={f.filename}>{f.filename}</span>
                  <span className="att-size">{f.author ?? ""}</span>
                </li>
              ))}
              {existing.links.map((l) => (
                <li key={l.id}>
                  <span className="att-link-icon" aria-hidden="true">🔗</span>
                  <a className="att-name" href={l.url} target="_blank" rel="noreferrer" title={l.url}>
                    {l.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <AttachmentPicker
            value={pending}
            onChange={setPending}
            hint={hasPending(pending) ? "Tệp và liên kết mới được đẩy lên Jira khi bấm Lưu." : undefined}
          />
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
            <NumberInput
              integer
              title="Lag (ngày)"
              value={newPredLag}
              onChange={(n) => setNewPredLag(n ?? 0)}
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
