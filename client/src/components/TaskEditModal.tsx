import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { isAssignableType } from "../types";
import type { DependencyType, JiraUser, Predecessor, Task, TaskAttachments, TaskTransition, TaskUpdateInput, TransitionField } from "../types";
import { filesFromClipboard, hasPending, NO_ATTACHMENTS, uploadPending, type PendingAttachments } from "../attachments";
import AttachmentPicker from "./AttachmentPicker";
import NumberInput from "./NumberInput";
import { HOURS_PER_DAY, localToday, roundHours } from "../taskForm";
import DurationHint from "./DurationHint";
import { useDialogs } from "./dialogContext";
import { Icon } from "./Icons";
import IssueTypeIcon from "./IssueTypeIcon";
import LabelsInput from "./LabelsInput";
import NamePicker from "./NamePicker";
import TaskDiscussion from "./TaskDiscussion";
import TaskLinks from "./TaskLinks";
import TaskWatchers from "./TaskWatchers";
import { TransitionFieldsForm } from "./TransitionFields";
import { missingFields, neededFieldsFrom } from "../transitionFields";
import { parentOptions, typeBlockedReason, type TypeInfo } from "../structure";

interface Props {
  task: Task;
  allTasks: Task[];
  users: JiraUser[];
  onClose: () => void;
  onSave: (patch: TaskUpdateInput) => Promise<void>;
  onDelete: () => Promise<void>;
  /** Time was logged from here — the task's "spent" needs a refresh. */
  onWorkLogged: () => void;
  /** The signed-in account, for marking mentions of you. */
  myAccountId: string;
  /** Opens the create form with this task as the parent. */
  onAddSubtask: (parent: Task) => void;
}

const DEP_TYPES: DependencyType[] = ["FS", "SS", "FF", "SF"];

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** A block of the main column that can be folded away. */
function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <details className="td-section" open>
      <summary>
        <Icon name="chevronRight" size={14} className="td-section-caret" />
        <span className="td-section-title">{title}</span>
        {hint !== undefined && hint !== 0 && <span className="td-section-hint">{hint}</span>}
      </summary>
      <div className="td-section-body">{children}</div>
    </details>
  );
}

/** A labelled group in the details panel. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="td-group">
      <h3 className="td-group-title">{title}</h3>
      <div className="td-group-body">{children}</div>
    </section>
  );
}

export default function TaskEditModal({ task, allTasks, users, onClose, onSave, onDelete, onWorkLogged, myAccountId, onAddSubtask }: Props) {
  const dialogs = useDialogs();
  const [summary, setSummary] = useState(task.summary);
  // The project list leaves descriptions out, so this is fetched on open. Until it is here
  // the box is locked and the save omits the field: sending "" would wipe what Jira holds.
  const [description, setDescription] = useState(task.description ?? "");
  const [needsDescription] = useState(task.description === undefined);
  const [descriptionLoaded, setDescriptionLoaded] = useState(!needsDescription);
  const [descriptionError, setDescriptionError] = useState(false);
  const [descriptionTouched, setDescriptionTouched] = useState(false);
  const [startDate, setStartDate] = useState(task.startDate ?? "");
  const [durationDays, setDurationDays] = useState(task.durationDays);
  const [estimate, setEstimate] = useState<number | null>(task.estimateHours !== null ? roundHours(task.estimateHours) : null);
  // A task that already has an estimate keeps it: only an empty one is filled
  // from a fractional duration.
  const [estimateTouched, setEstimateTouched] = useState(task.estimateHours !== null);
  const [percentComplete, setPercentComplete] = useState(task.percentComplete);
  const [assigneeAccountId, setAssigneeAccountId] = useState(task.assigneeAccountId ?? "");
  const [statusTransition, setStatusTransition] = useState("");
  // What the chosen status asks for (RootCause…): known up front from the transition's screen,
  // or learned when Jira refuses a move for a box only a validator checks.
  const [transitionValues, setTransitionValues] = useState<Record<string, string>>({});
  const [learned, setLearned] = useState<{ fields: TransitionField[]; reason?: string } | null>(null);
  const [priority, setPriority] = useState(task.priority ?? "");
  const [labels, setLabels] = useState<string[]>(task.labels);
  const [components, setComponents] = useState<string[]>(task.components);
  const [fixVersions, setFixVersions] = useState<string[]>(task.fixVersions);
  const [issueType, setIssueType] = useState<string>(task.issueType);
  const [parentKey, setParentKey] = useState(task.wbsParentId ?? "");
  // Option lists come from Jira and only decorate the form, like priorities: a failed
  // load leaves the current value in place and editable.
  const [componentOptions, setComponentOptions] = useState<string[]>([]);
  const [versionOptions, setVersionOptions] = useState<string[]>([]);
  const [typeOptions, setTypeOptions] = useState<TypeInfo[]>([]);
  // Both lists come from Jira; they only decorate the form, so a failure leaves
  // the current value editable rather than blocking the save.
  const [priorityOptions, setPriorityOptions] = useState<string[]>([]);
  const [labelSuggestions, setLabelSuggestions] = useState<string[]>([]);
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

  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus moves into the window when it opens and back to where it was when it closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => before?.focus?.();
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .getTaskTransitions(task.id)
      .then((t) => alive && setTransitions(t))
      .catch((e) => alive && setTransitionsError(e instanceof Error ? e.message : "Không tải được trạng thái."));
    if (needsDescription) {
      api
        .getTaskDescription(task.id)
        .then((r) => {
          if (!alive) return;
          setDescription(r.description ?? "");
          setDescriptionLoaded(true);
        })
        .catch(() => alive && setDescriptionError(true));
    }
    api
      .getTaskAttachments(task.id)
      .then((a) => alive && setExisting(a))
      .catch(() => alive && setExisting({ files: [], links: [] }));
    api
      .listPriorities()
      .then((p) => alive && setPriorityOptions(p))
      .catch(() => {});
    api
      .listLabels()
      .then((l) => alive && setLabelSuggestions(l))
      .catch(() => {});
    api
      .listComponents()
      .then((c) => alive && setComponentOptions(c.map((x) => x.name)))
      .catch(() => {});
    api
      .listVersions()
      .then((v) => alive && setVersionOptions(v.filter((x) => !x.archived).map((x) => x.name)))
      .catch(() => {});
    api
      .listIssueTypes()
      .then((t) => alive && setTypeOptions(t))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [task.id, needsDescription]);

  const candidatePreds = allTasks.filter(
    (t) => t.id !== task.id && !predecessors.some((p) => p.taskId === t.id)
  );
  const calendarDays = Math.max(1, Math.ceil(durationDays));
  const isEpicType = issueType.toLowerCase() === "epic";
  const parents = parentOptions(allTasks, task, typeOptions, issueType);
  // An Epic has no parent, whatever the select last held.
  const effectiveParent = isEpicType ? "" : parentKey;
  const subtaskPicked = typeOptions.find((t) => t.name === issueType)?.subtask ?? false;

  const reachable = (transitions ?? []).filter((t) => t.toStatusName !== task.statusName);
  const chosenTransition = reachable.find((t) => t.id === statusTransition);
  // What this move needs: its screen's boxes, plus any a refusal named.
  const neededFields: TransitionField[] = statusTransition
    ? [...(chosenTransition?.fields ?? []), ...(learned?.fields ?? []).filter((f) => !chosenTransition?.fields.some((g) => g.id === f.id))]
    : [];
  const fieldsMissing = missingFields(neededFields, transitionValues);

  const sameSet = (a: string[], b: string[]) => [...a].sort().join("\n") === [...b].sort().join("\n");
  const priorityChanged = priority !== "" && priority !== (task.priority ?? "");
  const estimateChanged = estimate !== null && estimate > 0 && estimate !== roundHours(task.estimateHours ?? -1);
  const dirty =
    summary !== task.summary ||
    descriptionTouched ||
    startDate !== (task.startDate ?? "") ||
    calendarDays !== Math.max(1, Math.ceil(task.durationDays)) ||
    estimateChanged ||
    percentComplete !== task.percentComplete ||
    assigneeAccountId !== (task.assigneeAccountId ?? "") ||
    statusTransition !== "" ||
    priorityChanged ||
    !sameSet(labels, task.labels) ||
    !sameSet(components, task.components) ||
    !sameSet(fixVersions, task.fixVersions) ||
    issueType !== task.issueType ||
    effectiveParent !== (task.wbsParentId ?? "") ||
    JSON.stringify(predecessors) !== JSON.stringify(task.predecessors) ||
    hasPending(pending);

  /** Closing throws away what was typed, so a window with changes in it asks first. */
  async function requestClose() {
    if (saving || deleting) return;
    if (dirty) {
      const discard = await dialogs.confirm({
        title: "Bỏ thay đổi?",
        message: "Bạn có thay đổi chưa lưu. Đóng cửa sổ sẽ mất chúng.",
        confirmLabel: "Bỏ thay đổi",
        cancelLabel: "Tiếp tục chỉnh sửa",
        tone: "danger",
      });
      if (!discard) return;
    }
    onClose();
  }

  function changeDuration(n: number | null) {
    if (n === null) return;
    setDurationDays(n);
    if (!estimateTouched && !Number.isInteger(n)) setEstimate(roundHours(n * HOURS_PER_DAY));
  }

  async function handleSave() {
    if (statusTransition && fieldsMissing.length > 0) {
      setError(`Trạng thái “${chosenTransition?.toStatusName ?? "mới"}” cần nhập: ${fieldsMissing.map((f) => f.name).join(", ")}.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const labelsChanged = !sameSet(labels, task.labels);
      await onSave({
        summary,
        ...(descriptionLoaded ? { description: description.trim() || null } : {}),
        startDate: startDate || null,
        durationDays: calendarDays,
        percentComplete,
        assigneeAccountId: assigneeAccountId || null,
        predecessors,
        ...(statusTransition ? { statusTransition } : {}),
        ...(statusTransition && neededFields.length > 0 ? { transitionFields: transitionValues } : {}),
        ...(priorityChanged ? { priority } : {}),
        ...(labelsChanged ? { labels } : {}),
        ...(!sameSet(components, task.components) ? { components } : {}),
        ...(!sameSet(fixVersions, task.fixVersions) ? { fixVersions } : {}),
        ...(issueType !== task.issueType ? { issueType } : {}),
        ...(effectiveParent !== (task.wbsParentId ?? "") ? { parentKey: effectiveParent || null } : {}),
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
      // Jira stopped the move for a box only its workflow checks: ask for it here, in place.
      const needed = neededFieldsFrom(e);
      if (needed) {
        setLearned({ fields: needed.fields, reason: needed.reason });
        setError(null);
      } else {
        setError(e.message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const ok = await dialogs.confirm({
      title: `Xoá ${task.id}`,
      message: `"${task.summary}" sẽ bị xoá khỏi Jira. Hành động này không thể hoàn tác.`,
      tone: "danger",
    });
    if (!ok) return;
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

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      // Stops here: the workspace listens for Escape on `window` and would close this without asking.
      e.stopPropagation();
      void requestClose();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!saving && !deleting) void handleSave();
    } else if (e.key === "Tab") {
      const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((n) => n.offsetParent !== null);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  const overEstimate = estimate !== null && estimate > 0 && spent > estimate;
  const spentPct = estimate ? Math.min(100, Math.round((spent / estimate) * 100)) : 0;

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && void requestClose()}>
      <div
        ref={dialogRef}
        className="modal modal-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="td-key"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          // A screenshot pasted anywhere in the form becomes an attachment;
          // pasting text into a field is left alone.
          const files = filesFromClipboard(e.clipboardData);
          if (files.length === 0) return;
          e.preventDefault();
          setPending((p) => ({ ...p, files: [...p.files, ...files] }));
        }}
      >
        <header className="td-header">
          <IssueTypeIcon type={task.issueType} />
          <span className="modal-id" id="td-key">
            {task.id}
          </span>
          <span className={`wbs-status is-${task.statusCategory}`} title="Trạng thái hiện tại trên Jira">
            {task.statusName}
          </span>
          <a href={task.jiraUrl} target="_blank" rel="noreferrer" className="modal-jira-link">
            Mở trên Jira
            <Icon name="external" size={13} />
          </a>
          <span className="td-header-spacer" />
          {dirty && (
            <span className="td-dirty" role="status">
              Có thay đổi chưa lưu
            </span>
          )}
          <button className="modal-close" onClick={() => void requestClose()} aria-label="Đóng" title="Đóng (Esc)">
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="td-body">
          <div className="td-main">
            <input
              className="td-title"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              aria-label="Tên công việc"
              placeholder="Tên công việc"
            />

            <label className="field">
              <span>Mô tả</span>
              <textarea
                rows={5}
                value={description}
                disabled={!descriptionLoaded}
                placeholder={descriptionLoaded ? "Thêm mô tả…" : descriptionError ? "Không tải được mô tả — chưa sửa được ở đây." : "Đang tải mô tả…"}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setDescriptionTouched(true);
                }}
              />
            </label>

            <Section
              title="Đính kèm"
              hint={existing && existing.files.length + existing.links.length > 0 ? existing.files.length + existing.links.length : undefined}
            >
              <div className="field">
                <span className="sr-only">Đính kèm &amp; liên kết</span>
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
                        <Icon name="external" size={13} className="att-link-icon" />
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
            </Section>

            <Section title="Phụ thuộc lịch" hint={predecessors.length}>
              <div className="field">
                <span>Phụ thuộc (predecessors)</span>
                <ul className="pred-list">
                  {predecessors.map((p) => (
                    <li key={p.taskId}>
                      <b>{p.taskId}</b> · {p.type} · lag {p.lagDays}d
                      <button className="link-btn" onClick={() => setPredecessors(predecessors.filter((x) => x.taskId !== p.taskId))}>
                        gỡ
                      </button>
                    </li>
                  ))}
                  {predecessors.length === 0 && <li className="muted">Không có</li>}
                </ul>
                <div className="pred-add">
                  <select value={newPredId} onChange={(e) => setNewPredId(e.target.value)} aria-label="Việc phải xong trước">
                    <option value="">Chọn task...</option>
                    {candidatePreds.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.id} · {t.summary.slice(0, 40)}
                      </option>
                    ))}
                  </select>
                  <select value={newPredType} onChange={(e) => setNewPredType(e.target.value as DependencyType)} aria-label="Kiểu phụ thuộc">
                    {DEP_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <NumberInput integer title="Lag (ngày)" value={newPredLag} onChange={(n) => setNewPredLag(n ?? 0)} style={{ width: 60 }} />
                  <button onClick={addPredecessor}>+ Thêm</button>
                </div>
              </div>
            </Section>

            <Section title="Liên kết Jira">
              <TaskLinks task={task} allTasks={allTasks} />
            </Section>

            <Section title="Bình luận & lịch sử">
              <TaskDiscussion taskId={task.id} members={users} myAccountId={myAccountId} />
            </Section>
          </div>

          <aside className="td-side" aria-label="Chi tiết công việc">
            <Group title="Trạng thái">
              <div className="field">
                <label className="td-label" htmlFor="td-status">
                  Chuyển trạng thái
                </label>
                <select
                  id="td-status"
                  value={statusTransition}
                  onChange={(e) => {
                    setStatusTransition(e.target.value);
                    setLearned(null);
                  }}
                  disabled={!transitions}
                >
                  <option value="">
                    {transitions ? `${task.statusName} (hiện tại)` : transitionsError ? "Không tải được" : "Đang tải..."}
                  </option>
                  {reachable.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.toStatusName}
                      {t.name.toLowerCase() !== t.toStatusName.toLowerCase() ? ` (${t.name})` : ""}
                      {t.fields.length > 0 ? " · cần nhập thêm" : ""}
                    </option>
                  ))}
                </select>
                {transitionsError && <small className="field-note is-error">{transitionsError}</small>}
                {transitions && reachable.length === 0 && (
                  <small className="field-note">
                    Quy trình Jira không cho chuyển tiếp từ “{task.statusName}”. Có thể cần điều kiện khác hoặc quyền riêng.
                  </small>
                )}
              </div>
              {statusTransition && neededFields.length > 0 && (
                <div className="td-needs" role="group" aria-label="Thông tin quy trình yêu cầu">
                  <p className="td-needs-note">{learned?.reason ?? "Quy trình yêu cầu nhập thông tin này trước khi chuyển:"}</p>
                  <TransitionFieldsForm fields={neededFields} values={transitionValues} onChange={setTransitionValues} jiraUrl={task.jiraUrl} />
                </div>
              )}
            </Group>

            <Group title="Con người">
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
                  <span className="field-note">Epic không gán người phụ trách — hãy gán cho các công việc con.</span>
                )}
              </label>
              <TaskWatchers taskId={task.id} />
            </Group>

            <Group title="Lịch">
              <div className="td-pair">
                <label className="field">
                  <span>Ngày bắt đầu</span>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </label>
                <label className="field">
                  <span>Thời lượng (ngày)</span>
                  <NumberInput value={durationDays} min={0.1} max={3650} onChange={changeDuration} />
                </label>
              </div>
              <DurationHint days={durationDays} />
              <label className="field">
                <span>Ngày kết thúc (tính từ trên)</span>
                <input type="date" readOnly value={startDate ? addDays(startDate, calendarDays - 1) : task.dueDate ?? ""} />
              </label>
              <label className="field">
                <span>
                  % Hoàn thành <b className="td-pct">{percentComplete}%</b>
                </span>
                <input type="range" min={0} max={100} value={percentComplete} onChange={(e) => setPercentComplete(Number(e.target.value))} />
              </label>
            </Group>

            <Group title="Công sức">
              <label className="field">
                <span>Ước lượng ban đầu (giờ)</span>
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
                <div className={`time-spent ${overEstimate ? "is-over" : ""}`}>
                  <b>{roundHours(spent)}h</b>
                  {estimate ? <span> / {estimate}h ước lượng</span> : null}
                  {overEstimate ? <span className="time-over">vượt {roundHours(spent - estimate!)}h</span> : null}
                </div>
                {estimate ? (
                  <div className={`td-bar ${overEstimate ? "is-over" : ""}`} role="img" aria-label={`Đã dùng ${spentPct}% ước lượng`}>
                    <span style={{ width: `${spentPct}%` }} />
                  </div>
                ) : null}
              </div>
              <div className="field">
                <span>Ghi giờ nhanh — ghi lên Jira dưới tên bạn</span>
                <div className="log-inline">
                  <NumberInput value={logHours} min={0.02} max={24} allowEmpty placeholder="Số giờ" className="log-hours" onChange={setLogHours} />
                  <input type="date" className="log-date" value={logDate} onChange={(e) => setLogDate(e.target.value)} aria-label="Ngày ghi giờ" />
                  <input
                    className="log-comment"
                    value={logComment}
                    onChange={(e) => setLogComment(e.target.value)}
                    placeholder="Đã làm gì (không bắt buộc)"
                    aria-label="Nội dung công việc đã làm"
                  />
                  <button type="button" onClick={handleLogWork} disabled={logging || !logHours}>
                    {logging ? "Đang ghi..." : "Ghi giờ"}
                  </button>
                </div>
                {logNote && (
                  <span className={logNote.ok ? "log-note" : "log-note is-error"} role="status">
                    {logNote.text}
                  </span>
                )}
              </div>
            </Group>

            <Group title="Phân loại">
              <label className="field">
                <span>Độ ưu tiên</span>
                <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {priority === "" && <option value="">— Không rõ —</option>}
                  {/* The task's own priority stays selectable even if the site list
                      failed to load or no longer defines it. */}
                  {priority !== "" && !priorityOptions.includes(priority) && <option value={priority}>{priority}</option>}
                  {priorityOptions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field field-wide">
                <span>Nhãn</span>
                <LabelsInput value={labels} onChange={setLabels} suggestions={labelSuggestions} />
              </div>
              <label className="field">
                <span>Loại công việc</span>
                <select value={issueType} onChange={(e) => setIssueType(e.target.value)}>
                  {!typeOptions.some((t) => t.name === issueType) && <option value={issueType}>{issueType}</option>}
                  {typeOptions.map((t) => {
                    const why = typeBlockedReason(allTasks, task, t);
                    return (
                      <option key={t.name} value={t.name} disabled={!!why}>
                        {t.name}
                        {why ? ` (${why})` : ""}
                      </option>
                    );
                  })}
                </select>
                {issueType !== task.issueType && (
                  <small className="field-note">Jira chỉ đổi được khi quy trình và màn hình của hai loại tương thích.</small>
                )}
              </label>
              <label className="field">
                <span>Việc cha</span>
                <select value={effectiveParent} disabled={isEpicType} onChange={(e) => setParentKey(e.target.value)}>
                  <option value="">{subtaskPicked ? "— Chọn việc cha —" : "— Không có —"}</option>
                  {/* The current parent stays selectable even if it is not a valid choice any more. */}
                  {effectiveParent && !parents.some((p) => p.id === effectiveParent) && <option value={effectiveParent}>{effectiveParent}</option>}
                  {parents.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id} · {p.summary.slice(0, 40)}
                    </option>
                  ))}
                </select>
                {isEpicType && <small className="field-note">Epic không có việc cha.</small>}
              </label>
              <div className="field">
                <span>Sprint</span>
                <span className="field-note">
                  {task.sprint ? `${task.sprint.name}${task.sprint.state === "active" ? " (đang chạy)" : task.sprint.state === "closed" ? " (đã đóng)" : ""}` : "Chưa vào sprint"}
                </span>
              </div>
              <div className="field field-wide">
                <span>Thành phần (components)</span>
                <NamePicker value={components} options={componentOptions} onChange={setComponents} placeholder="+ Thêm thành phần…" emptyHint="Dự án chưa có thành phần nào." />
              </div>
              <div className="field field-wide">
                <span>Phiên bản sửa lỗi / phát hành (fix versions)</span>
                <NamePicker value={fixVersions} options={versionOptions} onChange={setFixVersions} placeholder="+ Thêm phiên bản…" emptyHint="Dự án chưa có phiên bản nào." />
              </div>
            </Group>
          </aside>
        </div>

        {error && (
          <div className="modal-error td-error" role="alert">
            {error}
          </div>
        )}

        <footer className="modal-footer td-footer">
          <button className="danger" onClick={handleDelete} disabled={deleting || saving}>
            <Icon name="trash" size={14} />
            {deleting ? "Đang xoá..." : "Xoá task"}
          </button>
          {/* A sub-task has no sub-tasks of its own in Jira, so the button is only
              for tasks that can be a parent. */}
          {task.issueType !== "Sub-task" && (
            <button type="button" onClick={() => onAddSubtask(task)} disabled={deleting || saving}>
              <Icon name="subtask" size={14} />
              {task.issueType.toLowerCase() === "epic" ? "+ Việc trong Epic" : "+ Sub-task"}
            </button>
          )}
          <div className="spacer" />
          <button onClick={() => void requestClose()} disabled={saving}>
            Huỷ
          </button>
          <button className="primary" onClick={handleSave} disabled={saving} title="Ctrl + Enter">
            {saving ? "Đang lưu..." : "Lưu & đồng bộ Jira"}
          </button>
        </footer>
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
