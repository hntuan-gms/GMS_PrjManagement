import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ApiError, NetworkError, api, setJiraLimitedHandler } from "../api";
import { computeOptimisticCascade } from "../dependencyCascade";
import { EMPTY_FILTER, type BoardFilter } from "../boardModel";
import { EMPTY_TASK_FILTER, useTaskFilter } from "../taskFilter";
import { toBoardFilter, toTaskFilter, type ViewFilterSpec } from "../viewFilter";
import { makeEntry, pushEntry, undoSteps, type UndoEntry } from "../undo";
import { addDays, buildResourceLoad, todayIso } from "../resourceAllocation";
import { loadBigTasksCache, loadTasksCache, saveTasksCache, tasksCacheKey } from "../tasksCache";
import { dropViewCache, noteViewsStale, readViewCache, viewCacheScope, writeViewCache } from "../viewCache";
import { warmBoardAndTimesheet, warmProgress } from "../warmViews";
import { computeSla, slaIds } from "../sla";
import SavedFilterMenu from "./SavedFilterMenu";
import { toWorkCalendar } from "../workCalendar";
import type {
  BulkTaskCreateResult,
  DependencyType,
  JiraUser,
  Predecessor,
  ProjectVersion,
  ResourcePool,
  SlaSettingsResponse,
  WorkCalendarSettings,
  Session,
  Task,
  TaskUpdateInput,
  TaskUpdateResponse,
  TransitionField,
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
import ProjectSettings from "./ProjectSettings";
import type { SettingsSection } from "../settingsSections";
import { WorkCalendarContext } from "./workCalendarContext";
import { Icon } from "./Icons";
import BulkStatusMenu from "./BulkStatusMenu";
import { useDialogs } from "./dialogContext";
import { TransitionFieldsDialog } from "./TransitionFields";
import { neededFieldsFrom } from "../transitionFields";
import Toolbar from "./Toolbar";
import { LENSES, parseView, type ResourceMode, type SyncState, type WorkspaceView } from "../lenses";
import ResourceModes from "./ResourceModes";
import TimesheetView from "./TimesheetView";
import TodayView from "./TodayView";
import DraftBar from "./DraftBar";
import { addDraftEdit, compactEdits, replayDraft, startDraft, type PlanDraft } from "../planDraft";
import CommandBar, { type Command, type CreatePreview } from "./CommandBar";
import ShortcutSheet from "./ShortcutSheet";
import Toaster from "./Toaster";
import { toast } from "../toast";
import { parseQuickAdd } from "../quickAdd";
import { createSequence, isTypingTarget, overlayOpen } from "../shortcuts";
import { isOpen as layersOpen } from "../layers";
import { setDensity, setThemeChoice } from "../theme";

interface Props {
  session: Session;
  onSwitchProject: () => void;
  onLogout: () => void;
  /** A saved report to open on arrival, from a shared link. */
  initialReportId?: string | null;
  onInitialReportShown?: () => void;
}

/**
 * Where a project opens: `?view=` in the address (links, e2e), else the lens this person last used
 * in this project, else "Hôm nay" — the home page (plan §6.5). "timesheet" still works in both places and
 * means Nhân lực in its "Giờ đã ghi" mode (lenses.parseView).
 */
function initialView(storageKey: string): { view: WorkspaceView; resourceMode?: ResourceMode } {
  try {
    const fromUrl = parseView(new URLSearchParams(window.location.search).get("view"));
    if (fromUrl) return fromUrl;
    const saved = parseView(localStorage.getItem(storageKey));
    if (saved) return saved;
  } catch {
    /* private mode */
  }
  return { view: "today" };
}

function savedResourceMode(storageKey: string): ResourceMode {
  try {
    const v = localStorage.getItem(storageKey);
    if (v === "load" || v === "ts" || v === "skills") return v;
  } catch {
    /* private mode */
  }
  return "load";
}

const OVERLAY_WARNING =
  "Phụ thuộc, baseline và % hoàn thành được lưu tạm trên máy chủ và sẽ mất khi ứng dụng " +
  "được cập nhật. Ngày bắt đầu và ngày kết thúc vẫn được đồng bộ với Jira.";

export default function ProjectWorkspace({ session, onSwitchProject, onLogout, initialReportId = null, onInitialReportShown }: Props) {
  const dialogs = useDialogs();
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
  // Until when Jira said to come back, after an answer the server gave from its copy because Jira was
  // refusing for rate (X-Jira-Limited). The data on screen may lag behind Jira until then.
  const [jiraLimitedUntil, setJiraLimitedUntil] = useState<number | null>(null);
  useEffect(() => {
    setJiraLimitedHandler((seconds) => setJiraLimitedUntil(Date.now() + seconds * 1000));
    return () => setJiraLimitedHandler(null);
  }, []);
  useEffect(() => {
    if (jiraLimitedUntil === null) return;
    const left = jiraLimitedUntil - Date.now();
    if (left <= 0) {
      setJiraLimitedUntil(null);
      return;
    }
    const timer = setTimeout(() => setJiraLimitedUntil(null), left);
    return () => clearTimeout(timer);
  }, [jiraLimitedUntil]);
  // Capacity and absences. Held here rather than inside ResourceView so the
  // toolbar can badge overload without mounting the tab, and so switching tabs
  // does not refetch it.
  //
  // The last pool this account got for this project (viewCache.ts, survives F5) is the starting
  // point. Only an *allowed* answer is ever stored, so what it can do is show the tab at once to
  // someone who had access a moment ago; the server still refuses, and the fresh answer below
  // takes the tab away again if access was withdrawn. Without it the tab waited on the member
  // lookup against Jira — the slowest call on the page — and popped in last, shoving "Báo cáo"
  // aside, on every reload.
  const viewScope = viewCacheScope(session.site.cloudId, session.user.accountId, session.project?.key ?? "");
  const [cachedPool] = useState(() => readViewCache<ResourcePool>(viewScope, "resourcePool", ""));
  const [pool, setPool] = useState<ResourcePool | null>(cachedPool ?? null);
  const [poolError, setPoolError] = useState<string | null>(null);
  // Whether this user may see the resource tab at all. The server decides (only
  // project admins get an accurate member list — see requireResourceAccess), and
  // answers it through the pool fetch, so "checking" hides the tab until then
  // rather than flashing it at someone who is about to be refused.
  const [resourceAccess, setResourceAccess] = useState<"checking" | "allowed" | "denied">(cachedPool ? "allowed" : "checking");

  // One filter for the Gantt and the resource heatmap, remembered per project.
  const [taskFilter, setTaskFilter] = useTaskFilter(
    `gms.taskFilter.${session.site.cloudId}.${session.project?.key ?? ""}`
  );

  // Opened from a link to a saved report (deepLink.ts): start on the Báo cáo tab, on that report.
  const viewKey = `gms.view.${session.site.cloudId}.${session.project?.key ?? ""}`;
  const resourceModeKey = `gms.resmode.${session.site.cloudId}.${session.project?.key ?? ""}`;
  const [start] = useState(() => initialView(viewKey));
  const [view, setViewState] = useState<WorkspaceView>(() => (initialReportId ? "report" : start.view));
  // Nhân lực has three modes. Someone who may not see the member list (resourceAccess "denied") only has
  // "Giờ đã ghi": the mode in use is derived, never stored as something they cannot have.
  const [resourceModeState, setResourceModeState] = useState<ResourceMode>(() => start.resourceMode ?? savedResourceMode(resourceModeKey));
  const resourceMode: ResourceMode = resourceAccess === "denied" ? "ts" : resourceModeState;
  const setResourceMode = useCallback(
    (m: ResourceMode) => {
      setResourceModeState(m);
      try {
        localStorage.setItem(resourceModeKey, m);
      } catch {
        /* private mode */
      }
    },
    [resourceModeKey]
  );
  const viewRef = useRef(view);
  viewRef.current = view;
  // The place the settings page was opened from, for its "← Về …" (a lens or Hôm nay; never "settings" itself).
  const settingsFrom = useRef<WorkspaceView>("today");
  const setView = useCallback(
    (v: WorkspaceView) => {
      if (v === "settings" && viewRef.current !== "settings") settingsFrom.current = viewRef.current;
      setViewState(v);
      // Settings is a page you go to and come back from, not somewhere a project should reopen on.
      if (v === "settings") return;
      try {
        localStorage.setItem(viewKey, v);
      } catch {
        /* private mode */
      }
    },
    [viewKey]
  );
  // The layers this shell adds on top of the views: Ctrl K, "?", and a request to open the assistant.
  const [cmdk, setCmdk] = useState<null | "command" | "create">(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [chatRequest, setChatRequest] = useState<{ nonce: number; text?: string } | null>(null);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const draftRef = useRef<PlanDraft | null>(null);
  draftRef.current = draft;
  const [draftApplying, setDraftApplying] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ priorities: string[]; issueTypes: Array<{ name: string; subtask: boolean }> } | null>(null);
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
  const [focusReportId, setFocusReportId] = useState<string | null>(initialReportId);
  useEffect(() => {
    if (initialReportId) onInitialReportShown?.();
    // Once, on arrival: the link has done its job and must not reopen the report on a later remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Multi-select, file-list style. `selectedIds` is the real selection;
  // `selectedId` stays the single "focused" row the edit modal opens on, and
  // doubles as the anchor a Shift range measures from.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  // Progress text while a bulk action runs ("Đang gán 3/10…"); null when idle.
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  // A bulk status change Jira stopped for a missing box: ask once, then send the rest again.
  const [bulkNeeds, setBulkNeeds] = useState<{ statusName: string; ids: string[]; fields: TransitionField[]; reason?: string } | null>(null);
  const [shiftDays, setShiftDays] = useState(1);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  // The detail panel saves on its way out (TaskEditModal.requestClose). Opening another task while it
  // is up, or Esc outside it, therefore asks it to close (closeRequest) instead of unmounting it —
  // and the task waiting to open (pendingOpen) takes its place once it has.
  const [pendingOpen, setPendingOpen] = useState<Task | null>(null);
  const [closeRequest, setCloseRequest] = useState(0);
  const openTask = useCallback(
    (t: Task) => {
      if (editingTask && editingTask.id !== t.id) {
        setPendingOpen(t);
        setCloseRequest((n) => n + 1);
      } else setEditingTask(t);
    },
    [editingTask]
  );
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

  // The tasks this workspace last took from a full read. Any other change to `tasks` is the user's edit, and
  // what the tabs fetched ahead then describes the old plan (viewCache.noteViewsStale).
  const freshApplied = useRef<Task[] | null>(null);
  const firstTasks = useRef(tasks);
  useEffect(() => {
    if (tasks === firstTasks.current || tasks === freshApplied.current) return;
    noteViewsStale(viewScope);
  }, [tasks, viewScope]);

  async function loadAll() {
    // With a cached copy on screen nothing blocks: this only swaps the fresh data in.
    if (!cached) setLoading(true);
    setLoadError(null);
    const seqAtStart = seqCounter.current;
    // Both asked for at once, but the plan is shown as soon as the TASKS are in. The member list can take
    // seconds on a cold server (one Jira request per project role and group) and the Gantt does not need it
    // to draw; waiting for the slower of the two made a 15-task project load as slowly as a 4000-task one.
    const usersReq = api.listUsers();
    usersReq.catch(() => {}); // awaited below; this only keeps an early failure from being "unhandled"
    // The Báo cáo tab's numbers are computed from the same read of Jira as the tasks, which the server shares
    // between callers that ask together — so asking now costs nothing extra, and the tab opens already filled.
    void warmProgress(viewScope);
    // A project too big for localStorage keeps its last copy in IndexedDB: read beside the network, it shows
    // the plan at once if it wins (and the sync button turns until the fresh copy lands), and is dropped if
    // the network was faster or something was edited in the meantime.
    let fresh = false;
    let bigShown = false;
    if (!cached) {
      void loadBigTasksCache(cacheKey).then((big) => {
        if (!big || fresh || seqCounter.current !== seqAtStart) return;
        firstTasks.current = big.tasks; // a saved copy, not an edit: it must not mark the warmed tabs stale
        setTasks(big.tasks);
        setUsers(big.users);
        setLoading(false);
        setShowingCache(true);
        bigShown = true;
      });
    }
    let shown = false;
    try {
      const t = await api.listTasks();
      fresh = true;
      // A drag or edit made while the old copy was showing has its own refresh coming;
      // this response was asked for before it and would put the old schedule back.
      if (seqCounter.current === seqAtStart) {
        freshApplied.current = t;
        setTasks(t);
        // The plan is on screen: now the other tabs' own reads (board, this week's timesheet) can start.
        void warmBoardAndTimesheet(viewScope, session.project?.key ?? "");
      }
      shown = true;
      setLoading(false);
      setShowingCache(false);
      const u = await usersReq;
      setUsers(u);
      if (seqCounter.current === seqAtStart) saveTasksCache(cacheKey, t, u);
    } catch (e) {
      // The shell is already swapping in the login screen; a red banner here would
      // just flash during the transition.
      if (e instanceof ApiError && e.status === 401) return;
      const message = e instanceof Error ? e.message : "Không tải được dữ liệu dự án.";
      if (shown) {
        // The plan itself is fresh and on screen; only the member list is missing.
        setSyncError(`Chưa tải được danh sách thành viên (${message}).`);
      } else if (cached || bigShown) {
        // Keep working on what is shown, but say it may be out of date.
        setSyncError(`Chưa đọc lại được Jira (${message}). Đang hiện bản lưu trước.`);
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
        writeViewCache(viewScope, "resourcePool", "", p);
      })
      .catch((e: Error) => {
        if (!alive) return;
        if (e instanceof ApiError && e.code === "RESOURCES_ADMIN_ONLY") {
          setResourceAccess("denied");
          setPool(null);
          dropViewCache(viewScope, "resourcePool", "");
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
    // The scope is a string fixed for this project (the workspace is keyed by it), so this still runs once.
  }, [viewScope]);

  // The SLA policy, read once like the resource pool and kept in the view cache so the
  // column and chips paint straight away after F5. Readable by everyone; a failure just
  // means no SLA is shown, never a broken workspace.
  const [sla, setSla] = useState<SlaSettingsResponse | null>(() => readViewCache<SlaSettingsResponse>(viewScope, "sla", "") ?? null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("calendar");
  useEffect(() => {
    let alive = true;
    api.getSlaSettings().then(
      (r) => {
        if (!alive) return;
        setSla(r);
        writeViewCache(viewScope, "sla", "", r);
      },
      () => undefined
    );
    return () => {
      alive = false;
    };
  }, [viewScope]);
  // SLA states move with the clock, not only with the tasks; once a minute is enough.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const slaById = useMemo(() => computeSla(tasks, sla?.settings ?? null, nowMs), [tasks, sla, nowMs]);
  // The project's working calendar lives in the same row as the SLA policy (and is read by everyone the same
  // way). Until it arrives, Monday–Friday: exactly what every view assumed before there was a calendar.
  const workCalendar = useMemo(() => toWorkCalendar(sla?.settings ?? null), [sla]);
  const slaView = useMemo(
    () => (sla?.settings.enabled ? { settings: sla.settings, byId: slaById, nowMs } : null),
    [sla, slaById, nowMs]
  );

  const taskKeys = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks]);

  // The toolbar's overload count: who is over capacity in the next two weeks. Counting the whole project
  // made the badge red on any large one, which says nothing; this is what can still be acted on.
  const overloadedPeople = useMemo(() => {
    const today = todayIso();
    const span = { from: today, to: addDays(today, 13) };
    return buildResourceLoad({
      tasks,
      users,
      profiles: pool?.profiles ?? [],
      absences: pool?.absences ?? [],
      defaultCapacityHours: pool?.defaultCapacityHours,
      from: span.from,
      to: span.to,
      calendar: workCalendar,
    }).overloadedPeople;
  }, [tasks, users, pool, workCalendar]);

  // Esc backs out one layer at a time: closes the edit modal if one is open
  // (matching its own Esc-to-close, if it has one, but this is the fallback),
  // otherwise clears the Gantt selection — never both at once, so Esc from
  // inside a detail view doesn't also wipe a multi-select the user still wants.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (editingTask) {
        setCloseRequest((n) => n + 1);
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
    const ok = await dialogs.confirm({
      title: "Xoá khỏi Jira",
      message: ids.length === 1 ? `Xoá ${ids[0]} khỏi Jira? Không hoàn tác được.` : `Xoá ${ids.length} việc khỏi Jira? Không hoàn tác được.`,
      tone: "danger",
    });
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
      setSyncError(`Không xoá được ${failed.length} việc: ${failed.join(", ")}`);
    }
    await refreshTasks();
  }

  async function refreshTasks() {
    const t = await api.listTasks();
    saveTasksCache(cacheKey, t, users);
    const d = draftRef.current;
    if (d) {
      // Drafting: keep the moves, replay them on the fresh plan (planDraft.replayDraft).
      const r = replayDraft(d, t);
      setDraft(r.draft);
      setTasks(r.tasks);
      return;
    }
    setTasks(t);
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
    skipped: string[] = [],
    /** Takes a failure the caller can fix itself; true means handled, so it is not reported as one. */
    takeover?: (id: string, err: unknown) => boolean
  ) {
    if (ids.length === 0) {
      setSyncError(`Không có việc nào phù hợp để ${verb}.`);
      return;
    }
    const failed: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      setBulkBusy(`Đang ${verb} ${i + 1}/${ids.length}…`);
      try {
        await api.updateTask(ids[i], edit(ids[i]));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return;
        if (takeover?.(ids[i], e)) continue;
        failed.push(`${ids[i]} (${e instanceof Error ? e.message : "lỗi"})`);
      }
    }
    setBulkBusy(null);
    const notes: string[] = [];
    if (failed.length > 0) notes.push(`Không ${verb} được ${failed.length} việc: ${failed.join("; ")}.`);
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

  /**
   * `ids` and `values` come from the status menu, which already asked each workflow what it
   * allows and for what it needs. A box only a validator demands is discovered here instead:
   * the first refusal that names fields opens a dialog, and the ones still waiting are sent
   * again with the answer.
   */
  async function handleBulkStatus(statusName: string, ids: string[], values: Record<string, string> = {}) {
    let needed: { fields: TransitionField[]; reason?: string } | null = null;
    const waiting: string[] = [];
    await runBulk(
      "đổi trạng thái",
      ids,
      () => ({ statusTransition: statusName, ...(Object.keys(values).length > 0 ? { transitionFields: values } : {}) }),
      [],
      (id, err) => {
        const n = neededFieldsFrom(err);
        if (!n) return false;
        needed ??= n;
        waiting.push(id);
        return true;
      }
    );
    if (needed && waiting.length > 0) {
      const n = needed as { fields: TransitionField[]; reason?: string };
      setBulkNeeds({ statusName, ids: waiting, fields: n.fields, reason: n.reason });
    }
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
  async function handleBulkBaseline(mode: "save" | "clear") {
    const parentIds = new Set(tasks.map((t) => t.wbsParentId).filter(Boolean));
    const picked = selectedTasks();
    const rollup = (t: Task) => t.issueType.toLowerCase() === "epic" && parentIds.has(t.id);
    if (mode === "clear") {
      const target = picked.filter((t) => !rollup(t) && (t.baselineStart || t.baselineDue));
      if (target.length === 0) {
        setSyncError("Các việc đã chọn chưa có baseline nào để xoá.");
        return;
      }
      if (!(await dialogs.confirm({ message: `Xoá baseline của ${target.length} việc? Không hoàn tác được.`, tone: "danger" }))) return;
      return runBulk("xoá baseline", target.map((t) => t.id), () => ({ baselineStart: null, baselineDue: null }));
    }
    const target = picked.filter((t) => t.startDate && !rollup(t));
    const skipped = picked.filter((t) => !target.includes(t)).map((t) => t.id);
    const overwrite = target.filter((t) => t.baselineStart || t.baselineDue).length;
    if (
      overwrite > 0 &&
      !(await dialogs.confirm({ message: `${overwrite} việc đã có baseline sẽ bị ghi đè bằng lịch hiện tại. Tiếp tục?`, confirmLabel: "Ghi đè" }))
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
    if (draft) {
      // Bản nháp: nothing goes to Jira; the move and its cascade are only shown (planDraft.ts).
      const r = addDraftEdit(draft, tasks, { id, startDate, durationDays });
      flushSync(() => {
        setDraft(r.draft);
        setTasks(r.tasks);
      });
      return;
    }
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
  /** A status picked on the plan's cell: moved at once; a move that needs fields opens the panel to ask. */
  async function handleTransition(task: Task, transitionId: string, toStatusName: string) {
    try {
      await updateOne(task.id, { statusTransition: transitionId });
      toast(`Đã chuyển ${task.id} sang ${toStatusName}.`, { tone: "success" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      if (neededFieldsFrom(e)) {
        toast(`Chuyển ${task.id} sang ${toStatusName} cần nhập thêm thông tin.`, { tone: "info" });
        openTask(task);
        return;
      }
      toast(e instanceof Error ? e.message : `Không chuyển được ${task.id}.`, { tone: "error" });
    }
  }

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

  /* ---- Bản nháp kế hoạch (plan §6.1.6) ---- */
  async function toggleDraft() {
    if (draft) return discardDraft();
    setDraft(startDraft(tasks));
    if (view !== "gantt") setView("gantt");
  }
  async function discardDraft() {
    if (!draft) return;
    if (draft.edits.length > 0) {
      const ok = await dialogs.confirm({
        title: "Bỏ bản nháp?",
        message: "Các thay đổi trong bản nháp chưa được ghi lên Jira và sẽ mất.",
        confirmLabel: "Bỏ nháp",
        tone: "danger",
      });
      if (!ok) return;
    }
    setTasks(draft.base);
    setDraft(null);
  }
  async function applyDraft() {
    if (!draft) return;
    const edits = compactEdits(draft.edits);
    const failed: string[] = [];
    for (let i = 0; i < edits.length; i++) {
      const e = edits[i];
      setDraftApplying(`${i + 1}/${edits.length}`);
      try {
        await api.updateTask(e.id, { startDate: e.startDate, durationDays: e.durationDays });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return;
        failed.push(`${e.id}: ${err instanceof Error ? err.message : "lỗi"}`);
      }
    }
    setDraftApplying(null);
    // Cleared before the re-read, or refreshTasks would see the draft and replay it onto Jira's answer.
    draftRef.current = null;
    setDraft(null);
    await refreshTasks();
    if (failed.length === 0) toast(`Đã áp dụng bản nháp: ${edits.length} việc được dời trên Jira.`, { tone: "success" });
    else toast(`Áp dụng xong, ${failed.length} việc không ghi được: ${failed.join("; ")}`, { tone: "error" });
  }

  /** One field-level write with the usual staleness guard (the detail window's save does the same). */
  async function updateOne(id: string, patch: TaskUpdateInput) {
    const seq = nextSeq();
    const updated = await api.updateTask(id, patch);
    setTasks((prev) => applyTaskUpdate(prev, updated, seq));
  }

  // The lists quick-add resolves words against; fetched once, the first time the command bar opens.
  useEffect(() => {
    if (!cmdk || meta) return;
    Promise.all([api.listPriorities().catch(() => [] as string[]), api.listIssueTypes().catch(() => [])]).then(([priorities, issueTypes]) =>
      setMeta({ priorities, issueTypes })
    );
  }, [cmdk, meta]);

  const quickCtx = () => ({
    today: todayIso(),
    users,
    meAccountId: session.user.accountId,
    tasks,
    issueTypes: meta?.issueTypes.map((t) => t.name) ?? [],
    priorities: meta?.priorities ?? [],
    projectKey: session.project?.key ?? "",
  });

  const previewCreate = (text: string): CreatePreview | null => {
    if (!text.trim()) return null;
    const r = parseQuickAdd(text, quickCtx());
    return {
      title: r.title,
      line: r.preview,
      chips: r.tokens.map((t) => ({ label: t.label, kind: t.kind, warn: !!(t.ambiguous || t.unresolved) })),
    };
  };

  /** C / Ctrl K / "+ Thêm việc": one sentence → one Jira issue, then its links (plan §6.4). */
  async function quickCreate(text: string, open: boolean) {
    const r = parseQuickAdd(text, quickCtx());
    const f = r.fields;
    if (!r.title.trim()) {
      toast("Chưa có tên việc.", { tone: "error" });
      return;
    }
    const parent = f.parentId ? tasks.find((t) => t.id === f.parentId) : undefined;
    const subtaskType = meta?.issueTypes.find((t) => t.subtask)?.name ?? "Sub-task";
    // Under a Story or Task, Jira only takes a sub-task; under an Epic (or nothing) a Task.
    const issueType = (f.issueType ?? (parent && parent.issueType !== "Epic" ? subtaskType : "Task")) as Task["issueType"];
    try {
      const res = await api.createTasksBulk({
        summaries: [r.title],
        issueType,
        wbsParentId: f.parentId ?? null,
        startDate: f.startDate ?? null,
        durationDays: f.durationDays ?? (f.startDate ? 1 : undefined),
        assigneeAccountId: f.assigneeAccountId ?? null,
        estimateHours: f.estimateHours ?? null,
        priority: f.priority,
        labels: f.labels,
      });
      if (res.errors.length > 0 || res.created.length === 0) throw new Error(res.errors[0]?.message ?? "Jira không tạo được việc.");
      const created = res.created[0];
      if (f.predecessors?.length) await api.updateTask(created.id, { predecessors: f.predecessors });
      for (const key of f.successorOf ?? []) {
        const succ = tasks.find((t) => t.id === key);
        if (succ) await api.updateTask(key, { predecessors: [...succ.predecessors, { taskId: created.id, type: "FS", lagDays: 0 }] });
      }
      await refreshTasks();
      for (const w of res.warnings ?? []) toast(w, { tone: "info" });
      toast(`Đã tạo ${created.id} · ${r.title}`, {
        tone: "success",
        action: { label: "Mở", run: () => setEditingTask(tasksRef.current.find((t) => t.id === created.id) ?? created) },
      });
      if (open) {
        setCmdk(null);
        setEditingTask(created);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toast(e instanceof Error ? e.message : "Không tạo được việc.", { tone: "error" });
    }
  }

  const [focusPerson, setFocusPerson] = useState<{ accountId: string; nonce: number } | null>(null);
  const go = (v: WorkspaceView) => setView(v);
  /** Cài đặt dự án, on a section when one is named (the Ctrl K commands, SLA's link to the calendar). */
  const openSettings = (section?: SettingsSection) => {
    if (section) setSettingsSection(section);
    setView("settings");
  };
  /** The calendar is a slice of the SLA row: fold it into the copy every view reads, so the heatmap,
   *  timesheet, sprint header and SLA chips all move on this render. What the tabs fetched ahead was
   *  computed on the old calendar (sprint capacity), so it is stale now. */
  const handleCalendarSaved = (calendar: Required<WorkCalendarSettings>) => {
    noteViewsStale(viewScope);
    if (sla) {
      const next = { ...sla, settings: { ...sla.settings, ...calendar } };
      setSla(next);
      writeViewCache(viewScope, "sla", "", next);
    } else {
      api.getSlaSettings().then(
        (r) => {
          setSla(r);
          writeViewCache(viewScope, "sla", "", r);
        },
        () => undefined
      );
    }
  };
  const handleSlaSaved = (r: SlaSettingsResponse) => {
    setSla(r);
    writeViewCache(viewScope, "sla", "", r);
  };
  /** Nhân lực in a given mode (G T = "Giờ đã ghi"). */
  const goResource = (m: ResourceMode) => {
    setResourceMode(m);
    setView("resource");
  };

  function toggleMine() {
    const people = new Set(taskFilter.people);
    if (people.has(session.user.accountId)) people.delete(session.user.accountId);
    else people.add(session.user.accountId);
    setTaskFilter({ ...taskFilter, people });
  }

  const commands: Command[] = [
    { id: "create", label: "Tạo việc", group: "Thường dùng", icon: "plus", keys: "C", aliases: "task moi them", run: () => setTimeout(() => setCmdk("create"), 0) },
    {
      id: "create-form",
      label: "Tạo việc bằng biểu mẫu đầy đủ…",
      group: "Thường dùng",
      icon: "edit",
      aliases: "bieu mau form nhieu viec dinh kem",
      run: () => setCreating({}),
    },
    { id: "go-today", label: "Hôm nay", group: "Thường dùng", icon: "sun", keys: "G H", run: () => go("today") },
    ...LENSES.map<Command>((l) => ({
      id: `lens-${l.id}`,
      label: l.label,
      group: "Đi tới",
      icon: l.id === "gantt" ? "plan" : l.id === "board" ? "board" : l.id === "resource" ? "users" : "pulse",
      keys: l.key,
      aliases: l.id === "gantt" ? "gantt wbs" : l.id === "report" ? "bao cao" : l.id === "resource" ? "nguon luc" : "kanban sprint",
      run: () => go(l.id),
    })),
    { id: "go-time", label: "Nhân lực: giờ đã ghi", group: "Đi tới", icon: "clock", keys: "G T", aliases: "gio lam cham cong timesheet", run: () => goResource("ts") },
    ...(selectedIds.size > 0
      ? [
          {
            id: "assign-me",
            label: `Giao ${selectedIds.size} việc đã chọn cho tôi`,
            group: "Việc đã chọn",
            icon: "user",
            keys: "I",
            run: () => handleBulkAssign(session.user.accountId),
          } as Command,
          ...users.map<Command>((u) => ({
            id: `assign-${u.accountId}`,
            label: `Giao ${selectedIds.size} việc đã chọn cho ${u.displayName}`,
            group: "Việc đã chọn",
            icon: "user",
            aliases: "gan",
            run: () => handleBulkAssign(u.accountId),
          })),
          { id: "baseline", label: "Lưu kế hoạch gốc (baseline) cho việc đã chọn", group: "Việc đã chọn", icon: "layers", run: () => void handleBulkBaseline("save") } as Command,
          { id: "delete", label: `Xoá ${selectedIds.size} việc đã chọn…`, group: "Việc đã chọn", icon: "trash", keys: "Delete", run: () => void handleDeleteSelected() } as Command,
        ]
      : []),
    {
      id: "draft",
      label: draft ? "Bỏ bản nháp kế hoạch" : "Bật bản nháp kế hoạch (thử lịch, chưa ghi Jira)",
      group: "Kế hoạch",
      icon: "layers",
      keys: "Shift D",
      aliases: "nhap thu draft what if",
      run: () => void toggleDraft(),
    },
    ...(draft && draft.edits.length > 0
      ? [{ id: "draft-apply", label: "Áp dụng bản nháp lên Jira", group: "Kế hoạch", icon: "check", run: () => void applyDraft() } as Command]
      : []),
    { id: "mine", label: "Lọc: việc của tôi", group: "Lọc", icon: "user", keys: "M", run: () => toggleMine() },
    { id: "overdue", label: "Lọc: quá hạn", group: "Lọc", icon: "alert", keys: "O", run: () => setTaskFilter({ ...taskFilter, onlyOverdue: !taskFilter.onlyOverdue }) },
    { id: "clear", label: "Xoá mọi lọc", group: "Lọc", icon: "x", keys: "Shift F", run: () => setTaskFilter(EMPTY_TASK_FILTER) },
    { id: "sync", label: "Đọc lại từ Jira", group: "Dự án", icon: "sync", keys: "Shift R", aliases: "dong bo refresh", run: () => void handleSync() },
    { id: "projects", label: "Chuyển dự án…", group: "Dự án", icon: "switch", keys: "Ctrl P", run: onSwitchProject },
    { id: "import", label: "Nhập việc từ CSV / Excel…", group: "Dự án", icon: "upload", run: () => setImporting(true) },
    { id: "kbkt", label: "Nhập KBKT (test case)…", group: "Dự án", icon: "upload", run: () => setImportingKbkt(true) },
    { id: "sla", label: "Cài đặt SLA…", group: "Dự án", icon: "clock", run: () => openSettings("sla") },
    { id: "calendar", label: "Lịch làm việc & ngày lễ…", group: "Dự án", icon: "calendar", run: () => openSettings("calendar") },
    ...(session.staff
      ? [{ id: "assistant", label: "Mở trợ lý", group: "Trợ lý", icon: "chat", aliases: "ai chat hoi", run: () => setChatRequest({ nonce: Date.now() }) } as Command]
      : []),
    { id: "theme-light", label: "Giao diện sáng", group: "Giao diện", icon: "sun", aliases: "light", run: () => setThemeChoice("light") },
    { id: "theme-dark", label: "Giao diện tối", group: "Giao diện", icon: "moon", aliases: "dark", run: () => setThemeChoice("dark") },
    { id: "theme-system", label: "Giao diện theo máy", group: "Giao diện", icon: "monitor", aliases: "system", run: () => setThemeChoice("system") },
    { id: "density-compact", label: "Mật độ dòng: gọn", group: "Giao diện", aliases: "compact", run: () => setDensity("compact") },
    { id: "density-default", label: "Mật độ dòng: vừa", group: "Giao diện", run: () => setDensity("default") },
    { id: "density-comfortable", label: "Mật độ dòng: thoáng", group: "Giao diện", aliases: "comfortable", run: () => setDensity("comfortable") },
    { id: "help", label: "Bảng phím tắt", group: "Trợ giúp", icon: "keyboard", keys: "?", run: () => setShortcutsOpen(true) },
    { id: "logout", label: "Đăng xuất", group: "Tài khoản", icon: "logout", run: onLogout },
  ];

  // The keyboard layer (plan §7). Letter keys never fire while typing or with any layer open.
  const sequence = useMemo(() => createSequence({ "g h": "go-today", "g t": "go-time", "g s": "go-settings" }), []);
  const toggleOverdue = () => setTaskFilter({ ...taskFilter, onlyOverdue: !taskFilter.onlyOverdue });
  const keyState = useRef({ go, goResource, openSettings, toggleMine, toggleOverdue, handleSync, handleBulkAssign, handleDeleteSelected, toggleDraft });
  keyState.current = { go, goResource, openSettings, toggleMine, toggleOverdue, handleSync, handleBulkAssign, handleDeleteSelected, toggleDraft };
  const blockers = !!(editingTask || creating || reviewRunId || importing || importingKbkt || cmdk || shortcutsOpen);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const k = e.key;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && k.toLowerCase() === "k") {
        e.preventDefault();
        // Behind a picker or dialog the command bar would open under it; the open panel itself does not count.
        if (layersOpen("cmdk", "task-detail")) return;
        setCmdk((c) => (c ? null : "command"));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && k.toLowerCase() === "p") {
        e.preventDefault();
        if (layersOpen("task-detail")) return;
        onSwitchProject();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (blockers || isTypingTarget(e.target) || overlayOpen()) return;
      const ks = keyState.current;
      const seqHit = sequence.feed(k);
      if (seqHit === "pending") {
        e.preventDefault();
        return;
      }
      if (seqHit === "go-today") return ks.go("today");
      if (seqHit === "go-time") return ks.goResource("ts");
      if (seqHit === "go-settings") return ks.openSettings();
      if (k === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (k === "c") {
        e.preventDefault();
        setCmdk("create");
      } else if (k >= "1" && k <= "4" && k.length === 1) {
        const lens = LENSES[Number(k) - 1];
        if (lens) ks.go(lens.id);
      } else if (k === "R" && e.shiftKey) {
        void ks.handleSync();
      } else if (k === "m") {
        ks.toggleMine();
      } else if (k === "o") {
        ks.toggleOverdue();
      } else if (k === "D" && e.shiftKey) {
        void ks.toggleDraft();
      } else if (k === "F" && e.shiftKey) {
        setTaskFilter(EMPTY_TASK_FILTER);
      } else if (k === "t" && view === "gantt") {
        window.dispatchEvent(new Event("gms:gantt-today"));
      } else if (k === "i" && selectedIds.size > 0) {
        ks.handleBulkAssign(session.user.accountId);
      } else if (k === "Delete" && selectedIds.size > 0) {
        void ks.handleDeleteSelected();
      }
    }
    // Capture phase: a focused Gantt bar (just dragged or clicked) stops every keydown it gets, so Shift D
    // and the rest never reached `window` while the bar still had focus.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [blockers, sequence, onSwitchProject, view, selectedIds, session.user.accountId, setTaskFilter]);

  // A failed write used to be a red strip pushing the plan down; it is a toast now (plan §5.6).
  useEffect(() => {
    if (!syncError) return;
    toast(syncError, { tone: "error" });
    setSyncError(null);
  }, [syncError]);

  const syncState: SyncState =
    jiraLimitedUntil !== null
      ? { kind: "limited", minutes: Math.max(1, Math.ceil((jiraLimitedUntil - Date.now()) / 60_000)) }
      : syncing || showingCache || loading
        ? { kind: "reading" }
        : { kind: "ok", at: lastSyncedAt };

  const toolbar = (
      <Toolbar
        session={session}
        view={view}
        onViewChange={setView}
        overloadedPeople={overloadedPeople}
        onAddTask={() => setCmdk("create")}
        onSync={handleSync}
        sync={syncState}
        onOpenCommand={() => setCmdk("command")}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onOpenAssistant={session.staff ? () => setChatRequest({ nonce: Date.now() }) : undefined}
        onSwitchProject={onSwitchProject}
        onOpenSettings={() => openSettings()}
        onLogout={onLogout}
      />
  );

  // First load with nothing saved: the header is already there and its sync button turns, instead of a
  // bare "loading" page that gave no sign anything was happening.
  if (loading) {
    return (
      <div className="app">
        {toolbar}
        <div className="center-message">Đang tải dữ liệu...</div>
      </div>
    );
  }

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
    <WorkCalendarContext.Provider value={workCalendar}>
      <div className="app">
        {toolbar}

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
            single click selects, so it is on screen most of the time. Hidden while the detail
            panel is open: that panel is the task being worked on, and the bar squeezed behind it
            wrapped to three rows. */}
        {selectedIds.size > 0 && view === "gantt" && !editingTask && (
          <div className="selection-bar" role="region" aria-label="Thao tác hàng loạt">
            <span className="selection-count">
              Đã chọn <strong>{selectedIds.size}</strong> việc
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
              aria-label="Gán người phụ trách cho các việc đã chọn"
            >
              <option value="">Gán cho…</option>
              <option value="__none__">Bỏ gán</option>
              {users.map((u) => (
                <option key={u.accountId} value={u.accountId}>
                  {u.displayName}
                </option>
              ))}
            </select>
            <BulkStatusMenu
              tasks={selectedTasks()}
              disabled={deleting || bulkBusy !== null}
              onApply={(statusName, ids, values) => void handleBulkStatus(statusName, ids, values)}
            />
            <select
              className="selection-select"
              value=""
              disabled={deleting || bulkBusy !== null}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "save" || v === "clear") handleBulkBaseline(v);
              }}
              aria-label="Lưu hoặc xoá baseline của các việc đã chọn"
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
              {deleting ? "Đang xoá..." : `Xoá ${selectedIds.size} việc`}
            </button>
            {bulkBusy && <span className="selection-hint">{bulkBusy}</span>}
          </div>
        )}

        {bulkNeeds && (
          <TransitionFieldsDialog
            title={`Chuyển ${bulkNeeds.ids.length} việc sang “${bulkNeeds.statusName}”`}
            message={bulkNeeds.reason ?? "Quy trình Jira yêu cầu nhập thông tin này trước khi chuyển."}
            fields={bulkNeeds.fields}
            applyLabel="Chuyển"
            onCancel={() => setBulkNeeds(null)}
            onApply={(values) => {
              const { statusName, ids } = bulkNeeds;
              setBulkNeeds(null);
              void handleBulkStatus(statusName, ids, values);
            }}
          />
        )}

        {draft && (
          <DraftBar
            draft={draft}
            tasks={tasks}
            applying={draftApplying}
            onApply={() => void applyDraft()}
            onDiscard={() => void discardDraft()}
            onOpenTask={(id) => {
              const t = tasks.find((x) => x.id === id);
              if (t) openTask(t);
            }}
          />
        )}

        <div className="app-body">
          {/* Gated on access as well as on the selected view, so nothing can
              leave a refused user looking at the resource tab. The access check
              applies to that tab only — the report tab is open to everyone. */}
          {view === "today" ? (
            <TodayView
              session={session}
              tasks={tasks}
              today={todayIso()}
              capacityHours={
                pool?.profiles.find((p) => p.accountId === session.user.accountId)?.capacityHoursPerDay ?? pool?.defaultCapacityHours ?? 8
              }
              onOpenTask={openTask}
              onUpdateTask={updateOne}
              onQuickCreate={(text) => quickCreate(text, false)}
              onWorkLogged={refreshTasks}
            />
          ) : view === "gantt" ? (
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
              onOpenEdit={openTask}
              onScheduleChange={handleScheduleChange}
              onProgressChange={handleProgressChange}
              onAddDependency={handleAddDependency}
              onEditDependency={handleEditDependency}
              onDeleteDependency={handleDeleteDependency}
              versions={versions}
              jqlKeys={jqlKeys}
              sla={slaView}
              jql={{ state: jqlState, onRun: runJql, onClear: () => setTaskFilter({ ...taskFilter, jql: "" }) }}
              undo={{ label: undoing ? null : (undoStack.at(-1)?.label ?? null), onUndo: () => void undo() }}
              onOpenImport={() => setImporting(true)}
              onImportKbkt={() => setImportingKbkt(true)}
              onQuickCreate={(text) => quickCreate(text, false)}
              users={users}
              onAssign={(id, acc) => void handleAssign(id, acc)}
              onUpdate={async (id, patch) => {
                await updateOne(id, patch);
                // A new predecessor can move other tasks (the cascade), which only a re-read shows.
                if (patch.predecessors) void refreshTasks();
              }}
              onTransition={(t, id, name) => void handleTransition(t, id, name)}
              draftBase={draft?.base ?? null}
            />
          ) : view === "board" ? (
            <BoardView
              session={session}
              tasks={tasks}
              users={users}
              onOpenEdit={openTask}
              onTasksChanged={refreshTasks}
              incomingFilter={chatBoardFilter}
              onIncomingFilterTaken={() => setChatBoardFilter(null)}
              taskFilter={taskFilter}
              onFilterChange={setTaskFilter}
              filterContext={{ jqlKeys, slaBreached: slaView ? slaIds(slaView.byId, "breached") : null }}
              filterLeading={<SavedFilterMenu filter={taskFilter} onApply={setTaskFilter} myAccountId={session.user.accountId} />}
              resourceData={pool ? { profiles: pool.profiles, absences: pool.absences } : undefined}
              refreshing={showingCache}
            />
          ) : view === "resource" && resourceMode === "ts" ? (
            <TimesheetView
              session={session}
              tasks={tasks}
              onOpenEdit={openTask}
              onTasksChanged={refreshTasks}
              modeSwitch={<ResourceModes mode="ts" onChange={setResourceMode} canPlan={resourceAccess === "allowed"} />}
            />
          ) : view === "resource" ? (
            <ResourceView
              focusPerson={focusPerson}
              mode={resourceMode === "skills" ? "skills" : "load"}
              onModeChange={setResourceMode}
              tasks={tasks}
              users={users}
              pool={pool}
              poolError={poolError}
              onPoolChange={setPool}
              onAssign={handleAssign}
              onOpenEdit={openTask}
              filter={taskFilter}
              onFilterChange={setTaskFilter}
              myAccountId={session.user.accountId}
              jqlKeys={jqlKeys}
            />
          ) : view === "settings" ? (
            <ProjectSettings
              projectKey={session.project?.key ?? ""}
              section={settingsSection}
              onSectionChange={setSettingsSection}
              sla={sla}
              onSlaSaved={handleSlaSaved}
              onCalendarSaved={handleCalendarSaved}
              backLabel={
                settingsFrom.current === "today"
                  ? "Hôm nay"
                  : (LENSES.find((l) => l.id === settingsFrom.current)?.label ?? "Hôm nay")
              }
              onBack={() => go(settingsFrom.current === "settings" ? "today" : settingsFrom.current)}
            />
          ) : (
            <ProgressReportView
              projectKey={session.project?.key ?? ""}
              tasks={tasks}
              focusReportId={focusReportId}
              canGenerate={session.staff}
              onOpenEdit={openTask}
              cacheScope={viewCacheScope(session.site.cloudId, session.user.accountId, session.project?.key ?? "")}
              refreshing={showingCache}
              sla={slaView}
              users={users}
              onAssign={(taskId, accountId) => updateOne(taskId, { assigneeAccountId: accountId })}
              onOpenResources={() => go("resource")}
              onOpenPersonLoad={(accountId) => {
                setFocusPerson({ accountId, nonce: Date.now() });
                goResource("load");
              }}
              taskFilter={taskFilter}
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
            sla={slaView ? { result: slaView.byId.get(editingTask.id) ?? null, settings: slaView.settings, nowMs: slaView.nowMs } : null}
            onClose={() => {
              setEditingTask(pendingOpen);
              setPendingOpen(null);
            }}
            closeRequest={closeRequest}
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
              if (task) openTask(task);
            }}
            openRequest={chatRequest}
          />
        )}

        {cmdk && (
          <CommandBar
            tasks={tasks}
            commands={commands}
            initialMode={cmdk}
            onClose={() => setCmdk(null)}
            onOpenTask={openTask}
            onCreate={(text, open) => void quickCreate(text, open)}
            previewCreate={previewCreate}
            onAsk={session.staff ? (text) => setChatRequest({ nonce: Date.now(), text }) : undefined}
          />
        )}
        {shortcutsOpen && <ShortcutSheet onClose={() => setShortcutsOpen(false)} />}
        <Toaster />

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
    </WorkCalendarContext.Provider>
  );
}
