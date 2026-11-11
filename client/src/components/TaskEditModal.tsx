import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { useLayer } from "../useLayer";
import DateField from "./DateField";
import StatusGlyph from "./StatusGlyph";
import { api } from "../api";
import { buildTaskLink } from "../deepLink";
import { isAssignableType } from "../types";
import type { DependencyType, JiraUser, Predecessor, SlaSettings, Task, TaskTransition, TaskUpdateInput, TransitionField } from "../types";
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
import CellPicker, { type PickItem } from "./CellPicker";
import PriorityMark from "./PriorityMark";
import Spinner from "./Spinner";
import TaskDiscussion from "./TaskDiscussion";
import TaskLinks from "./TaskLinks";
import { useTaskWatchers, WatcherCount } from "./TaskWatchers";
import { TransitionFieldsForm } from "./TransitionFields";
import { Editable, InlineDescription, InlineTitle, Prop, SaveBadge } from "./taskDetail/inline";
import { missingFields, neededFieldsFrom } from "../transitionFields";
import { parentOptions, typeBlockedReason } from "../structure";
import { SLA_STATE_LABEL, slaSentence, type SlaResult } from "../sla";
import { changeSchedule, dueFor, inclusiveDays, type Schedule, type ScheduleField } from "../scheduleFields";
import { formatPredecessors, parsePredecessors } from "../predecessorsText";
import { formatDateInput } from "../dateInput";
import type { ResourceLoad } from "../resourceAllocation";
import { toast } from "../toast";
import { useWorkCalendar } from "./workCalendarContext";
import { LIST_MAX_AGE_MS, TASK_MAX_AGE_MS } from "../detailCache";
import { projectLists, readers } from "../taskDetailReads";
import { useDetail } from "../useDetail";

interface Props {
  /** The live task: every field this panel saves is applied to it at once (see ProjectWorkspace.savePanelField). */
  task: Task;
  allTasks: Task[];
  users: JiraUser[];
  onClose: () => void;
  /**
   * Save one finished field. Resolves when Jira has it, rejects with Jira's refusal (the workspace has
   * already put the old value back). `extra` is what the patch cannot say alone: a status move names a
   * transition, and only this panel knows which status that leads to.
   */
  onSave: (patch: TaskUpdateInput, extra?: Partial<Task>) => Promise<void>;
  onDelete: () => Promise<void>;
  /** Time was logged from here — the task's "spent" needs a refresh. */
  onWorkLogged: () => void;
  /** The signed-in account, for marking mentions of you. */
  myAccountId: string;
  /** Opens the create form with this task as the parent. */
  onAddSubtask: (parent: Task) => void;
  /** This task's SLA under the project's policy; null while SLA is off (no row at all). */
  sla?: { result: SlaResult | null; settings: SlaSettings; nowMs: number } | null;
  /** The workspace asks the panel to close (Esc outside it, another task opened). A new nonce is a new request. */
  closeRequest?: number;
  /** The heatmap's load, so the person list can say who is free inside this task's dates (plan 0-3). */
  resourceLoad?: Pick<ResourceLoad, "people"> | null;
  /** Opens another task (the parent in the breadcrumb). */
  onOpenTask?: (task: Task) => void;
}

const DEP_TYPES: DependencyType[] = ["FS", "SS", "FF", "SF"];

/** Which empty section a "+" button opened. */
type SectionKey = "att" | "pred" | "link";

type PickerKind = "person" | "parent" | "dep" | "status" | "priority" | "type";

/** A move to another status that needs more than a click: the boxes its screen (or a validator) asks for. */
interface PendingMove {
  transition: TaskTransition;
  fields: TransitionField[];
  reason?: string;
}

/** A block of the panel that can be folded away. */
function Section({ id, title, hint, hidden, children }: { id?: SectionKey; title: string; hint?: ReactNode; hidden?: boolean; children: ReactNode }) {
  return (
    <details className="td-section" open hidden={hidden} data-section={id}>
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

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export default function TaskEditModal({ task, allTasks, users, onClose, onSave, onDelete, onWorkLogged, myAccountId, onAddSubtask, sla, closeRequest, resourceLoad, onOpenTask }: Props) {
  // Esc is the workspace's closeRequest, so this layer only keeps the letter keys quiet behind the panel.
  useLayer("task-detail", true);
  const dialogs = useDialogs();
  const calendar = useWorkCalendar();
  const { watchers, busy: watchBusy, error: watchError, toggle: toggleWatch } = useTaskWatchers(task.id);

  // What the panel reads. A held answer is on the first render and the read behind it replaces it, so
  // nothing is blank while Jira thinks (detailCache). The lists belong to the project and last ten minutes.
  const descRead = useDetail("description", task.id, () => readers.description(task.id), TASK_MAX_AGE_MS, task.description === undefined);
  const transitionsRead = useDetail("transitions", task.id, () => readers.transitions(task.id), TASK_MAX_AGE_MS);
  const attachmentsRead = useDetail("attachments", task.id, () => readers.attachments(task.id), TASK_MAX_AGE_MS);
  const prioritiesRead = useDetail("list:priorities", "", () => projectLists.priorities(), LIST_MAX_AGE_MS);
  const labelsRead = useDetail("list:labels", "", () => projectLists.labels(), LIST_MAX_AGE_MS);
  const componentsRead = useDetail("list:components", "", () => projectLists.components(), LIST_MAX_AGE_MS);
  const versionsRead = useDetail("list:versions", "", () => projectLists.versions(), LIST_MAX_AGE_MS);
  const typesRead = useDetail("list:issueTypes", "", () => projectLists.issueTypes(), LIST_MAX_AGE_MS);
  // The conversation, the Jira links and the link kinds are drawn by TaskDiscussion and TaskLinks; asked for here
  // too (same key, so one request) so the panel can wait for them: it appears once, with everything in it.
  const commentsRead = useDetail("comments", task.id, () => readers.comments(task.id), TASK_MAX_AGE_MS);
  const linksRead = useDetail("links", task.id, () => readers.links(task.id), TASK_MAX_AGE_MS);
  const linkTypesRead = useDetail("list:linkTypes", "", () => projectLists.linkTypes(), LIST_MAX_AGE_MS);

  const description: string | null | undefined = descRead.value !== undefined ? descRead.value : task.description;
  const transitions = transitionsRead.value ?? null;
  const existing = attachmentsRead.value ?? null;
  const priorityOptions = prioritiesRead.value ?? [];
  const labelSuggestions = labelsRead.value ?? [];
  const componentOptions = useMemo(() => (componentsRead.value ?? []).map((c) => c.name), [componentsRead.value]);
  const versionOptions = useMemo(() => (versionsRead.value ?? []).filter((v) => !v.archived).map((v) => v.name), [versionsRead.value]);
  const typeOptions = useMemo(() => typesRead.value ?? [], [typesRead.value]);

  // Nothing is drawn piece by piece: until every first-screen read has an answer (held, fresh, or a refusal), the
  // panel is one spinner, and then it appears whole. Held answers make this instant; it never goes back to
  // waiting once shown (a later read keeps what is on screen).
  const arriving =
    descRead.loading ||
    transitionsRead.loading ||
    attachmentsRead.loading ||
    commentsRead.loading ||
    linksRead.loading ||
    linkTypesRead.loading ||
    prioritiesRead.loading ||
    labelsRead.loading ||
    componentsRead.loading ||
    versionsRead.loading ||
    typesRead.loading ||
    (watchers === null && !watchError);
  // The order the sections stand in, fixed when the panel first appears and then only added to: what is opened
  // takes its place after the others, where the "+" that opened it was. Re-sorting by "has data" would hop a
  // section above its neighbours the moment it gets its first item.
  const [order, setOrder] = useState<SectionKey[]>([]);
  // The section just opened: scrolled into view and its first control focused once it is on screen.
  const justOpened = useRef<SectionKey | null>(null);
  const [shown, setShown] = useState(false);
  if (!arriving && !shown) {
    setShown(true);
    const files = attachmentsRead.value;
    setOrder(
      (["att", "pred", "link"] as SectionKey[]).filter((k) =>
        k === "att" ? !!files && files.files.length + files.links.length > 0 : k === "pred" ? task.predecessors.length > 0 : (linksRead.value?.length ?? 0) > 0
      )
    );
  }

  const [saving, setSaving] = useState(0);
  const [savedAt, setSavedAt] = useState(0);
  const [move, setMove] = useState<PendingMove | null>(null);
  const [moveValues, setMoveValues] = useState<Record<string, string>>({});
  const [moveError, setMoveError] = useState<string | null>(null);
  const [newPredType, setNewPredType] = useState<DependencyType>("FS");
  const [newPredLag, setNewPredLag] = useState(0);
  const [predNote, setPredNote] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Hours logged from here show at once; once the workspace has re-read the task (its own total moves) that total wins.
  const [logged, setLogged] = useState({ base: task.spentHours ?? 0, add: 0 });
  const spent = logged.base === (task.spentHours ?? 0) ? roundHours(logged.base + logged.add) : (task.spentHours ?? 0);
  const [logHours, setLogHours] = useState<number | null>(null);
  const [logDate, setLogDate] = useState(localToday());
  const [logComment, setLogComment] = useState("");
  const [logging, setLogging] = useState(false);
  const [logNote, setLogNote] = useState<{ ok: boolean; text: string } | null>(null);
  // The quick-log form is folded away until "Ghi giờ" is pressed.
  const [logOpen, setLogOpen] = useState(false);
  // An empty section is one "+" button; pressing it opens the section for its form.
  const [opened, setOpened] = useState<ReadonlySet<SectionKey>>(new Set());
  // Sprint · Thành phần · Phiên bản: only said when there is something to say, one press shows the rest.
  const [moreOpen, setMoreOpen] = useState(false);
  // A file is being dragged over the panel: the whole panel is the drop zone.
  const [dropping, setDropping] = useState(false);
  // The one open picker, anchored to the thing that opened it.
  const [picker, setPicker] = useState<{ kind: PickerKind; rect: DOMRect } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const typeRef = useRef<HTMLButtonElement>(null);

  // A section just opened by its "+" button: kept in view and given focus, so the eye follows what the press made.
  useEffect(() => {
    const k = justOpened.current;
    if (!k) return;
    const el = dialogRef.current?.querySelector<HTMLElement>(`[data-section="${k}"]`);
    if (!el) return;
    justOpened.current = null;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "nearest", behavior: calm ? "auto" : "smooth" });
    el.querySelector<HTMLElement>(".td-section-body button, .td-section-body select, .td-section-body input")?.focus({ preventScroll: true });
  });

  // Focus moves into the window when it opens and back to where it was when it closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => before?.focus?.();
  }, []);

  const startIso = task.startDate ?? "";
  const calendarDays = Math.max(1, Math.ceil(task.durationDays));
  // The end is worked out from start and duration; with no start the task's own due date is all there is.
  const dueIso = dueFor(startIso, task.durationDays) || task.dueDate || "";
  const isEpicType = task.issueType.toLowerCase() === "epic";
  const parents = useMemo(() => parentOptions(allTasks, task, typeOptions, task.issueType), [allTasks, task, typeOptions]);
  const subtaskPicked = typeOptions.find((t) => t.name === task.issueType)?.subtask ?? false;
  const parentTask = task.wbsParentId ? allTasks.find((t) => t.id === task.wbsParentId) : undefined;
  const takenPreds = useMemo(() => [task.id, ...task.predecessors.map((p) => p.taskId)], [task.id, task.predecessors]);
  const reachable = (transitions ?? []).filter((t) => t.toStatusName !== task.statusName);
  const [today] = useState(localToday);
  const lateDays = dueIso && task.statusCategory !== "done" && dueIso < today ? inclusiveDays(dueIso, today) - 1 : 0;

  // Sections with something in them are open; an empty one is a "+" button until it is pressed.
  const attCount = existing ? existing.files.length + existing.links.length : 0;
  const linkCount = linksRead.value ? linksRead.value.length : null;
  const hasData: Record<SectionKey, boolean> = { att: attCount > 0, pred: task.predecessors.length > 0, link: (linkCount ?? 0) > 0 };
  const visible = (k: SectionKey) => hasData[k] || opened.has(k);
  const open = (k: SectionKey) => {
    justOpened.current = k;
    setOpened((prev) => new Set(prev).add(k));
    setOrder((prev) => (prev.includes(k) ? prev : [...prev, k]));
  };
  // Shown in the order they were first shown; one that got its data some other way (a dependency added from the
  // plan while this is open) stands after them.
  const sections = [...order.filter(visible), ...(["att", "pred", "link"] as SectionKey[]).filter((k) => visible(k) && !order.includes(k))];
  const absent = (["pred", "link", "att"] as SectionKey[]).filter((k) => !visible(k));
  const extraSet = !!task.sprint || task.components.length > 0 || task.fixVersions.length > 0;

  /**
   * Save one finished field. The task on screen already shows the new value (the workspace applies it before
   * asking Jira); a refusal puts the old one back and is said here, as a toast. Resolves true when saved.
   */
  async function commit(patch: TaskUpdateInput, extra?: Partial<Task>): Promise<boolean> {
    setSaving((n) => n + 1);
    try {
      await onSave(patch, extra);
      setSavedAt(Date.now());
      return true;
    } catch (e) {
      toast(errorText(e, "Không lưu được thay đổi."), { tone: "error" });
      return false;
    } finally {
      setSaving((n) => n - 1);
    }
  }

  /** A status move: straight away when the workflow asks nothing, else the boxes it wants are shown in place. */
  async function runMove(t: TaskTransition, fields: TransitionField[], values?: Record<string, string>) {
    if (fields.length > 0) {
      const missing = missingFields(fields, values ?? {});
      if (missing.length > 0) {
        setMoveError(`Trạng thái “${t.toStatusName}” cần nhập: ${missing.map((f) => f.name).join(", ")}.`);
        return;
      }
    }
    setMoveError(null);
    setSaving((n) => n + 1);
    try {
      await onSave(
        { statusTransition: t.id, ...(fields.length > 0 ? { transitionFields: values ?? {} } : {}) },
        { statusName: t.toStatusName, statusCategory: t.toCategory }
      );
      setSavedAt(Date.now());
      setMove(null);
      setMoveValues({});
      // The statuses reachable now are not the ones from before.
      void transitionsRead.reload();
    } catch (e) {
      // Jira stopped the move for a box only its workflow checks: ask for it here, in place.
      const needed = neededFieldsFrom(e);
      if (needed) {
        const known = fields.filter((f) => !needed.fields.some((g) => g.id === f.id));
        setMove({ transition: t, fields: [...known, ...needed.fields], reason: needed.reason });
        setMoveError(null);
      } else if (move) {
        setMoveError(errorText(e, "Không chuyển được trạng thái."));
      } else {
        toast(errorText(e, "Không chuyển được trạng thái."), { tone: "error" });
      }
    } finally {
      setSaving((n) => n - 1);
    }
  }

  function pickStatus(t: TaskTransition) {
    setMoveError(null);
    setMoveValues({});
    if (t.fields.length > 0) setMove({ transition: t, fields: t.fields });
    else {
      setMove(null);
      void runMove(t, []);
    }
  }

  /** Start, end and duration are one schedule: changing one recomputes the others (scheduleFields). */
  function changeSched(field: ScheduleField, value: string | number) {
    const r = changeSchedule({ start: startIso, durationDays: task.durationDays, due: dueIso } satisfies Schedule, field, value);
    if (r.rejected === "due-before-start") {
      toast("Kết thúc không thể trước ngày bắt đầu.", { tone: "error" });
      return;
    }
    if (r.rejected) return;
    const days = Math.max(1, Math.ceil(r.durationDays));
    if (r.start === startIso && days === calendarDays) return;
    // A fractional duration with no estimate: the effort goes into the Original estimate, which is what the heatmap reads.
    const fill = field === "duration" && task.estimateHours === null && !Number.isInteger(r.durationDays);
    void commit({ startDate: r.start || null, durationDays: days, ...(fill ? { estimateHours: roundHours(r.durationDays * HOURS_PER_DAY) } : {}) });
  }

  async function saveDescription(next: string | null) {
    const before = description ?? null;
    descRead.set(next);
    if (!(await commit({ description: next }))) descRead.set(before);
  }

  function requestClose() {
    // An edit in progress is saved by its own blur; do it before the panel goes.
    const active = document.activeElement as HTMLElement | null;
    if (active && dialogRef.current?.contains(active)) active.blur();
    onClose();
  }

  // The workspace asked the panel to close (Esc outside it, another task opened).
  const onCloseRequested = useEffectEvent(requestClose);
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
    try {
      await onDelete();
      onClose();
    } catch (e) {
      toast(errorText(e, "Không xoá được."), { tone: "error" });
      setDeleting(false);
    }
  }

  /** A link to this task inside the app (deepLink.ts): whoever opens it sees this detail panel, not Jira. */
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(buildTaskLink(window.location.origin, task.id));
      toast(`Đã sao chép liên kết ${task.id}`);
    } catch {
      toast("Không sao chép được liên kết", { tone: "error" });
    }
  }

  async function handleLogWork() {
    if (!logHours || logHours <= 0) return;
    setLogging(true);
    setLogNote(null);
    try {
      const entry = await api.logWork({ issueKey: task.id, date: logDate, hours: logHours, comment: logComment || null });
      setLogged((l) => ({ base: l.base, add: l.add + entry.hours }));
      setLogNote({ ok: true, text: `Đã ghi ${entry.hours}h ngày ${logDate.split("-").reverse().join("/")}.` });
      setLogHours(null);
      setLogComment("");
      setLogOpen(false);
      onWorkLogged();
    } catch (e) {
      setLogNote({ ok: false, text: errorText(e, "Không ghi được giờ.") });
    } finally {
      setLogging(false);
    }
  }

  /** Adds dependencies, refusing a task that is not in the project, is this one, or is already there. */
  function addPredecessors(list: Predecessor[]) {
    const known = new Set(allTasks.map((t) => t.id));
    const next = [...task.predecessors];
    for (const p of list) {
      if (p.taskId === task.id) return setPredNote("Một việc không thể phụ thuộc chính nó.");
      if (!known.has(p.taskId)) return setPredNote(`Không có việc ${p.taskId} trong dự án.`);
      if (next.some((x) => x.taskId === p.taskId)) return setPredNote(`${p.taskId} đã là phụ thuộc.`);
      next.push(p);
    }
    setPredNote(null);
    void commit({ predecessors: next });
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

  /** Files and links go up the moment they are added: there is no "Lưu" to wait for. */
  async function uploadNow(p: PendingAttachments) {
    if (!hasPending(p)) return;
    open("att");
    setUploading(true);
    try {
      const failures = await uploadPending(task.id, p);
      if (failures.length > 0) toast(`Một số đính kèm chưa lên Jira:\n${failures.join("\n")}`, { tone: "error" });
      else setSavedAt(Date.now());
    } finally {
      setUploading(false);
      void attachmentsRead.reload();
    }
  }

  function addDropped(files: File[]) {
    const tooBig = files.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (tooBig.length) toast(`Quá 20 MB, không thêm: ${tooBig.map((f) => f.name).join(", ")}`, { tone: "error" });
    const ok = files.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
    if (ok.length) void uploadNow({ files: ok, links: [] });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      // Stops here: the workspace listens for Escape on `window` and would close this a second time.
      // An editor inside the panel has already taken its own Esc (it stops the event before it gets here).
      e.stopPropagation();
      requestClose();
    } else if ((e.ctrlKey || e.metaKey) && e.key === ".") {
      e.preventDefault();
      void copyLink();
    }
  }

  function openPicker(kind: PickerKind, e: React.MouseEvent<HTMLElement>) {
    setPicker({ kind, rect: e.currentTarget.getBoundingClientRect() });
  }

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  const overEstimate = task.estimateHours !== null && task.estimateHours > 0 && spent > task.estimateHours;
  const estimate = task.estimateHours !== null ? roundHours(task.estimateHours) : null;
  const spentPct = estimate ? Math.min(100, Math.round((spent / estimate) * 100)) : 0;
  const assignee = users.find((u) => u.accountId === task.assigneeAccountId);
  const assigneeName = assignee?.displayName ?? task.assigneeName;
  const statusItems: PickItem[] | null = transitions
    ? reachable.map((t) => ({
        id: t.id,
        label: t.toStatusName,
        lead: <StatusGlyph category={t.toCategory} name={t.toStatusName} />,
        hint: t.fields.length > 0 ? "cần nhập thêm" : t.name.toLowerCase() !== t.toStatusName.toLowerCase() ? t.name : undefined,
      }))
    : null;

  if (!shown) {
    return (
      <div
        className="peek-layer"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) requestClose();
        }}
      >
        <div
          ref={dialogRef}
          className="modal modal-detail peek-panel"
          role="dialog"
          aria-modal="true"
          aria-busy="true"
          aria-label={`Đang tải ${task.id}`}
          tabIndex={-1}
          onKeyDown={onKeyDown}
        >
          <header className="td-header">
            <span className="td-header-spacer" />
            <button className="modal-close" onClick={requestClose} aria-label="Đóng" title="Đóng (Esc)">
              <Icon name="x" size={16} />
            </button>
          </header>
          <div className="td-loading">
            <Spinner block />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="peek-layer"
      onMouseDown={(e) => {
        // The dimmer around the window: pressing on it (not on the window) closes, like Esc.
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal modal-detail peek-panel${dropping ? " is-dropping" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="td-key"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          // A screenshot pasted anywhere in the panel becomes an attachment; pasting text into a field is left alone.
          const files = filesFromClipboard(e.clipboardData);
          if (files.length === 0) return;
          e.preventDefault();
          addDropped(files);
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
          {task.wbsParentId && (
            <>
              <button
                type="button"
                className="tdx-crumb"
                title={parentTask ? `${parentTask.id} · ${parentTask.summary}` : task.wbsParentId}
                disabled={!parentTask || !onOpenTask}
                onClick={() => parentTask && onOpenTask?.(parentTask)}
              >
                {parentTask && <IssueTypeIcon type={parentTask.issueType} />}
                {task.wbsParentId}
              </button>
              <span className="tdx-crumb-sep" aria-hidden="true">
                /
              </span>
            </>
          )}
          <IssueTypeIcon type={task.issueType} />
          <span className="modal-id" id="td-key">
            {task.id}
          </span>
          <span className="td-header-spacer" />
          <SaveBadge saving={saving > 0 || uploading} savedAt={savedAt} />
          <WatcherCount watchers={watchers} />
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
                    void copyLink();
                  }}
                >
                  <Icon name="link" />
                  <span className="menu-item-text">Sao chép liên kết</span>
                  <kbd className="menu-kbd">Ctrl .</kbd>
                </button>
                {/* A sub-task has no sub-tasks of its own in Jira, so this is only for tasks that can be a parent. */}
                {task.issueType !== "Sub-task" && (
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    disabled={deleting}
                    onClick={() => {
                      close();
                      onAddSubtask(task);
                    }}
                  >
                    <Icon name="subtask" />
                    <span className="menu-item-text">{isEpicType ? "+ Việc trong Epic" : "+ Sub-task"}</span>
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    close();
                    const el = typeRef.current;
                    if (!el) return;
                    el.scrollIntoView({ block: "center" });
                    requestAnimationFrame(() => setPicker({ kind: "type", rect: el.getBoundingClientRect() }));
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
                  disabled={deleting}
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
          <button className="modal-close" onClick={requestClose} aria-label="Đóng" title="Đóng (Esc)">
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="td-cols">
          {/* Left: what the work is (title, description, what it relates to) and the conversation about it. */}
          <div className="td-left">
            <div className="td-titlebar">
              <InlineTitle value={task.summary} onCommit={(summary) => void commit({ summary })} />
            </div>

          <section className="tdx-block" aria-label="Mô tả">
            <h3 className="tdx-h">Mô tả</h3>
            <InlineDescription
              value={description}
              error={descRead.error}
              onRetry={() => void descRead.reload()}
              onCommit={(next) => void saveDescription(next)}
            />
          </section>

          <section className="tdx-block tdx-related" aria-label="Liên quan">
            {sections.map((k) =>
              k === "att" ? (
                <Section key="att" id="att" title="Đính kèm" hint={existing ? attCount : undefined}>
                  <div className="td-stack">
                    {existing ? (
                      <TaskAttachmentList
                        taskId={task.id}
                        files={existing.files}
                        links={existing.links}
                        onRemoved={(fileId) => attachmentsRead.set({ ...existing, files: existing.files.filter((f) => f.id !== fileId) })}
                      />
                    ) : (
                      <Spinner block className="spinner-inline" />
                    )}
                    {/* Nothing is held back for a Save: what is chosen goes up at once, so the picker always starts empty. */}
                    <AttachmentPicker value={NO_ATTACHMENTS} onChange={(next) => void uploadNow(next)} hint={uploading ? "Đang tải lên Jira…" : undefined} />
                  </div>
                </Section>
              ) : k === "pred" ? (
                <Section key="pred" id="pred" title="Phụ thuộc lịch" hint={task.predecessors.length}>
                  <div className="td-stack">
                    {task.predecessors.length > 0 && (
                      <ul className="pred-list">
                        {task.predecessors.map((p) => (
                          <li key={p.taskId}>
                            <span className="pred-text">
                              <b>{p.taskId}</b> · {p.type} · lag {p.lagDays}d
                            </span>
                            <button
                              className="link-btn"
                              aria-label={`Gỡ phụ thuộc ${p.taskId}`}
                              onClick={() => void commit({ predecessors: task.predecessors.filter((x) => x.taskId !== p.taskId) })}
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
              ) : (
                <Section key="link" id="link" title="Liên kết Jira" hint={linkCount ?? undefined}>
                  <TaskLinks task={task} allTasks={allTasks} />
                </Section>
              )
            )}

            {absent.length > 0 && (
              <div className="td-add-row">
                {absent.map((k) => (
                  <button key={k} type="button" className="td-add-btn" onClick={() => open(k)}>
                    <Icon name="plus" size={13} />
                    {k === "pred" ? "Phụ thuộc" : k === "link" ? "Liên kết" : "Đính kèm"}
                  </button>
                ))}
              </div>
            )}
          </section>

          {watchError && <small className="field-note is-error tdx-pad">{watchError}</small>}

          {/* Its own tabs (Bình luận / Lịch sử) are the heading, so no folding header repeats them. */}
          <section className="tdx-block td-card" aria-label="Bình luận và lịch sử thay đổi">
            <TaskDiscussion taskId={task.id} members={users} myAccountId={myAccountId} />
          </section>
          </div>

          {/* Right: where it stands (status, who, priority, dates) and its details. A pane of its own, scrolling on its own. */}
          <aside className="td-right" aria-label="Chi tiết việc">
            <div className="tdx-top">
            <div className="tdx-chips">
              <button
                type="button"
                id="td-status"
                className={`tdx-chip is-status is-${task.statusCategory}`}
                aria-haspopup="dialog"
                title="Chuyển trạng thái"
                onClick={(e) => openPicker("status", e)}
              >
                <StatusGlyph category={task.statusCategory} percent={task.percentComplete} name={task.statusName} />
                <span>{task.statusName}</span>
                <Icon name="chevronDown" size={12} className="caret" />
              </button>

              {isAssignableType(task.issueType) ? (
                <button type="button" className="tdx-chip" aria-haspopup="dialog" title="Người" onClick={(e) => openPicker("person", e)}>
                  {assigneeName ? (
                    <>
                      <Avatar name={assigneeName} avatarUrl={assignee?.avatarUrl ?? task.assigneeAvatarUrl} className="td-avatar" decorative />
                      <span>{assigneeName}</span>
                    </>
                  ) : (
                    <span className="tdx-placeholder">Chưa gán</span>
                  )}
                  <Icon name="chevronDown" size={12} className="caret" />
                </button>
              ) : (
                <span className="tdx-note">Epic không gán người</span>
              )}

              <button type="button" className="tdx-chip" aria-haspopup="dialog" title="Ưu tiên" onClick={(e) => openPicker("priority", e)}>
                {task.priority ? (
                  <>
                    <PriorityMark priority={task.priority} />
                    <span>{task.priority}</span>
                  </>
                ) : (
                  <span className="tdx-placeholder">Ưu tiên</span>
                )}
                <Icon name="chevronDown" size={12} className="caret" />
              </button>
            </div>

            {transitions && reachable.length === 0 && (
              <small className="field-note">Quy trình Jira không cho chuyển tiếp từ “{task.statusName}”. Có thể cần điều kiện khác hoặc quyền riêng.</small>
            )}
            {transitionsRead.error && !transitions && <small className="field-note is-error">{transitionsRead.error}</small>}
            {move && (
              <div className="td-needs" role="group" aria-label="Thông tin quy trình yêu cầu">
                <p className="td-needs-note">{move.reason ?? `Chuyển sang “${move.transition.toStatusName}” cần nhập thông tin này:`}</p>
                <TransitionFieldsForm fields={move.fields} values={moveValues} onChange={setMoveValues} jiraUrl={task.jiraUrl} />
                {moveError && (
                  <div className="td-error" role="alert">
                    {moveError}
                  </div>
                )}
                <div className="tdx-needs-actions">
                  <button type="button" className="primary" disabled={saving > 0} onClick={() => void runMove(move.transition, move.fields, moveValues)}>
                    Chuyển sang {move.transition.toStatusName}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMove(null);
                      setMoveError(null);
                    }}
                  >
                    Huỷ
                  </button>
                </div>
              </div>
            )}

            {/* Start → end · days: each part is text until it is pressed. Late work says how late, once. */}
            <div className="tdx-sched" data-prop="schedule">
              <Icon name="calendar" size={14} className="tdx-sched-icon" />
              <Editable
                label="Ngày bắt đầu"
                display={startIso ? formatDateInput(startIso) : <span className="tdx-placeholder">Bắt đầu</span>}
                editor={(done) => <DateField value={startIso} onChange={(iso) => { changeSched("start", iso); done(); }} ariaLabel="Ngày bắt đầu" />}
              />
              <span className="tdx-arrow" aria-hidden="true">
                →
              </span>
              <Editable
                label="Ngày kết thúc"
                display={dueIso ? formatDateInput(dueIso) : <span className="tdx-placeholder">Kết thúc</span>}
                editor={(done) => (
                  <DateField value={dueIso} base={startIso || undefined} onChange={(iso) => { changeSched("due", iso); done(); }} ariaLabel="Ngày kết thúc" />
                )}
              />
              <span className="tdx-dot" aria-hidden="true">
                ·
              </span>
              <DurationEditor days={task.durationDays} onCommit={(n) => changeSched("duration", n)} />
              {lateDays > 0 && <span className="tdx-late">trễ {lateDays} ngày</span>}
            </div>
            <DurationHint days={task.durationDays} />
            </div>

          <section className="tdx-block" aria-label="Chi tiết">
            <h3 className="tdx-h">Chi tiết</h3>

            <Prop name="progress" label="Tiến độ">
              <Editable
                label="Tiến độ"
                display={
                  <>
                    <span className="tdx-meter" aria-hidden="true">
                      <span style={{ width: `${task.percentComplete}%` }} />
                    </span>
                    <span className="tdx-num">{task.percentComplete}%</span>
                  </>
                }
                editor={(done) => (
                  <ProgressEditor value={task.percentComplete} onCommit={(n) => void commit({ percentComplete: n })} onDone={done} />
                )}
              />
            </Prop>

            <Prop name="estimate" label="Ước lượng">
              <div className="td-effort">
                <span className="tdx-effort-line">
                  <Editable
                    label="Ước lượng (giờ)"
                    display={estimate !== null ? <span className="tdx-num">{estimate}h</span> : <span className="tdx-placeholder">Chưa có</span>}
                    editor={(done) => (
                      <EstimateEditor
                        value={estimate}
                        onCommit={(n) => {
                          if (n !== null && n > 0 && n !== estimate) void commit({ estimateHours: n });
                        }}
                        onDone={done}
                      />
                    )}
                  />
                  <span className="td-spent-row">
                    <span className={`time-spent ${overEstimate ? "is-over" : ""}`}>
                      Đã ghi <b>{roundHours(spent)}h</b>
                    </span>
                    <button type="button" className="td-logtoggle" onClick={() => setLogOpen((o) => !o)} aria-expanded={logOpen} aria-controls="td-logform">
                      <Icon name="plus" size={13} />
                      Ghi giờ
                    </button>
                  </span>
                </span>
                {estimate ? (
                  <div className={`td-bar ${overEstimate ? "is-over" : ""}`} role="img" aria-label={`Đã dùng ${spentPct}% ước lượng`}>
                    <span style={{ width: `${spentPct}%` }} />
                  </div>
                ) : null}
                {overEstimate ? <span className="time-over">vượt ước lượng {roundHours(spent - estimate!)}h</span> : null}
                {logOpen && (
                  <div className="td-logform" id="td-logform">
                    <div className="log-inline">
                      <NumberInput value={logHours} min={0.02} max={24} allowEmpty placeholder="Số giờ" className="log-hours" onChange={setLogHours} />
                      <DateField className="log-date" value={logDate} onChange={setLogDate} ariaLabel="Ngày ghi giờ" />
                      <input
                        className="log-comment"
                        value={logComment}
                        onChange={(e) => setLogComment(e.target.value)}
                        placeholder="Đã làm gì (không bắt buộc)"
                        aria-label="Nội dung việc đã làm"
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
            </Prop>

            <Prop name="type" label="Loại">
              <button ref={typeRef} type="button" className="tdx-val" aria-haspopup="dialog" onClick={(e) => openPicker("type", e)}>
                <IssueTypeIcon type={task.issueType} />
                {task.issueType}
              </button>
            </Prop>

            <Prop name="parent" label="Thuộc">
              {isEpicType ? (
                <span className="tdx-note">Epic không có việc cha</span>
              ) : (
                <span className="td-pick-wrap">
                  <button type="button" className="tdx-val" aria-haspopup="dialog" onClick={(e) => openPicker("parent", e)}>
                    {task.wbsParentId ? (
                      <>
                        <span className="tp-key">{task.wbsParentId}</span>
                        <span className="td-pick-text">{parentTask?.summary ?? ""}</span>
                      </>
                    ) : (
                      <span className="tdx-placeholder">{subtaskPicked ? "Chọn việc cha" : "Không có"}</span>
                    )}
                  </button>
                  {task.wbsParentId && !subtaskPicked && (
                    <button type="button" className="td-pick-clear" aria-label="Bỏ việc cha" title="Bỏ việc cha" onClick={() => void commit({ parentKey: null })}>
                      <Icon name="x" size={13} />
                    </button>
                  )}
                </span>
              )}
            </Prop>

            <Prop name="labels" label="Nhãn">
              <LabelsInput value={task.labels} onChange={(labels) => void commit({ labels })} suggestions={labelSuggestions} placeholder="Thêm nhãn…" />
            </Prop>

            {task.sprint && (
              <Prop name="sprint" label="Sprint">
                <span className="tdx-text">
                  {task.sprint.name}
                  {task.sprint.state === "active" ? " (đang chạy)" : task.sprint.state === "closed" ? " (đã đóng)" : ""}
                </span>
              </Prop>
            )}

            {(extraSet || moreOpen) && (
              <>
                <Prop name="components" label="Thành phần">
                  <NamePicker
                    value={task.components}
                    options={componentOptions}
                    onChange={(components) => void commit({ components })}
                    placeholder="+ Thêm thành phần…"
                    emptyHint="Dự án chưa có thành phần nào."
                  />
                </Prop>
                <Prop name="versions" label="Phiên bản">
                  <NamePicker
                    value={task.fixVersions}
                    options={versionOptions}
                    onChange={(fixVersions) => void commit({ fixVersions })}
                    placeholder="+ Thêm phiên bản…"
                    emptyHint="Dự án chưa có phiên bản nào."
                  />
                </Prop>
              </>
            )}

            {sla && (
              // Read-only: the deadline follows from the priority above and the project's SLA policy.
              <Prop name="sla" label="SLA" className="td-sla">
                <span className="td-value-text">
                  {sla.result ? (
                    <>
                      <span className={`sla-chip is-${sla.result.state}`}>{SLA_STATE_LABEL[sla.result.state]}</span> {slaSentence(sla.result, sla.settings, sla.nowMs)}
                    </>
                  ) : (
                    <em className="muted">Không áp dụng (loại việc hoặc mức ưu tiên này không có SLA)</em>
                  )}
                </span>
              </Prop>
            )}

            {!extraSet && !moreOpen && (
              <button type="button" className="td-add-btn tdx-more" onClick={() => setMoreOpen(true)}>
                <Icon name="plus" size={13} />
                Thành phần · Phiên bản
              </button>
            )}
          </section>

          </aside>
        </div>
      </div>

      {picker?.kind === "status" && (
        <CellPicker
          anchor={picker.rect}
          items={statusItems}
          loading={!transitions && !transitionsRead.error}
          placeholder="Chuyển sang trạng thái"
          onPick={(it) => {
            setPicker(null);
            const t = reachable.find((x) => x.id === it.id);
            if (t) pickStatus(t);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === "priority" && (
        <CellPicker
          anchor={picker.rect}
          items={
            prioritiesRead.value || task.priority
              ? [...new Set([...(task.priority ? [task.priority] : []), ...priorityOptions])].map((p) => ({
                  id: p,
                  label: p,
                  lead: <PriorityMark priority={p} />,
                  hint: p === task.priority ? "hiện tại" : undefined,
                }))
              : null
          }
          loading={!prioritiesRead.value}
          placeholder="Ưu tiên"
          onPick={(it) => {
            setPicker(null);
            if (it.id !== task.priority) void commit({ priority: it.id });
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === "type" && (
        <CellPicker
          anchor={picker.rect}
          items={(typeOptions.some((t) => t.name === task.issueType) ? typeOptions : [{ name: task.issueType, subtask: false }, ...typeOptions]).map((t) => {
            const why = typeBlockedReason(allTasks, task, t);
            return {
              id: t.name,
              label: t.name,
              lead: <IssueTypeIcon type={t.name as Task["issueType"]} />,
              hint: why ?? (t.name === task.issueType ? "hiện tại" : undefined),
              tone: why ? ("risk" as const) : undefined,
            };
          })}
          loading={!typesRead.value}
          placeholder="Loại việc"
          onPick={(it) => {
            setPicker(null);
            const t = typeOptions.find((x) => x.name === it.id);
            const why = t ? typeBlockedReason(allTasks, task, t) : null;
            if (why) toast(`Không đổi sang ${it.id}: ${why}.`, { tone: "error" });
            else if (it.id !== task.issueType) void commit({ issueType: it.id });
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === "person" && (
        <PersonPicker
          anchor={picker.rect}
          people={users}
          task={task}
          load={resourceLoad ?? null}
          calendar={calendar}
          currentAccountId={task.assigneeAccountId}
          meAccountId={myAccountId}
          onPick={(id) => {
            setPicker(null);
            if ((id ?? null) !== task.assigneeAccountId) void commit({ assigneeAccountId: id });
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === "parent" && (
        <TaskPicker
          anchor={picker.rect}
          tasks={parents}
          placeholder="Search for issues"
          onPick={(t) => {
            setPicker(null);
            if (t.id !== task.wbsParentId) void commit({ parentKey: t.id });
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === "dep" && (
        <TaskPicker
          anchor={picker.rect}
          tasks={allTasks}
          exclude={takenPreds}
          placeholder="Key, name, or 5fs+2"
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

/* --------------------------------------------------------- small value editors */

/** Duration in days: "8 ngày" until pressed, then a number box. Saves on leaving it. */
function DurationEditor({ days, onCommit }: { days: number; onCommit: (n: number) => void }) {
  return (
    <Editable
      label="Thời lượng (ngày)"
      display={<span className="tdx-num">{days} ngày</span>}
      editor={() => <DraftNumber value={days} min={0.1} max={3650} unit="ngày" ariaLabel="Thời lượng (ngày)" onCommit={(n) => n !== null && n !== days && onCommit(n)} />}
    />
  );
}

function EstimateEditor({ value, onCommit, onDone }: { value: number | null; onCommit: (n: number | null) => void; onDone: () => void }) {
  return <DraftNumber value={value} min={0.01} max={10000} allowEmpty unit="h" ariaLabel="Ước lượng (giờ)" placeholder="12" onCommit={onCommit} onDone={onDone} />;
}

/** A number box that keeps what is typed and hands it over once, when the box is left or Enter is pressed. */
function DraftNumber({
  value,
  min,
  max,
  allowEmpty,
  unit,
  ariaLabel,
  placeholder,
  onCommit,
  onDone,
}: {
  value: number | null;
  min: number;
  max: number;
  allowEmpty?: boolean;
  unit: string;
  ariaLabel: string;
  placeholder?: string;
  onCommit: (n: number | null) => void;
  onDone?: () => void;
}) {
  const [draft, setDraft] = useState<number | null>(value);
  const sent = useRef(false);
  const finish = () => {
    if (sent.current) return;
    sent.current = true;
    onCommit(draft);
  };
  return (
    <span
      className="td-est"
      onBlur={(e) => {
        // The wrapper (Editable) ends the edit on blur; the value goes first.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) finish();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish();
          onDone?.();
          e.currentTarget.querySelector("input")?.blur();
        } else if (e.key === "Escape") {
          sent.current = true;
        }
      }}
    >
      <NumberInput value={draft} min={min} max={max} allowEmpty={allowEmpty} placeholder={placeholder} aria-label={ariaLabel} onChange={setDraft} />
      <span className="td-unit">{unit}</span>
    </span>
  );
}

/** The % complete as a slider; the value is sent when the thumb is let go or the box is left, not on every pixel. */
function ProgressEditor({ value, onCommit, onDone }: { value: number; onCommit: (n: number) => void; onDone: () => void }) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);
  const cancelled = useRef(false);
  const finish = () => {
    if (cancelled.current || draft === committed.current) return;
    committed.current = draft;
    onCommit(draft);
  };
  return (
    <span
      className="td-pct-row"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) finish();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish();
          onDone();
        } else if (e.key === "Escape") {
          cancelled.current = true;
        }
      }}
    >
      <input type="range" min={0} max={100} value={draft} aria-label="Hoàn thành" onChange={(e) => setDraft(Number(e.target.value))} onPointerUp={finish} />
      <b className="td-pct">{draft}%</b>
    </span>
  );
}
