import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ApiError, NetworkError, api } from "../api";
import { computeOptimisticCascade } from "../dependencyCascade";
import { EMPTY_FILTER, type BoardFilter } from "../boardModel";
import { EMPTY_TASK_FILTER, useTaskFilter } from "../taskFilter";
import { toBoardFilter, toTaskFilter, type ViewFilterSpec } from "../viewFilter";
import { makeEntry, pushEntry, undoSteps, type UndoEntry } from "../undo";
import { addDays, buildResourceLoad, defaultWindow, todayIso } from "../resourceAllocation";
import { loadTasksCache, saveTasksCache, tasksCacheKey } from "../tasksCache";
import type {
  BulkTaskCreateResult,
  DependencyType,
  JiraUser,
  Predecessor,
  ProjectVersion,
  ResourcePool,
  Session,
  Task,
  TaskUpdateInput,
  TaskUpdateResponse,
} from "../types";
import { isAssignableType } from "../types";
import BoardView from "./BoardView";
import ChatDock from "./ChatDock";
import CreateTaskModal from "./CreateTaskModal";
import GanttView from "./GanttView";
import ImportModal from "./ImportModal";
import PlanReviewModal from "./PlanReviewModal";
import KbktImportModal from "./KbktImportModal";
import ProgressReportView from "./ProgressReportView";
import ResourceView from "./ResourceView";
import TaskEditModal from "./TaskEditModal";
import { Icon } from "./Icons";
import Toolbar, { type WorkspaceView } from "./Toolbar";
import TimesheetView from "./TimesheetView";

interface Props {
  session: Session;
  onSwitchProject: () => void;
  onLogout: () => void;
}

const OVERLAY_WARNING =
  "Phụ thuộc, baseline và % hoàn thành được lưu tạm trên máy chủ và sẽ mất khi ứng dụng " +
  "được cập nhật. Ngày bắt đầu và ngày kết thúc vẫn được đồng bộ với Jira.";

export default function ProjectWorkspace({ session, onSwitchProject, onLogout }: Props) {
  // What this browser saw last time, shown at once while the fresh copy loads (tasksCache.ts).
  // Read once, on the first render; the workspace is keyed by project so it never goes stale.
  const cacheKey = tasksCacheKey(session.site.cloudId, session.user.accountId, session.project?.key ?? "");
  const [cached] = useState(() => loadTasksCache(cacheKey));
  const [tasks, setTasks] = useState<Task[]>(cached?.tasks ?? []);
  const [users, setUsers] = useState<JiraUser[]>(cached?.users ?? []);
  const [loading, setLoading] = useState(!cached);
  // True while a cached copy is on screen and the real one has not arrived.
  const [showingCache, setShowingCache] = useState(!!cached);
  const [loadError, setLoadError] = useState<{ message: string; network: boolean } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [overlayNoticeDismissed, setOverlayNoticeDismissed] = useState(false);
  // Capacity and absences. Held here rather than inside ResourceView so the
  // toolbar can badge overload without mounting the tab, and so switching tabs
  // does not refetch it.
  const [pool, setPool] = useState<ResourcePool | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);
  // Whether this user may see the resource tab at all. The server decides (only
  // project admins get an accurate member list — see requireResourceAccess), and
  // answers it through the pool fetch, so "checking" hides the tab until then
  // rather than flashing it at someone who is about to be refused.
  const [resourceAccess, setResourceAccess] = useState<"checking" | "allowed" | "denied">("checking");

  // One filter for the Gantt and the resource heatmap, remembered per project.
  const [taskFilter, setTaskFilter] = useTaskFilter(
    `gms.taskFilter.${session.site.cloudId}.${session.project?.key ?? ""}`
  );

  const [view, setView] = useState<WorkspaceView>("gantt");
  // A filter the assistant set while the board was not showing. The board's own
  // filter is local to it and starts empty on every visit, so it is handed over
  // through here and taken once (BoardView's onIncomingFilterTaken).
  const [chatBoardFilter, setChatBoardFilter] = useState<BoardFilter | null>(null);

  /* ---- JQL: the text lives in the filter, Jira's answer here ---- */
  const [jqlKeys, setJqlKeys] = useState<Set<string> | null>(null);
  const [jqlState, setJqlState] = useState({ running: false, error: null as string | null, truncated: false, count: null as number | null });
  const jqlSeq = useRef(0);
  const lastJql = useRef("");

  const fetchJql = useCallback(async (jql: string) => {
    const seq = ++jqlSeq.current;
    setJqlState((s) => ({ ...s, running: true, error: null }));
    try {
      const r = await api.searchJql(jql);
      if (seq !== jqlSeq.current) return; // a newer query was started meanwhile
      setJqlKeys(new Set(r.keys));
      setJqlState({ running: false, error: null, truncated: r.truncated, count: r.keys.length });
    } catch (e) {
      if (seq !== jqlSeq.current) return;
      if (e instanceof ApiError && e.status === 401) return;
      // A query Jira refused restricts nothing (see FilterContext.jqlKeys): the message
      // says why, and the rest of the filter still works.
      setJqlKeys(null);
      setJqlState({ running: false, error: e instanceof Error ? e.message : "Không chạy được JQL.", truncated: false, count: null });
    }
  }, []);

  // Whatever changes the filter's JQL — typing one, applying a saved filter, "Xoá lọc",
  // a page reload with one remembered — ends up here, so the keys always match the text.
  useEffect(() => {
    const jql = taskFilter.jql.trim();
    if (jql === lastJql.current) return;
    lastJql.current = jql;
    if (!jql) {
      jqlSeq.current++;
      setJqlKeys(null);
      setJqlState({ running: false, error: null, truncated: false, count: null });
      return;
    }
    void fetchJql(jql);
  }, [taskFilter.jql, fetchJql]);

  function runJql(jql: string) {
    // The same text again means "run it again" — the tasks may have changed since.
    if (jql === lastJql.current) void fetchJql(jql);
    else setTaskFilter({ ...taskFilter, jql });
  }

  /* ---- releases: a small list, loaded once, failures quiet ---- */
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  useEffect(() => {
    api.listVersions().then(setVersions).catch(() => {});
  }, []);

  /* ---- undo: dragging bars and the % handle, this session only ---- */
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [undoing, setUndoing] = useState(false);
  const tasksRef = useRef<Task[]>([]);

  /** set_view_filter: one sentence → the same filters a person sets by hand. */
  function applyChatFilter(ev: { spec: ViewFilterSpec | null; view: "gantt" | "board" | null }) {
    setTaskFilter(ev.spec ? toTaskFilter(ev.spec) : EMPTY_TASK_FILTER);
    setChatBoardFilter(ev.spec ? toBoardFilter(ev.spec) : EMPTY_FILTER);
    // Stay where the user is when that tab shows filters; otherwise bring them to one.
    setView(ev.view ?? (view === "gantt" || view === "board" || view === "resource" ? view : "gantt"));
  }
  // The report the Báo cáo tab should open on — set by a report card in the chat.
  const [focusReportId, setFocusReportId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Multi-select, file-list style. `selectedIds` is the real selection;
  // `selectedId` stays the single "focused" row the edit modal opens on, and
  // doubles as the anchor a Shift range measures from.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  // Progress text while a bulk action runs ("Đang gán 3/10…"); null when idle.
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [shiftDays, setShiftDays] = useState(1);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  // Open with an optional parent: "+ Sub-task" in the edit modal pre-fills it.
  const [creating, setCreating] = useState<false | { parentId?: string }>(false);
  // The plan being reviewed, opened from the assistant's table card.
  const [reviewRunId, setReviewRunId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importingKbkt, setImportingKbkt] = useState(false);
  // A single global counter, bumped once per mutating request (schedule change,
  // progress change, add-dependency, modal save). `taskVersion` records, per task
  // id, the seq of the most recent thing that touched it — whether that task was
  // the request's own primary target OR one it optimistically cascaded to.
  //
  // Every response is applied task-by-task (see applyTaskUpdate) against this map:
  // a task is only overwritten if no NEWER seq has touched it since. This matters
  // beyond the primary task, because a save can take several seconds (a Jira round
  // trip), and a request's response carries `cascaded` tasks too — e.g. dragging A
  // (which pushes successor B) and then, before A's slow response lands, dragging
  // B directly: A's response still shows B at the position A's cascade computed,
  // and applying it unguarded would yank B backward over the drag you just did.
  const seqCounter = useRef(0);
  const taskVersion = useRef<Map<string, number>>(new Map());
  function nextSeq(): number {
    return ++seqCounter.current;
  }

  async function loadAll() {
    // With a cached copy on screen nothing blocks: this only swaps the fresh data in.
    if (!cached) setLoading(true);
    setLoadError(null);
    const seqAtStart = seqCounter.current;
    try {
      const [t, u] = await Promise.all([api.listTasks(), api.listUsers()]);
      setUsers(u);
      // A drag or edit made while the old copy was showing has its own refresh coming;
      // this response was asked for before it and would put the old schedule back.
      if (seqCounter.current === seqAtStart) {
        setTasks(t);
        saveTasksCache(cacheKey, t, u);
      }
    } catch (e) {
      // The shell is already swapping in the login screen; a red banner here would
      // just flash during the transition.
      if (e instanceof ApiError && e.status === 401) return;
      const message = e instanceof Error ? e.message : "Không tải được dữ liệu dự án.";
      if (cached) {
        // Keep working on what is shown, but say it may be out of date.
        setSyncError(`Chưa làm mới được dữ liệu (${message}) — đang hiện bản lưu lần trước.`);
      } else {
        setLoadError({ message, network: e instanceof NetworkError });
      }
    } finally {
      setLoading(false);
      setShowingCache(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetched separately from tasks, not inside loadAll: an empty or failing
  // resource pool is a valid state (capacity falls back to the default), and it
  // must not be able to take the whole workspace down with it.
  useEffect(() => {
    let alive = true;
    api
      .getResourcePool()
      .then((p) => {
        if (!alive) return;
        setPool(p);
        setResourceAccess("allowed");
      })
      .catch((e: Error) => {
        if (!alive) return;
        if (e instanceof ApiError && e.code === "RESOURCES_ADMIN_ONLY") {
          setResourceAccess("denied");
          return;
        }
        // Any other failure keeps the old behaviour: the tab stays, with its
        // notice, and capacity falls back to the default. A refusal is only ever
        // reported through the code above, so this can't admit a non-admin.
        setPoolError(e.message);
        setResourceAccess("allowed");
      });
    return () => {
      alive = false;
    };
  }, []);

  const taskKeys = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks]);

  // The toolbar's overload count, over the same default window the resource tab
  // opens on — so the badge and the tab can never contradict each other.
  const overloadedPeople = useMemo(() => {
    const today = todayIso();
    const span = defaultWindow(tasks, today);
    return buildResourceLoad({
      tasks,
      users,
      profiles: pool?.profiles ?? [],
      absences: pool?.absences ?? [],
      defaultCapacityHours: pool?.defaultCapacityHours,
      from: span.from,
      to: span.to,
    }).overloadedPeople;
  }, [tasks, users, pool]);

  // Esc backs out one layer at a time: closes the edit modal if one is open
  // (matching its own Esc-to-close, if it has one, but this is the fallback),
  // otherwise clears the Gantt selection — never both at once, so Esc from
  // inside a detail view doesn't also wipe a multi-select the user still wants.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (editingTask) {
        setEditingTask(null);
      } else if (selectedIds.size > 0 || selectedId) {
        setSelectedIds(new Set());
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingTask, selectedIds, selectedId]);

  tasksRef.current = tasks;

  async function undo() {
    const entry = undoStack.at(-1);
    if (!entry || undoing) return;
    setUndoStack((s) => s.slice(0, -1));
    setUndoing(true);
    // Each step is written, then the next is worked out from what that left behind:
    // restoring the dragged task makes the cascade pull its zero-slack successors back
    // by itself, and those then need no write of their own.
    let working = tasksRef.current;
    try {
      for (let guard = 0; guard < entry.before.length + 3; guard++) {
        const step = undoSteps(entry, working)[0];
        if (!step) break;
        const seq = nextSeq();
        taskVersion.current.set(step.id, seq);
        working = working.map((t) => (t.id === step.id ? { ...t, ...step.patch } : t));
        setTasks(working);
        const updated = await api.updateTask(step.id, step.patch);
        const { cascaded, cascadeWarnings: _w, ...primary } = updated;
        const fresh = new Map([primary, ...cascaded].map((t) => [t.id, t as Task]));
        working = working.map((t) => fresh.get(t.id) ?? t);
        setTasks((prev) => applyTaskUpdate(prev, updated, seq));
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      setSyncError(e instanceof Error ? e.message : "Không hoàn tác được.");
      await refreshTasks();
    } finally {
      setUndoing(false);
    }
  }
  const undoRef = useRef(undo);
  undoRef.current = undo;

  // Ctrl/Cmd+Z undoes the last drag — but never while typing (the field's own undo
  // owns the key there) or while a dialog is open on top of the chart.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "z" || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (editingTask || creating || reviewRunId || importing || importingKbkt) return;
      if (view !== "gantt") return;
      e.preventDefault();
      void undoRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingTask, creating, reviewRunId, importing, importingKbkt, view]);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await api.sync();
      setTasks(result.tasks);
      setLastSyncedAt(result.syncedAt);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      // A transient sync failure must not replace the whole screen.
      setSyncError(e instanceof Error ? e.message : "Đồng bộ thất bại.");
    } finally {
      setSyncing(false);
    }
  }

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }


  /** Click semantics copied from a file manager: plain, Ctrl/Cmd, Shift. */
  function handleSelect(
    id: string,
    modifiers: { toggle: boolean; range: boolean },
    visibleOrder: string[]
  ) {
    if (modifiers.range && selectedId) {
      const from = visibleOrder.indexOf(selectedId);
      const to = visibleOrder.indexOf(id);
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        setSelectedIds(new Set(visibleOrder.slice(lo, hi + 1)));
        return;
      }
    }
    if (modifiers.toggle) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setSelectedId(id);
      return;
    }
    setSelectedIds(new Set([id]));
    setSelectedId(id);
  }

  /**
   * Deleting is sequential on purpose: each delete is a Jira write plus an
   * overlay cleanup that strips the issue from other tasks' predecessor lists,
   * and firing thirty of those at once would both rate-limit and interleave
   * those cleanups. Failures are collected so one undeletable issue (a
   * permission, a sub-task whose parent went first) doesn't hide the rest.
   */
  async function handleDeleteSelected() {
    // Jira deletes a parent's SUB-TASKS along with it (deleteSubtasks=true), so a
    // sub-task selected next to its own parent is already gone by the time its
    // turn comes — and would be reported as a failure. Only sub-tasks: deleting an
    // Epic leaves its stories and tasks behind, so those must still be deleted.
    const picked = new Set(selectedIds);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const ids = [...picked].filter((id) => {
      const self = byId.get(id);
      if (self?.issueType !== "Sub-task") return true;
      return !(self.wbsParentId && picked.has(self.wbsParentId));
    });
    if (ids.length === 0) return;
    const ok = window.confirm(
      ids.length === 1
        ? `Xoá ${ids[0]} khỏi Jira? Không hoàn tác được.`
        : `Xoá ${ids.length} công việc khỏi Jira? Không hoàn tác được.`
    );
    if (!ok) return;

    setDeleting(true);
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await api.deleteTask(id);
      } catch {
        failed.push(id);
      }
    }
    setSelectedIds(new Set(failed));
    setSelectedId(null);
    setDeleting(false);
    if (failed.length > 0) {
      setSyncError(`Không xoá được ${failed.length} công việc: ${failed.join(", ")}`);
    }
    await refreshTasks();
  }

  async function refreshTasks() {
    const t = await api.listTasks();
    setTasks(t);
    saveTasksCache(cacheKey, t, users);
  }

  /**
   * Runs one edit over every selected task, one after another — the same reason
   * delete is sequential: each is a Jira write (and possibly a cascade), and a
   * burst of thirty would rate-limit and interleave. A refusal on one task (a
   * status its workflow can't reach, say) is collected, not thrown, so it doesn't
   * hide the rest. `skipped` carries tasks the action doesn't apply to, so the
   * summary can say why the count is short.
   */
  async function runBulk(
    verb: string,
    ids: string[],
    edit: (id: string) => TaskUpdateInput,
    skipped: string[] = []
  ) {
    if (ids.length === 0) {
      setSyncError(`Không có công việc nào phù hợp để ${verb}.`);
      return;
    }
    const failed: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      setBulkBusy(`Đang ${verb} ${i + 1}/${ids.length}…`);
      try {
        await api.updateTask(ids[i], edit(ids[i]));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return;
        failed.push(`${ids[i]} (${e instanceof Error ? e.message : "lỗi"})`);
      }
    }
    setBulkBusy(null);
    const notes: string[] = [];
    if (failed.length > 0) notes.push(`Không ${verb} được ${failed.length} công việc: ${failed.join("; ")}.`);
    if (skipped.length > 0) notes.push(`Bỏ qua ${skipped.join(", ")} vì không áp dụng được.`);
    setSyncError(notes.length > 0 ? notes.join(" ") : null);
    await refreshTasks();
  }

  const selectedTasks = () => tasks.filter((t) => selectedIds.has(t.id));

  function handleBulkAssign(accountId: string | null) {
    const picked = selectedTasks();
    // An Epic never carries an owner (see isAssignableType); say so up front
    // rather than let the server refuse it once per Epic.
    const ok = picked.filter((t) => accountId === null || isAssignableType(t.issueType));
    const skipped = picked.filter((t) => !ok.includes(t)).map((t) => `${t.id} (Epic)`);
    return runBulk(accountId ? "gán" : "bỏ gán", ok.map((t) => t.id), () => ({ assigneeAccountId: accountId }), skipped);
  }

  function handleBulkStatus(statusName: string) {
    const picked = selectedTasks().filter((t) => t.statusName !== statusName);
    return runBulk("đổi trạng thái", picked.map((t) => t.id), () => ({ statusTransition: statusName }));
  }

  function handleBulkShift(days: number) {
    const parentIds = new Set(tasks.map((t) => t.wbsParentId).filter(Boolean));
    const picked = selectedTasks();
    // An Epic's bar is its children's span, so its own dates mean nothing to move.
    const movable = picked.filter(
      (t) => t.startDate && !(t.issueType.toLowerCase() === "epic" && parentIds.has(t.id))
    );
    const skipped = picked.filter((t) => !movable.includes(t)).map((t) => t.id);
    const starts = new Map(movable.map((t) => [t.id, t.startDate as string]));
    return runBulk("dời ngày", movable.map((t) => t.id), (id) => ({ startDate: addDays(starts.get(id)!, days) }), skipped);
  }

  /**
   * Freezes the current schedule as the baseline (or clears it) — the same write
   * as the assistant's `set_baseline`. Tasks synced from Jira start with none, so
   * without this the Gantt's baseline strips would be empty for most projects.
   * An Epic with children is skipped: its baseline is drawn as its children's
   * span, like its bar.
   */
  function handleBulkBaseline(mode: "save" | "clear") {
    const parentIds = new Set(tasks.map((t) => t.wbsParentId).filter(Boolean));
    const picked = selectedTasks();
    const rollup = (t: Task) => t.issueType.toLowerCase() === "epic" && parentIds.has(t.id);
    if (mode === "clear") {
      const target = picked.filter((t) => !rollup(t) && (t.baselineStart || t.baselineDue));
      if (target.length === 0) {
        setSyncError("Các công việc đã chọn chưa có baseline nào để xoá.");
        return;
      }
      if (!window.confirm(`Xoá baseline của ${target.length} công việc? Không hoàn tác được.`)) return;
      return runBulk("xoá baseline", target.map((t) => t.id), () => ({ baselineStart: null, baselineDue: null }));
    }
    const target = picked.filter((t) => t.startDate && !rollup(t));
    const skipped = picked.filter((t) => !target.includes(t)).map((t) => t.id);
    const overwrite = target.filter((t) => t.baselineStart || t.baselineDue).length;
    if (
      overwrite > 0 &&
      !window.confirm(`${overwrite} công việc đã có baseline sẽ bị ghi đè bằng lịch hiện tại. Tiếp tục?`)
    ) {
      return;
    }
    const byId = new Map(target.map((t) => [t.id, t]));
    return runBulk(
      "lưu baseline",
      target.map((t) => t.id),
      (id) => ({ baselineStart: byId.get(id)!.startDate, baselineDue: byId.get(id)!.dueDate }),
      skipped
    );
  }

  /**
   * PATCH /tasks/:id now returns the edited task plus every other task the
   * dependency cascade moved (`cascaded`) in the same response, so applying both
   * here is enough — no follow-up GET /tasks needed. That follow-up used to be
   * what made dragging a bar feel laggy: the optimistic value showed instantly,
   * then a moment later the full refetch would land and visibly snap the chart
   * to the server-confirmed value, even when nothing had actually changed.
   *
   * Applied task-by-task against `taskVersion` (see its comment above): a task in
   * this response — primary or cascaded — is only written if `seq` (this
   * request's own place in the global order) is still >= whatever last touched
   * that task. Skipping the ones that fail this check is what stops a slow
   * response from one drag overwriting a *different* task's own, newer drag with
   * stale cascaded data. Object identity is preserved for every task neither the
   * cascade nor this guard touched, so unrelated rows don't needlessly re-render.
   */
  function applyTaskUpdate(prev: Task[], response: TaskUpdateResponse, seq: number): Task[] {
    const { cascaded, cascadeWarnings: _cascadeWarnings, ...primary } = response;
    const byId = new Map<string, Task>();
    for (const t of [primary, ...cascaded]) {
      if ((taskVersion.current.get(t.id) ?? 0) <= seq) {
        byId.set(t.id, t);
        taskVersion.current.set(t.id, seq);
      }
    }
    return prev.map((t) => byId.get(t.id) ?? t);
  }

  /**
   * Applies the dragged values, PLUS the same FS/SS/FF/SF cascade the server would
   * compute, to local state immediately — before the network round trip even
   * starts. Otherwise the bar (and every successor it constrains) has nothing to
   * show between mouseup and the PATCH response landing, so gantt-task-react's own
   * drag preview resets to the old position and successors only catch up once the
   * whole cascade finishes writing to Jira. `applyTaskUpdate` below still applies
   * the server's authoritative response on top of this once it resolves, so a
   * detail this local pass got wrong (e.g. a concurrent edit) self-corrects. If the
   * save fails, roll back to the true server state instead of leaving the
   * optimistic (unsaved) value on screen.
   *
   * flushSync forces this update to commit and paint before control returns to
   * gantt-task-react's own mouseup handler. Without it, the setTasks below is only
   * *scheduled* — the library's handler keeps running on the old `tasks` prop, and
   * its own post-drop effects (which briefly reconcile its internal bar state back
   * toward whatever props last looked like) can paint one frame of the pre-drag
   * position before React's batched update finally flushes, which reads as the bar
   * hopping backward and then catching up a moment later.
   *
   * A save can take a few seconds (a Jira round trip), so it's easy to drag the
   * same task again — or drag a different task this one is linked to — before
   * the previous request's response lands. `seq` (see `taskVersion` above) is
   * what makes applyTaskUpdate apply only the tasks in this response that
   * nothing newer has touched since.
   */
  async function handleScheduleChange(id: string, startDate: string, durationDays: number) {
    const seq = nextSeq();
    const before = tasks;
    const cascade = computeOptimisticCascade(tasks, id, startDate, durationDays);
    flushSync(() => {
      setTasks((prev) => prev.map((t) => cascade.get(t.id) ?? t));
    });
    for (const touchedId of cascade.keys()) taskVersion.current.set(touchedId, seq);
    try {
      const updated = await api.updateTask(id, { startDate, durationDays });
      setTasks((prev) => applyTaskUpdate(prev, updated, seq));
      const was = before.find((t) => t.id === id);
      if (was && (was.startDate !== startDate || was.durationDays !== durationDays)) {
        const entry = makeEntry(`dời ${id}`, before, [id, ...cascade.keys(), ...updated.cascaded.map((t) => t.id)]);
        if (entry) setUndoStack((s) => pushEntry(s, entry));
      }
    } catch (e) {
      if ((taskVersion.current.get(id) ?? 0) > seq) return; // superseded by a newer drag
      setSyncError(e instanceof Error ? e.message : "Không thể lưu thay đổi lịch trình.");
      await refreshTasks();
    }
  }

  async function handleProgressChange(id: string, percentComplete: number) {
    const seq = nextSeq();
    const before = tasks;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, percentComplete } : t)));
    taskVersion.current.set(id, seq);
    try {
      const updated = await api.updateTask(id, { percentComplete });
      setTasks((prev) => applyTaskUpdate(prev, updated, seq));
      if (before.find((t) => t.id === id)?.percentComplete !== percentComplete) {
        const entry = makeEntry(`đổi % ${id}`, before, [id]);
        if (entry) setUndoStack((s) => pushEntry(s, entry));
      }
    } catch (e) {
      if ((taskVersion.current.get(id) ?? 0) > seq) return;
      setSyncError(e instanceof Error ? e.message : "Không thể lưu % hoàn thành.");
      await refreshTasks();
    }
  }

  /**
   * Drag-and-drop assignment from the resource tab: drop a task on a person to
   * give it to them, drop it on the unassigned strip to take it back.
   *
   * Optimistic like every other mutation here, and for the same reason — the
   * heatmap recolours from `tasks`, so waiting for Jira would leave the cell the
   * user just dropped onto showing its old load for a second or two. `users` is
   * consulted for the display name because the optimistic task has to carry one:
   * the resource rows key off assigneeAccountId but the Gantt shows the name.
   */
  async function handleAssign(taskId: string, accountId: string | null) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.assigneeAccountId === accountId) return;

    const seq = nextSeq();
    const person = accountId ? users.find((u) => u.accountId === accountId) ?? null : null;
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              assigneeAccountId: accountId,
              assigneeName: person?.displayName ?? null,
              assigneeAvatarUrl: person?.avatarUrl ?? null,
            }
          : t
      )
    );
    taskVersion.current.set(taskId, seq);
    try {
      const updated = await api.updateTask(taskId, { assigneeAccountId: accountId });
      setTasks((prev) => applyTaskUpdate(prev, updated, seq));
    } catch (e) {
      if ((taskVersion.current.get(taskId) ?? 0) > seq) return;
      setSyncError(e instanceof Error ? e.message : "Không thể gán người phụ trách.");
      await refreshTasks();
    }
  }

  /** Drag-to-connect on the Gantt chart: successorId gets predecessorId added to its list. */
  async function handleAddDependency(successorId: string, predecessorId: string, type: DependencyType) {
    const successor = tasks.find((t) => t.id === successorId);
    if (!successor) return;
    if (successor.predecessors.some((p) => p.taskId === predecessorId && p.type === type)) return;
    await writePredecessors(successorId, [
      ...successor.predecessors,
      { taskId: predecessorId, type, lagDays: 0 },
    ]);
  }

  /** Clicking an arrow and changing its type or lag. */
  async function handleEditDependency(
    successorId: string,
    predecessorId: string,
    currentType: DependencyType,
    next: { type: DependencyType; lagDays: number }
  ) {
    const successor = tasks.find((t) => t.id === successorId);
    if (!successor) return;
    await writePredecessors(
      successorId,
      successor.predecessors.map((p) =>
        p.taskId === predecessorId && p.type === currentType
          ? { taskId: predecessorId, type: next.type, lagDays: next.lagDays }
          : p
      )
    );
  }

  async function handleDeleteDependency(
    successorId: string,
    predecessorId: string,
    type: DependencyType
  ) {
    const successor = tasks.find((t) => t.id === successorId);
    if (!successor) return;
    await writePredecessors(
      successorId,
      successor.predecessors.filter((p) => !(p.taskId === predecessorId && p.type === type))
    );
  }

  /**
   * The whole predecessor list is the unit of change on the wire, so add, edit
   * and delete are all the same PATCH — and all three can move successors, so
   * they all go through the same staleness guard as a drag.
   */
  async function writePredecessors(successorId: string, predecessors: Predecessor[]) {
    const seq = nextSeq();
    try {
      const updated = await api.updateTask(successorId, { predecessors });
      setTasks((prev) => applyTaskUpdate(prev, updated, seq));
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Không thể cập nhật phụ thuộc.");
    }
  }

  if (loading) return <div className="center-message">Đang tải dữ liệu...</div>;

  if (loadError) {
    return (
      <div className="center-message error">
        {loadError.network
          ? "Không kết nối được tới máy chủ."
          : `Không tải được dữ liệu dự án ${session.project?.key ?? ""}: ${loadError.message}`}
        {loadError.network && import.meta.env.DEV && (
          <>
            <br />
            <small>Kiểm tra backend đã chạy tại http://localhost:4000 chưa.</small>
          </>
        )}
        <div className="error-actions">
          <button onClick={loadAll}>Thử lại</button>
          <button onClick={onSwitchProject}>Đổi dự án</button>
          <button onClick={onLogout}>Đăng xuất</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Toolbar
        session={session}
        view={view}
        onViewChange={setView}
        overloadedPeople={overloadedPeople}
        showResources={resourceAccess === "allowed"}
        onAddTask={() => setCreating({})}
        onSync={handleSync}
        syncing={syncing}
        refreshing={showingCache}
        lastSyncedAt={lastSyncedAt}
        onSwitchProject={onSwitchProject}
        onLogout={onLogout}
      />

      {syncError && (
        <div className="notice notice-error">
          <span>{syncError}</span>
          <button className="link-btn" onClick={() => setSyncError(null)}>
            Đóng
          </button>
        </div>
      )}

      {session.overlayEphemeral && !overlayNoticeDismissed && (
        <div className="notice notice-warn">
          <span>{OVERLAY_WARNING}</span>
          <button className="link-btn" onClick={() => setOverlayNoticeDismissed(true)}>
            Đã hiểu
          </button>
        </div>
      )}

      {/* Floats over the bottom of the chart instead of taking a row of its own: out of the
          flow, so selecting never moves the page. It used to be a strip that appeared on
          selection, which pushed the table down between the two clicks of a double-click,
          so the second landed on another row. It must not cover the toolbar either — a
          single click selects, so it is on screen most of the time. */}
      {selectedIds.size > 0 && view === "gantt" && (
        <div className="selection-bar" role="region" aria-label="Thao tác hàng loạt">
          <span className="selection-count">
            Đã chọn <strong>{selectedIds.size}</strong> công việc
          </span>
          <button onClick={() => setSelectedIds(new Set())}>Bỏ chọn</button>
          <select
            className="selection-select"
            value=""
            disabled={deleting || bulkBusy !== null}
            onChange={(e) => {
              const v = e.target.value;
              if (v) handleBulkAssign(v === "__none__" ? null : v);
            }}
            aria-label="Gán người phụ trách cho các công việc đã chọn"
          >
            <option value="">Gán cho…</option>
            <option value="__none__">— Bỏ gán —</option>
            {users.map((u) => (
              <option key={u.accountId} value={u.accountId}>
                {u.displayName}
              </option>
            ))}
          </select>
          <select
            className="selection-select"
            value=""
            disabled={deleting || bulkBusy !== null}
            onChange={(e) => {
              if (e.target.value) handleBulkStatus(e.target.value);
            }}
            aria-label="Đổi trạng thái các công việc đã chọn"
          >
            <option value="">Đổi trạng thái…</option>
            {[...new Set(tasks.map((t) => t.statusName))].sort((a, b) => a.localeCompare(b, "vi")).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="selection-select"
            value=""
            disabled={deleting || bulkBusy !== null}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "save" || v === "clear") handleBulkBaseline(v);
            }}
            aria-label="Lưu hoặc xoá baseline của các công việc đã chọn"
            title="Baseline là lịch đã chốt để so với lịch hiện tại trên Gantt"
          >
            <option value="">Baseline…</option>
            <option value="save">Lưu baseline = lịch hiện tại</option>
            <option value="clear">Xoá baseline</option>
          </select>
          <span className="selection-shift">
            <button
              disabled={deleting || bulkBusy !== null}
              onClick={() => handleBulkShift(-shiftDays)}
              aria-label="Dời lùi lại"
              title="Dời ngày bắt đầu lùi lại (giữ nguyên thời lượng)"
            >
              <Icon name="chevronLeft" size={14} />
            </button>
            <input
              type="number"
              min={1}
              max={365}
              value={shiftDays}
              onChange={(e) => setShiftDays(Math.max(1, Math.min(365, Math.floor(Number(e.target.value)) || 1)))}
              aria-label="Số ngày dời"
            />
            <span>ngày</span>
            <button
              disabled={deleting || bulkBusy !== null}
              onClick={() => handleBulkShift(shiftDays)}
              aria-label="Dời tiến tới"
              title="Dời ngày bắt đầu tiến tới (giữ nguyên thời lượng)"
            >
              <Icon name="chevronRight" size={14} />
            </button>
          </span>
          <button className="danger" onClick={handleDeleteSelected} disabled={deleting || bulkBusy !== null}>
            {deleting ? "Đang xoá..." : `Xoá ${selectedIds.size} công việc`}
          </button>
          {bulkBusy && <span className="selection-hint">{bulkBusy}</span>}
        </div>
      )}

      <div className="app-body">
        {/* Gated on access as well as on the selected view, so nothing can
            leave a refused user looking at the resource tab. The access check
            applies to that tab only — the report tab is open to everyone. */}
        {view === "gantt" || (view === "resource" && resourceAccess !== "allowed") ? (
          <GanttView
            tasks={tasks}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapse}
            selectedId={selectedId}
            onSelect={handleSelect}
            selectedIds={selectedIds}
            filter={taskFilter}
            onFilterChange={setTaskFilter}
            myAccountId={session.user.accountId}
            today={todayIso()}
            onSetCollapsed={(ids) => setCollapsed(new Set(ids))}
            onOpenEdit={setEditingTask}
            onScheduleChange={handleScheduleChange}
            onProgressChange={handleProgressChange}
            onAddDependency={handleAddDependency}
            onEditDependency={handleEditDependency}
            onDeleteDependency={handleDeleteDependency}
            versions={versions}
            jqlKeys={jqlKeys}
            jql={{ state: jqlState, onRun: runJql, onClear: () => setTaskFilter({ ...taskFilter, jql: "" }) }}
            undo={{ label: undoing ? null : (undoStack.at(-1)?.label ?? null), onUndo: () => void undo() }}
            onOpenImport={() => setImporting(true)}
            onImportKbkt={() => setImportingKbkt(true)}
          />
        ) : view === "timesheet" ? (
          <TimesheetView session={session} tasks={tasks} onOpenEdit={setEditingTask} onTasksChanged={refreshTasks} />
        ) : view === "board" ? (
          <BoardView
            session={session}
            tasks={tasks}
            users={users}
            onOpenEdit={setEditingTask}
            onTasksChanged={refreshTasks}
            incomingFilter={chatBoardFilter}
            onIncomingFilterTaken={() => setChatBoardFilter(null)}
          />
        ) : view === "resource" ? (
          <ResourceView
            tasks={tasks}
            users={users}
            pool={pool}
            poolError={poolError}
            onPoolChange={setPool}
            onAssign={handleAssign}
            onOpenEdit={setEditingTask}
            filter={taskFilter}
            onFilterChange={setTaskFilter}
            myAccountId={session.user.accountId}
            jqlKeys={jqlKeys}
          />
        ) : (
          <ProgressReportView
            tasks={tasks}
            focusReportId={focusReportId}
            canGenerate={session.staff}
            onOpenEdit={setEditingTask}
          />
        )}
      </div>

      {importing && (
        <ImportModal
          tasks={tasks}
          onClose={() => setImporting(false)}
          onImported={async () => {
            await refreshTasks();
          }}
        />
      )}

      {editingTask && (
        <TaskEditModal
          // Every field in the form starts from this task, so a different task (opened from
          // an issue key in the chat while this one is up) must be a fresh form, not the
          // old one with the new task's title in the header.
          key={editingTask.id}
          task={editingTask}
          allTasks={tasks}
          users={users}
          onClose={() => setEditingTask(null)}
          onSave={async (patch) => {
            const seq = nextSeq();
            const updated = await api.updateTask(editingTask.id, patch);
            setTasks((prev) => applyTaskUpdate(prev, updated, seq));
          }}
          onDelete={async () => {
            await api.deleteTask(editingTask.id);
            await refreshTasks();
          }}
          onWorkLogged={refreshTasks}
          myAccountId={session.user.accountId}
          onAddSubtask={(parent) => {
            setEditingTask(null);
            setCreating({ parentId: parent.id });
          }}
        />
      )}

      {/* Hidden for guests rather than disabled: /api/ai/* 403s for them, and a
          visible assistant that always errors is worse than no assistant. */}
      {session.staff && (
        <ChatDock
          // Per account AND project: a conversation belongs to the person who
          // started it, and two people sharing one browser must not continue
          // each other's chat (the server enforces the same, see ownsSession).
          storageKey={`gms.chat.${session.site.cloudId}.${session.user.accountId}.${session.project?.key ?? ""}`}
          onOpenPlan={setReviewRunId}
          onOpenReport={(id) => {
            setFocusReportId(id);
            setView("report");
          }}
          onProjectChanged={refreshTasks}
          onApplyFilter={applyChatFilter}
          knownKeys={taskKeys}
          onOpenIssue={(key) => {
            const task = tasks.find((t) => t.id === key);
            if (task) setEditingTask(task);
          }}
        />
      )}

      {reviewRunId && (
        <PlanReviewModal
          runId={reviewRunId}
          users={users}
          onClose={() => setReviewRunId(null)}
          onApplied={refreshTasks}
        />
      )}

      {importingKbkt && session.project && (
        <KbktImportModal
          projectKey={session.project.key}
          onClose={() => setImportingKbkt(false)}
          onApplied={refreshTasks}
        />
      )}

      {creating && (
        <CreateTaskModal
          tasks={tasks}
          users={users}
          initialParentId={creating.parentId}
          onClose={() => setCreating(false)}
          onCreate={async (input): Promise<BulkTaskCreateResult> => {
            // One path for one task or many: a field-by-field copy into createTask
            // once silently dropped the estimate, and the bulk route also reports
            // half-stuck fields as warnings.
            const res = await api.createTasksBulk(input);
            if (res.created.length > 0) await refreshTasks();
            // A single task that failed outright reads as a form error, so what was
            // typed stays in the form to be fixed and sent again.
            if (input.summaries.length === 1 && res.errors.length === 1) throw new Error(res.errors[0].message);
            return res;
          }}
        />
      )}
    </div>
  );
}
