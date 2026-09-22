import { useEffect, useState } from "react";
import { ApiError, NetworkError, api } from "../api";
import type { BulkTaskCreateResult, JiraUser, Session, Task } from "../types";
import CreateTaskModal from "./CreateTaskModal";
import GanttView from "./GanttView";
import ImportTasksModal from "./ImportTasksModal";
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
  const [importing, setImporting] = useState(false);

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

  async function handleScheduleChange(id: string, startDate: string, durationDays: number) {
    const updated = await api.updateTask(id, { startDate, durationDays });
    setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    await refreshTasks(); // pick up any dependency cascade on successors
  }

  async function handleProgressChange(id: string, percentComplete: number) {
    const updated = await api.updateTask(id, { percentComplete });
    setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
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
        onImportTasks={() => setImporting(true)}
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
            setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
            await refreshTasks();
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
          onCreate={async (input) => {
            await api.createTask(input);
            await refreshTasks();
          }}
        />
      )}

      {importing && (
        <ImportTasksModal
          tasks={tasks}
          users={users}
          onClose={() => setImporting(false)}
          onImport={async (input): Promise<BulkTaskCreateResult> => {
            const res = await api.createTasksBulk(input);
            if (res.created.length > 0) await refreshTasks();
            return res;
          }}
        />
      )}
    </div>
  );
}
