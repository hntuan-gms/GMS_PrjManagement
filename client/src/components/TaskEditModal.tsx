import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLayer } from "../useLayer";
import DateField from "./DateField";
import StatusGlyph from "./StatusGlyph";
import { api } from "../api";
import { isAssignableType } from "../types";
import type { DependencyType, JiraUser, Predecessor, SlaSettings, Task, TaskAttachments, TaskTransition, TaskUpdateInput, TransitionField } from "../types";
import { filesFromClipboard, hasPending, MAX_ATTACHMENT_BYTES, NO_ATTACHMENTS, uploadPending, type PendingAttachments } from "../attachments";
import AttachmentPicker from "./AttachmentPicker";
import TaskAttachmentList from "./TaskAttachmentList";
import NumberInput from "./NumberInput";
import { HOURS_PER_DAY, localToday, roundHours } from "../taskForm";
import DurationHint from "./DurationHint";
import { useDialogs } from "./dialogContext";
import { Icon } from "./Icons";
import IssueTypeIcon from "./IssueTypeIcon";
import LabelsInput from "./LabelsInput";
import NamePicker from "./NamePicker";
import Avatar from "./Avatar";
import Popover from "./Popover";
import PersonPicker from "./PersonPicker";
import TaskPicker from "./TaskPicker";
import TaskDiscussion from "./TaskDiscussion";
import TaskLinks from "./TaskLinks";
import { useTaskWatchers, WatcherCount } from "./TaskWatchers";
import { TransitionFieldsForm } from "./TransitionFields";
import { missingFields, neededFieldsFrom } from "../transitionFields";
import { parentOptions, typeBlockedReason, type TypeInfo } from "../structure";
import { SLA_STATE_LABEL, slaSentence, type SlaResult } from "../sla";
import { changeSchedule, dueFor, type Schedule, type ScheduleField } from "../scheduleFields";
import { formatPredecessors, parsePredecessors } from "../predecessorsText";
import type { ResourceLoad } from "../resourceAllocation";
import { toast } from "../toast";
import { useWorkCalendar } from "./workCalendarContext";

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
  /** This task's SLA under the project's policy; null while SLA is off (no row at all). */
  sla?: { result: SlaResult | null; settings: SlaSettings; nowMs: number } | null;
  /**
   * The workspace asks the panel to close (Esc outside it, another task opened): it saves what was
   * changed first, then calls onClose. A new nonce is a new request.
   */
  closeRequest?: number;
  /** The heatmap's load, so the person list can say who is free inside this task's dates (plan 0-3). */
  resourceLoad?: Pick<ResourceLoad, "people"> | null;
}

const DEP_TYPES: DependencyType[] = ["FS", "SS", "FF", "SF"];

/** Which empty section a "+" button opened. */
type SectionKey = "att" | "pred" | "link";

/** A block of the main column that can be folded away. */
function Section({ title, hint, hidden, children }: { title: string; hint?: ReactNode; hidden?: boolean; children: ReactNode }) {
  return (
    <details className="td-section" open hidden={hidden}>
      <summary>
        <Icon name="chevronRight" size={14} className="td-section-caret" />
        <span className="td-section-title">{title}</span>
        {/* A zero count says nothing the empty section below does not. */}
        {hint !== undefined && hint !== 0 && hint !== "0" && <span className="td-section-hint">{hint}</span>}
      </summary>
      <div className="td-section-body">{children}</div>
    </details>
  );
}

/** "DEMO-12" → "DEMO": the project's own prefix, what a bare number in a dependency refers to. */
const prefixOf = (key: string) => key.slice(0, key.lastIndexOf("-"));

export default function TaskEditModal({ task, allTasks, users, onClose, onSave, onDelete, onWorkLogged, myAccountId, onAddSubtask, sla, closeRequest, resourceLoad }: Props) {
  // Esc is the workspace's closeRequest, so this layer only keeps the letter keys quiet behind the panel.
  useLayer("task-detail", true);
  const dialogs = useDialogs();
  const calendar = useWorkCalendar();
  const { watchers, busy: watchBusy, error: watchError, toggle: toggleWatch } = useTaskWatchers(task.id);
  const [summary, setSummary] = useState(task.summary);
  // The project list leaves descriptions out, so this is fetched on open. Until it is here
  // the box is locked and the save omits the field: sending "" would wipe what Jira holds.
  const [description, setDescription] = useState(task.description ?? "");
  const [needsDescription] = useState(task.description === undefined);
  const [descriptionLoaded, setDescriptionLoaded] = useState(!needsDescription);
  const [descriptionError, setDescriptionError] = useState(false);
  const [descriptionTouched, setDescriptionTouched] = useState(false);
  // An empty description is one dim line until it is clicked.
  const [descEditing, setDescEditing] = useState(false);
  const [startDate, setStartDate] = useState(task.startDate ?? "");
  const [durationDays, setDurationDays] = useState(task.durationDays);
  const [schedNote, setSchedNote] = useState<string | null>(null);
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
  const [newPredType, setNewPredType] = useState<DependencyType>("FS");
  const [newPredLag, setNewPredLag] = useState(0);
  const [predNote, setPredNote] = useState<string | null>(null);
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
  // The quick-log form is folded away until "+ Ghi giờ" is pressed.
  const [logOpen, setLogOpen] = useState(false);
  const [linkCount, setLinkCount] = useState<number | null>(null);
  // An empty section is one "+" button; pressing it opens the section for its form.
  const [opened, setOpened] = useState<ReadonlySet<SectionKey>>(new Set());
  // A file is being dragged over the panel: the whole panel is the drop zone.
  const [dropping, setDropping] = useState(false);
  // The one open picker (person, parent, dependency), anchored to the button that opened it.
  const [picker, setPicker] = useState<{ kind: "person" | "parent" | "dep"; rect: DOMRect } | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const typeRef = useRef<HTMLSelectElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  const dialogRef = useRef<HTMLDivElement>(null);

  // The title wraps onto as many lines as it needs instead of being cut off at the box's edge.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight leaves the border out, and the box is border-box.
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [summary]);

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

  const calendarDays = Math.max(1, Math.ceil(durationDays));
  // The end is worked out from start and duration; with no start the task's own due date is all there is.
  const dueIso = dueFor(startDate, durationDays) || task.dueDate || "";
  const isEpicType = issueType.toLowerCase() === "epic";
  const parents = useMemo(() => parentOptions(allTasks, task, typeOptions, issueType), [allTasks, task, typeOptions, issueType]);
  // An Epic has no parent, whatever the picker last held.
  const effectiveParent = isEpicType ? "" : parentKey;
  const subtaskPicked = typeOptions.find((t) => t.name === issueType)?.subtask ?? false;
  const parentTask = effectiveParent ? allTasks.find((t) => t.id === effectiveParent) : undefined;
  const assignee = users.find((u) => u.accountId === assigneeAccountId);
  const takenPreds = useMemo(() => [task.id, ...predecessors.map((p) => p.taskId)], [task.id, predecessors]);

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

  // Sections with something in them are open; an empty one is a "+" button until it is pressed.
  const attCount = existing ? existing.files.length + existing.links.length : 0;
  const showAtt = attCount > 0 || hasPending(pending) || opened.has("att");
  const showPred = predecessors.length > 0 || opened.has("pred");
  const showLink = (linkCount ?? 0) > 0 || opened.has("link");
  const open = (k: SectionKey) => setOpened((s) => new Set(s).add(k));

  /**
   * Closing keeps what was typed: the panel saves it on the way out (plan §6.2), and only stays open
   * if Jira refused — the error, or the boxes the workflow wants, are then right there to fix. The old
   * "Bỏ thay đổi?" question made people choose between losing work and a second click.
   */
  async function requestClose() {
    if (saving || deleting) return;
    if (dirty) {
      await handleSave();
      return;
    }
    onClose();
  }

  /** Start, end and duration are one schedule: changing one recomputes the others (scheduleFields). */
  function changeField(field: ScheduleField, value: string | number) {
    const r = changeSchedule({ start: startDate, durationDays, due: dueIso } satisfies Schedule, field, value);
    if (r.rejected === "due-before-start") {
      setSchedNote("Kết thúc không thể trước ngày bắt đầu.");
      return;
    }
    if (r.rejected) return;
    setSchedNote(null);
    setStartDate(r.start);
    setDurationDays(r.durationDays);
    if (field === "duration" && !estimateTouched && !Number.isInteger(r.durationDays)) setEstimate(roundHours(r.durationDays * HOURS_PER_DAY));
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

  // The workspace asked the panel to close (Esc outside it, another task opened): save, then go.
  const onCloseRequested = useEffectEvent(() => void requestClose());
  const lastCloseRequest = useRef(closeRequest);
  useEffect(() => {
    if (closeRequest === undefined || closeRequest === lastCloseRequest.current) return;
    lastCloseRequest.current = closeRequest;
    onCloseRequested();
  }, [closeRequest]);

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

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(task.id);
      toast(`Đã sao chép ${task.id}`);
    } catch {
      toast("Không sao chép được mã", { tone: "error" });
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
      setLogOpen(false);
      onWorkLogged();
    } catch (e) {
      setLogNote({ ok: false, text: e instanceof Error ? e.message : "Không ghi được giờ." });
    } finally {
      setLogging(false);
    }
  }

  /** Adds dependencies, refusing a task that is not in the project, is this one, or is already there. */
  function addPredecessors(list: Predecessor[]) {
    const known = new Set(allTasks.map((t) => t.id));
    const next = [...predecessors];
    for (const p of list) {
      if (p.taskId === task.id) return setPredNote("Một việc không thể phụ thuộc chính nó.");
      if (!known.has(p.taskId)) return setPredNote(`Không có việc ${p.taskId} trong dự án.`);
      if (next.some((x) => x.taskId === p.taskId)) return setPredNote(`${p.taskId} đã là phụ thuộc.`);
      next.push(p);
    }
    setPredNote(null);
    setPredecessors(next);
  }

  function addPredFromPicker(t: Task) {
    setPicker(null);
    addPredecessors([{ taskId: t.id, type: newPredType, lagDays: newPredLag }]);
    setNewPredLag(0);
  }

  /** "5fs+2" (a type or lag typed in the picker's box): the text says it all, so it adds at once. */
  const predTyped = useMemo(
    () => (q: string) => {
      const r = parsePredecessors(q, prefixOf(task.id));
      if (!r.ok || r.predecessors.length === 0) return null;
      const plain = r.predecessors.length === 1 && r.predecessors[0].type === "FS" && r.predecessors[0].lagDays === 0;
      return plain ? null : { value: q.trim(), label: `Nối ${formatPredecessors(r.predecessors)}` };
    },
    [task.id]
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      // Stops here: the workspace listens for Escape on `window` and would close this without asking.
      e.stopPropagation();
      void requestClose();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!saving && !deleting) void handleSave();
    } else if ((e.ctrlKey || e.metaKey) && e.key === ".") {
      e.preventDefault();
      void copyKey();
    }
  }

  function openPicker(kind: "person" | "parent" | "dep", e: React.MouseEvent<HTMLElement>) {
    setPicker({ kind, rect: e.currentTarget.getBoundingClientRect() });
  }

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  function addDropped(files: File[]) {
    const tooBig = files.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (tooBig.length) setError(`Quá 20 MB, không thêm: ${tooBig.map((f) => f.name).join(", ")}`);
    const ok = files.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
    if (ok.length) setPending((p) => ({ ...p, files: [...p.files, ...ok] }));
  }

  const overEstimate = estimate !== null && estimate > 0 && spent > estimate;
  const spentPct = estimate ? Math.min(100, Math.round((spent / estimate) * 100)) : 0;
  const extraSummary = [
    task.sprint ? task.sprint.name : null,
    components.length > 0 ? components.join(", ") : null,
    fixVersions.length > 0 ? fixVersions.join(", ") : null,
  ].filter(Boolean);
  const showDescBox = !descriptionLoaded || description !== "" || descEditing;

  return (
    <div className="peek-layer">
      <div
        ref={dialogRef}
        className={`modal modal-detail peek-panel${dropping ? " is-dropping" : ""}`}
        role="dialog"
        aria-modal="false"
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
        onDragEnter={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragOver={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
        }}
        onDrop={(e) => {
          if (!hasFiles(e)) return;
          setDropping(false);
          // The attachment box has its own drop zone and has already taken them.
          if (e.defaultPrevented) return;
          e.preventDefault();
          addDropped(Array.from(e.dataTransfer.files));
        }}
      >
        <header className="td-header">
          <IssueTypeIcon type={task.issueType} />
          <span className="modal-id" id="td-key">
            {task.id}
          </span>
          <span className={`td-status is-${task.statusCategory}`}>
            <StatusGlyph category={task.statusCategory} percent={task.percentComplete} name={task.statusName} />
            <label className="sr-only" htmlFor="td-status">
              Chuyển trạng thái
            </label>
            <select
              id="td-status"
              title="Trạng thái hiện tại trên Jira"
              value={statusTransition}
              onChange={(e) => {
                setStatusTransition(e.target.value);
                setLearned(null);
              }}
              disabled={!transitions}
            >
              <option value="">{transitions ? task.statusName : transitionsError ? "Không tải được" : "Đang tải..."}</option>
              {reachable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.toStatusName}
                  {t.name.toLowerCase() !== t.toStatusName.toLowerCase() ? ` (${t.name})` : ""}
                  {t.fields.length > 0 ? " · cần nhập thêm" : ""}
                </option>
              ))}
            </select>
          </span>
          <WatcherCount watchers={watchers} />
          <span className="td-header-spacer" />
          {dirty && (
            <span className="td-dirty" role="status" title="Đóng khung (Esc) hoặc Ctrl Enter để lưu lên Jira">
              Chưa lưu
            </span>
          )}
          <Popover
            label={<Icon name="more" size={16} />}
            ariaLabel="Thao tác khác"
            menuLabel="Thao tác"
            role="menu"
            align="end"
            caret={false}
            className="td-more"
            menuClassName="td-more-menu"
          >
            {({ close }) => (
              <>
                <a className="menu-item" role="menuitem" href={task.jiraUrl} target="_blank" rel="noreferrer" onClick={close}>
                  <Icon name="external" />
                  <span className="menu-item-text">Mở trên Jira</span>
                </a>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    close();
                    void copyKey();
                  }}
                >
                  <Icon name="link" />
                  <span className="menu-item-text">Sao chép mã</span>
                  <kbd className="menu-kbd">Ctrl .</kbd>
                </button>
                {/* A sub-task has no sub-tasks of its own in Jira, so this is only for tasks that can be a parent. */}
                {task.issueType !== "Sub-task" && (
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    disabled={deleting || saving}
                    onClick={() => {
                      close();
                      onAddSubtask(task);
                    }}
                  >
                    <Icon name="subtask" />
                    <span className="menu-item-text">{task.issueType.toLowerCase() === "epic" ? "+ Việc trong Epic" : "+ Sub-task"}</span>
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    close();
                    const el = typeRef.current;
                    el?.focus();
                    try {
                      el?.showPicker?.();
                    } catch {
                      /* the picker needs a user gesture some browsers do not count here; focus is enough */
                    }
                  }}
                >
                  <Icon name="edit" />
                  <span className="menu-item-text">Đổi loại</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  disabled={!watchers || watchBusy}
                  onClick={() => {
                    close();
                    void toggleWatch();
                  }}
                >
                  <Icon name="eye" />
                  <span className="menu-item-text">{watchers?.isWatching ? "Bỏ theo dõi" : "Theo dõi"}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item is-danger"
                  disabled={deleting || saving}
                  onClick={() => {
                    close();
                    void handleDelete();
                  }}
                >
                  <Icon name="trash" />
                  <span className="menu-item-text">{deleting ? "Đang xoá…" : "Xoá"}</span>
                </button>
              </>
            )}
          </Popover>
          <button className="modal-close" onClick={() => void requestClose()} aria-label="Đóng" title="Đóng (Esc)">
            <Icon name="x" size={16} />
          </button>
        </header>

        {/* A Jira summary is one line of text: Enter does not start a second, a pasted break becomes a space. */}
        <div className="td-titlebar">
          <textarea
            ref={titleRef}
            className="td-title"
            rows={1}
            spellCheck={false}
            value={summary}
            onChange={(e) => setSummary(e.target.value.replace(/\s*[\r\n]+\s*/g, " "))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) e.preventDefault();
            }}
            aria-label="Tên công việc"
            placeholder="Tên công việc"
          />
        </div>

        <div className="td-body">
          {/* One column: the facts first (who, when, how much), what the work is after them. */}
          <aside className="td-side" aria-label="Chi tiết công việc">
            {transitionsError && <small className="field-note is-error">{transitionsError}</small>}
            {transitions && reachable.length === 0 && (
              <small className="field-note">Quy trình Jira không cho chuyển tiếp từ “{task.statusName}”. Có thể cần điều kiện khác hoặc quyền riêng.</small>
            )}
            {statusTransition && neededFields.length > 0 && (
              <div className="td-needs" role="group" aria-label="Thông tin quy trình yêu cầu">
                <p className="td-needs-note">{learned?.reason ?? "Quy trình yêu cầu nhập thông tin này trước khi chuyển:"}</p>
                <TransitionFieldsForm fields={neededFields} values={transitionValues} onChange={setTransitionValues} jiraUrl={task.jiraUrl} />
              </div>
            )}

            {/* An Epic is a container, not work — see isAssignableType. Shown with the reason rather than
                hidden, so the field does not vanish at random when switching between tasks. */}
            <div className="field td-row">
              <span>Người</span>
              {isAssignableType(task.issueType) ? (
                <button type="button" className="td-pick" onClick={(e) => openPicker("person", e)} aria-haspopup="dialog">
                  {assignee || task.assigneeName ? (
                    <>
                      <Avatar name={assignee?.displayName ?? task.assigneeName} avatarUrl={assignee?.avatarUrl ?? task.assigneeAvatarUrl} className="td-avatar" decorative />
                      <span className="td-pick-text">{assignee?.displayName ?? task.assigneeName}</span>
                    </>
                  ) : (
                    <span className="td-pick-text is-empty">Chưa gán</span>
                  )}
                  <Icon name="chevronDown" size={12} className="caret" />
                </button>
              ) : (
                <small className="field-note">Epic không có người phụ trách.</small>
              )}
            </div>

            <div className="field td-row">
              <span>Lịch</span>
              <div className="td-sched">
                <DateField value={startDate} onChange={(iso) => changeField("start", iso)} ariaLabel="Ngày bắt đầu" />
                <span className="td-arrow" aria-hidden="true">
                  →
                </span>
                <DateField value={dueIso} base={startDate || undefined} onChange={(iso) => changeField("due", iso)} ariaLabel="Ngày kết thúc" />
                <span className="td-dur">
                  <NumberInput value={durationDays} min={0.1} max={3650} onChange={(n) => n !== null && changeField("duration", n)} aria-label="Thời lượng (ngày)" />
                  <span className="td-unit">ngày</span>
                </span>
              </div>
              {schedNote && (
                <small className="field-note is-error" role="alert">
                  {schedNote}
                </small>
              )}
              <DurationHint days={durationDays} />
            </div>

            <label className="field td-row">
              <span>Hoàn thành</span>
              <div className="td-pct-row">
                <input type="range" min={0} max={100} value={percentComplete} aria-label="Hoàn thành" onChange={(e) => setPercentComplete(Number(e.target.value))} />
                <b className="td-pct">{percentComplete}%</b>
              </div>
            </label>

            <div className="field td-row">
              <span>Công sức</span>
              <div className="td-effort">
                <span className="td-est">
                  <NumberInput
                    value={estimate}
                    min={0.01}
                    max={10000}
                    allowEmpty
                    placeholder="12"
                    aria-label="Ước lượng (giờ)"
                    title="Ước lượng ban đầu (giờ)"
                    onChange={(n) => {
                      setEstimate(n);
                      setEstimateTouched(true);
                    }}
                  />
                  <span className="td-unit">h ước lượng</span>
                </span>
                <span className="td-spent-row">
                  <span className={`time-spent ${overEstimate ? "is-over" : ""}`}>
                    <b>{roundHours(spent)}h</b> đã ghi
                  </span>
                  <button type="button" className="td-logtoggle" onClick={() => setLogOpen((o) => !o)} aria-expanded={logOpen} aria-controls="td-logform">
                    <Icon name="plus" size={13} />
                    Ghi giờ
                  </button>
                </span>
              </div>
              {estimate ? (
                <div className={`td-bar ${overEstimate ? "is-over" : ""}`} role="img" aria-label={`Đã dùng ${spentPct}% ước lượng`}>
                  <span style={{ width: `${spentPct}%` }} />
                </div>
              ) : null}
              {overEstimate ? <span className="time-over">vượt ước lượng {roundHours(spent - estimate!)}h</span> : null}
              {logOpen && (
                <div className="td-logform" id="td-logform">
                  <small className="field-hint">Ghi lên Jira dưới tên bạn.</small>
                  <div className="log-inline">
                    <NumberInput value={logHours} min={0.02} max={24} allowEmpty placeholder="Số giờ" className="log-hours" onChange={setLogHours} />
                    <DateField className="log-date" value={logDate} onChange={setLogDate} ariaLabel="Ngày ghi giờ" />
                    <input
                      className="log-comment"
                      value={logComment}
                      onChange={(e) => setLogComment(e.target.value)}
                      placeholder="Đã làm gì (không bắt buộc)"
                      aria-label="Nội dung công việc đã làm"
                    />
                    <button type="button" className="primary" onClick={handleLogWork} disabled={logging || !logHours}>
                      {logging ? "Đang ghi..." : "Ghi giờ"}
                    </button>
                  </div>
                </div>
              )}
              {logNote && (
                <span className={logNote.ok ? "log-note" : "log-note is-error"} role="status">
                  {logNote.text}
                </span>
              )}
            </div>

            <div className="td-duo">
              <label className="field td-row">
                <span>Ưu tiên</span>
                <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {priority === "" && <option value="">Không rõ</option>}
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
              <label className="field td-row">
                <span>Loại</span>
                <select ref={typeRef} value={issueType} onChange={(e) => setIssueType(e.target.value)}>
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
              </label>
            </div>
            {issueType !== task.issueType && <small className="field-note">Jira chỉ đổi được khi quy trình và màn hình của hai loại tương thích.</small>}

            {sla && (
              // Read-only: the deadline follows from the priority above and the project's SLA policy.
              <div className="field td-row td-sla">
                <span>SLA</span>
                <span className="td-value-text">
                  {sla.result ? (
                    <>
                      <span className={`sla-chip is-${sla.result.state}`}>{SLA_STATE_LABEL[sla.result.state]}</span> {slaSentence(sla.result, sla.settings, sla.nowMs)}
                    </>
                  ) : (
                    <em className="muted">Không áp dụng (loại việc hoặc mức ưu tiên này không có SLA)</em>
                  )}
                </span>
              </div>
            )}

            <div className="field td-row">
              <span>Nhãn</span>
              <LabelsInput value={labels} onChange={setLabels} suggestions={labelSuggestions} />
            </div>

            <div className="field td-row">
              <span>Thuộc</span>
              {isEpicType ? (
                <small className="field-note">Epic không có việc cha.</small>
              ) : (
                <div className="td-pick-wrap">
                  <button type="button" className="td-pick" onClick={(e) => openPicker("parent", e)} aria-haspopup="dialog">
                    {effectiveParent ? (
                      <>
                        <span className="tp-key">{effectiveParent}</span>
                        <span className="td-pick-text">{parentTask?.summary ?? ""}</span>
                      </>
                    ) : (
                      <span className="td-pick-text is-empty">{subtaskPicked ? "Chọn việc cha" : "Không có"}</span>
                    )}
                    <Icon name="chevronDown" size={12} className="caret" />
                  </button>
                  {effectiveParent && !subtaskPicked && (
                    <button type="button" className="td-pick-clear" aria-label="Bỏ việc cha" title="Bỏ việc cha" onClick={() => setParentKey("")}>
                      <Icon name="x" size={13} />
                    </button>
                  )}
                </div>
              )}
            </div>

            <details className="td-extra" open={extraSummary.length > 0 || undefined}>
              <summary>
                <Icon name="chevronRight" size={14} className="td-section-caret" />
                <span className="td-extra-title">Sprint · Thành phần · Phiên bản</span>
                {extraSummary.length > 0 && <span className="td-extra-values">{extraSummary.join(" · ")}</span>}
              </summary>
              <div className="td-extra-body">
                <div className="field td-row">
                  <span>Sprint</span>
                  <span className="td-value-text">
                    {task.sprint ? (
                      `${task.sprint.name}${task.sprint.state === "active" ? " (đang chạy)" : task.sprint.state === "closed" ? " (đã đóng)" : ""}`
                    ) : (
                      <em className="muted">Chưa vào sprint</em>
                    )}
                  </span>
                </div>
                <div className="field td-row">
                  <span title="Thành phần (components)">Thành phần</span>
                  <NamePicker value={components} options={componentOptions} onChange={setComponents} placeholder="+ Thêm thành phần…" emptyHint="Dự án chưa có thành phần nào." />
                </div>
                <div className="field td-row">
                  <span title="Phiên bản sửa lỗi / phát hành (fix versions)">Phiên bản</span>
                  <NamePicker value={fixVersions} options={versionOptions} onChange={setFixVersions} placeholder="+ Thêm phiên bản…" emptyHint="Dự án chưa có phiên bản nào." />
                </div>
              </div>
            </details>
          </aside>

          <div className="td-main">
            {showDescBox ? (
              <label className="field">
                <span>Mô tả</span>
                <textarea
                  ref={descRef}
                  rows={5}
                  spellCheck={false}
                  autoFocus={descEditing}
                  value={description}
                  disabled={!descriptionLoaded}
                  placeholder={descriptionLoaded ? "Thêm mô tả…" : descriptionError ? "Không tải được mô tả" : "Đang tải mô tả…"}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setDescriptionTouched(true);
                  }}
                />
              </label>
            ) : (
              <div className="field td-desc-empty">
                <span>Mô tả</span>
                <button type="button" className="td-ghost" onClick={() => setDescEditing(true)}>
                  Thêm mô tả
                </button>
              </div>
            )}

            {showAtt && (
              <Section title="Đính kèm" hint={existing ? existing.files.length + existing.links.length : undefined}>
                <div className="td-stack">
                  {existing && (
                    <TaskAttachmentList
                      taskId={task.id}
                      files={existing.files}
                      links={existing.links}
                      onRemoved={(fileId) => setExisting({ ...existing, files: existing.files.filter((f) => f.id !== fileId) })}
                    />
                  )}
                  <AttachmentPicker
                    value={pending}
                    onChange={setPending}
                    hint={hasPending(pending) ? "Tệp và liên kết mới được đẩy lên Jira khi bấm Lưu." : undefined}
                  />
                </div>
              </Section>
            )}

            {showPred && (
              <Section title="Phụ thuộc lịch" hint={predecessors.length}>
                <div className="td-stack">
                  {predecessors.length > 0 && (
                    <ul className="pred-list">
                      {predecessors.map((p) => (
                        <li key={p.taskId}>
                          <span className="pred-text">
                            <b>{p.taskId}</b> · {p.type} · lag {p.lagDays}d
                          </span>
                          <button
                            className="link-btn"
                            aria-label={`Gỡ phụ thuộc ${p.taskId}`}
                            onClick={() => setPredecessors(predecessors.filter((x) => x.taskId !== p.taskId))}
                          >
                            gỡ
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* Kind and lag first, then the task: picking it adds the dependency. "5fs+2" typed in the
                      picker says all three at once. */}
                  <div className="pred-add">
                    <select value={newPredType} onChange={(e) => setNewPredType(e.target.value as DependencyType)} aria-label="Kiểu phụ thuộc">
                      {DEP_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <NumberInput integer title="Lag (ngày)" aria-label="Lag (ngày)" value={newPredLag} onChange={(n) => setNewPredLag(n ?? 0)} />
                    <button type="button" className="td-add-btn" onClick={(e) => openPicker("dep", e)} aria-haspopup="dialog">
                      <Icon name="plus" size={13} />
                      Việc phải xong trước
                    </button>
                  </div>
                  {predNote && <small className="field-note is-error">{predNote}</small>}
                </div>
              </Section>
            )}

            <Section title="Liên kết Jira" hint={linkCount ?? undefined} hidden={!showLink}>
              <TaskLinks task={task} allTasks={allTasks} onCount={setLinkCount} hidden={!showLink} />
            </Section>

            {(!showAtt || !showPred || !showLink) && (
              <div className="td-add-row">
                {!showPred && (
                  <button type="button" className="td-add-btn" onClick={() => open("pred")}>
                    <Icon name="plus" size={13} />
                    Phụ thuộc
                  </button>
                )}
                {!showLink && (
                  <button type="button" className="td-add-btn" onClick={() => open("link")}>
                    <Icon name="plus" size={13} />
                    Liên kết
                  </button>
                )}
                {!showAtt && (
                  <button type="button" className="td-add-btn" onClick={() => open("att")}>
                    <Icon name="plus" size={13} />
                    Đính kèm
                  </button>
                )}
              </div>
            )}

            {watchError && <small className="field-note is-error">{watchError}</small>}

            {/* Its own tabs (Bình luận / Lịch sử) are the heading, so no folding header repeats them. */}
            <section className="td-section td-card" aria-label="Bình luận và lịch sử thay đổi">
              <div className="td-section-body">
                <TaskDiscussion taskId={task.id} members={users} myAccountId={myAccountId} />
              </div>
            </section>
          </div>
        </div>

        {error && (
          <div className="modal-error td-error" role="alert">
            {error}
          </div>
        )}

        <footer className="modal-footer td-footer">
          <div className="spacer" />
          <button className="primary" onClick={handleSave} disabled={saving || !dirty} title="Đóng khung cũng lưu">
            {saving ? "Đang lưu…" : dirty ? "Lưu" : "Đã lưu"}
            <kbd>Ctrl ⏎</kbd>
          </button>
        </footer>
      </div>

      {picker?.kind === "person" && (
        <PersonPicker
          anchor={picker.rect}
          people={users}
          task={{ ...task, startDate: startDate || null, dueDate: dueIso || null, durationDays }}
          load={resourceLoad ?? null}
          calendar={calendar}
          currentAccountId={assigneeAccountId || null}
          meAccountId={myAccountId}
          onPick={(id) => {
            setAssigneeAccountId(id ?? "");
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === "parent" && (
        <TaskPicker
          anchor={picker.rect}
          tasks={parents}
          placeholder="Tìm việc cha"
          onPick={(t) => {
            setParentKey(t.id);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === "dep" && (
        <TaskPicker
          anchor={picker.rect}
          tasks={allTasks}
          exclude={takenPreds}
          placeholder="Mã, tên, hoặc 5fs+2"
          typed={predTyped}
          onPickTyped={(text) => {
            setPicker(null);
            const r = parsePredecessors(text, prefixOf(task.id));
            if (r.ok) addPredecessors(r.predecessors);
            else setPredNote(r.error);
          }}
          onPick={addPredFromPicker}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
