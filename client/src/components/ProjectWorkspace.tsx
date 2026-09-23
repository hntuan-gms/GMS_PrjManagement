import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ApiError, NetworkError, api } from "../api";
import { computeOptimisticCascade } from "../dependencyCascade";
import type {
  BulkTaskCreateResult,
  DependencyType,
  JiraUser,
  Predecessor,
  Session,
  Task,
  TaskUpdateResponse,
} from "../types";
import ChatDock from "./ChatDock";
import CreateTaskModal from "./CreateTaskModal";
import GanttView from "./GanttView";
import PlanReviewModal from "./PlanReviewModal";
import ResourceView from "./ResourceView";
import TaskEditModal from "./TaskEditModal";
import Toolbar from "./Toolbar";

interface Props {
  session: Session;
  onSwitchProject: () => void;
  onLogout: () => void;
}

const OVERLAY_WARNING =
  "Phụ thuộc, baseline và % hoàn thành được lưu tạm trên máy chủ và sẽ mất khi ứng dụng " +
  "được cập nhật. Ngày bắt đầu và ngày kết thúc vẫn được đồng bộ với Jira.";

export default function ProjectWorkspace({ session, onSwitchProject, onLogout }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<JiraUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ message: string; network: boolean } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [overlayNoticeDismissed, setOverlayNoticeDismissed] = useState(false);

  const [view, setView] = useState<"gantt" | "resource">("gantt");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Multi-select, file-list style. `selectedIds` is the real selection;
  // `selectedId` stays the single "focused" row the edit modal opens on, and
  // doubles as the anchor a Shift range measures from.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  // The plan being reviewed, opened from the assistant's table card.
  const [reviewRunId, setReviewRunId] = useState<string | null>(null);
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
    setLoading(true);
    setLoadError(null);
    try {
      const [t, u] = await Promise.all([api.listTasks(), api.listUsers()]);
      setTasks(t);
      setUsers(u);
    } catch (e) {
      // The shell is already swapping in the login screen; a red banner here would
      // just flash during the transition.
      if (e instanceof ApiError && e.status === 401) return;
      setLoadError({
        message: e instanceof Error ? e.message : "Không tải được dữ liệu dự án.",
        network: e instanceof NetworkError,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const ids = [...selectedIds];
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
    const cascade = computeOptimisticCascade(tasks, id, startDate, durationDays);
    flushSync(() => {
      setTasks((prev) => prev.map((t) => cascade.get(t.id) ?? t));
    });
    for (const touchedId of cascade.keys()) taskVersion.current.set(touchedId, seq);
    try {
      const updated = await api.updateTask(id, { startDate, durationDays });
      setTasks((prev) => applyTaskUpdate(prev, updated, seq));
    } catch (e) {
      if ((taskVersion.current.get(id) ?? 0) > seq) return; // superseded by a newer drag
      setSyncError(e instanceof Error ? e.message : "Không thể lưu thay đổi lịch trình.");
      await refreshTasks();
    }
  }

  async function handleProgressChange(id: string, percentComplete: number) {
    const seq = nextSeq();
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, percentComplete } : t)));
    taskVersion.current.set(id, seq);
    try {
      const updated = await api.updateTask(id, { percentComplete });
      setTasks((prev) => applyTaskUpdate(prev, updated, seq));
    } catch (e) {
      if ((taskVersion.current.get(id) ?? 0) > seq) return;
      setSyncError(e instanceof Error ? e.message : "Không thể lưu % hoàn thành.");
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
        onAddTask={() => setCreating(true)}
        onSync={handleSync}
        syncing={syncing}
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

      {selectedIds.size > 0 && view === "gantt" && (
        <div className="selection-bar">
          <span>
            Đã chọn <strong>{selectedIds.size}</strong> công việc
          </span>
          <button onClick={() => setSelectedIds(new Set())}>Bỏ chọn</button>
          <button className="danger" onClick={handleDeleteSelected} disabled={deleting}>
            {deleting ? "Đang xoá..." : `Xoá ${selectedIds.size} công việc`}
          </button>
          <span className="selection-hint">Ctrl/Cmd để chọn thêm · Shift để chọn cả dải</span>
        </div>
      )}

      <div className="app-body">
        {view === "gantt" ? (
          <GanttView
            tasks={tasks}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapse}
            selectedId={selectedId}
            onSelect={handleSelect}
            selectedIds={selectedIds}
            onOpenEdit={setEditingTask}
            onScheduleChange={handleScheduleChange}
            onProgressChange={handleProgressChange}
            onAddDependency={handleAddDependency}
            onEditDependency={handleEditDependency}
            onDeleteDependency={handleDeleteDependency}
          />
        ) : (
          <ResourceView tasks={tasks} users={users} onOpenEdit={setEditingTask} />
        )}
      </div>

      {editingTask && (
        <TaskEditModal
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
        />
      )}

      <ChatDock onOpenPlan={setReviewRunId} />

      {reviewRunId && (
        <PlanReviewModal
          runId={reviewRunId}
          users={users}
          onClose={() => setReviewRunId(null)}
          onApplied={refreshTasks}
        />
      )}

      {creating && (
        <CreateTaskModal
          tasks={tasks}
          users={users}
          onClose={() => setCreating(false)}
          onCreate={async (input): Promise<BulkTaskCreateResult> => {
            if (input.summaries.length === 1) {
              const single = await api.createTask({
                summary: input.summaries[0],
                description: input.description,
                issueType: input.issueType,
                wbsParentId: input.wbsParentId,
                startDate: input.startDate,
                durationDays: input.durationDays,
                assigneeAccountId: input.assigneeAccountId,
              });
              await refreshTasks();
              return { created: [single], errors: [] };
            } else {
              const res = await api.createTasksBulk(input);
              if (res.created.length > 0) await refreshTasks();
              return res;
            }
          }}
        />
      )}
    </div>
  );
}
