import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ApiError, NetworkError, api } from "../api";
import { computeOptimisticCascade } from "../dependencyCascade";
import type { BulkTaskCreateResult, DependencyType, JiraUser, Session, Task, TaskUpdateResponse } from "../types";
import CreateTaskModal from "./CreateTaskModal";
import GanttView from "./GanttView";
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
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  // Sequence number per task id, bumped on every schedule-change request. A slow
  // save's response is only applied if it's still the latest one issued for that
  // task — otherwise a stale reply from an earlier drag (Jira round trips can take
  // several seconds) can land after a newer drag's own optimistic update and yank
  // the bar back to wherever that older drag left it.
  const scheduleRequestSeq = useRef<Map<string, number>>(new Map());

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
   * Object identity is preserved for every task the cascade didn't touch, so
   * unrelated rows don't needlessly re-render either.
   */
  function applyTaskUpdate(prev: Task[], response: TaskUpdateResponse): Task[] {
    const { cascaded, cascadeWarnings: _cascadeWarnings, ...primary } = response;
    const byId = new Map<string, Task>([[primary.id, primary], ...cascaded.map((t) => [t.id, t] as const)]);
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
   * same task again before the previous request's response lands. `seq` makes
   * sure only the response for the LATEST request on this task id is ever
   * applied — an older, slower reply arriving after a newer drag would otherwise
   * overwrite the newer optimistic position with its own now-stale one.
   */
  async function handleScheduleChange(id: string, startDate: string, durationDays: number) {
    const cascade = computeOptimisticCascade(tasks, id, startDate, durationDays);
    flushSync(() => {
      setTasks((prev) => prev.map((t) => cascade.get(t.id) ?? t));
    });
    const seq = (scheduleRequestSeq.current.get(id) ?? 0) + 1;
    scheduleRequestSeq.current.set(id, seq);
    try {
      const updated = await api.updateTask(id, { startDate, durationDays });
      if (scheduleRequestSeq.current.get(id) !== seq) return; // superseded by a newer drag
      setTasks((prev) => applyTaskUpdate(prev, updated));
    } catch (e) {
      if (scheduleRequestSeq.current.get(id) !== seq) return;
      setSyncError(e instanceof Error ? e.message : "Không thể lưu thay đổi lịch trình.");
      await refreshTasks();
    }
  }

  async function handleProgressChange(id: string, percentComplete: number) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, percentComplete } : t)));
    try {
      const updated = await api.updateTask(id, { percentComplete });
      setTasks((prev) => applyTaskUpdate(prev, updated));
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Không thể lưu % hoàn thành.");
      await refreshTasks();
    }
  }

  /** Drag-to-connect on the Gantt chart: successorId gets predecessorId added to its list. */
  async function handleAddDependency(successorId: string, predecessorId: string, type: DependencyType) {
    const successor = tasks.find((t) => t.id === successorId);
    if (!successor) return;
    if (successor.predecessors.some((p) => p.taskId === predecessorId && p.type === type)) return;
    try {
      const updated = await api.updateTask(successorId, {
        predecessors: [...successor.predecessors, { taskId: predecessorId, type, lagDays: 0 }],
      });
      setTasks((prev) => applyTaskUpdate(prev, updated));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Không thể tạo phụ thuộc giữa hai task.");
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

      <div className="app-body">
        {view === "gantt" ? (
          <GanttView
            tasks={tasks}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapse}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpenEdit={setEditingTask}
            onScheduleChange={handleScheduleChange}
            onProgressChange={handleProgressChange}
            onAddDependency={handleAddDependency}
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
            const updated = await api.updateTask(editingTask.id, patch);
            setTasks((prev) => applyTaskUpdate(prev, updated));
          }}
          onDelete={async () => {
            await api.deleteTask(editingTask.id);
            await refreshTasks();
          }}
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
