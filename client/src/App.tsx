import { useEffect, useState } from "react";
import "./App.css";
import { api } from "./api";
import CreateTaskModal from "./components/CreateTaskModal";
import GanttView from "./components/GanttView";
import ResourceView from "./components/ResourceView";
import TaskEditModal from "./components/TaskEditModal";
import Toolbar from "./components/Toolbar";
import type { JiraUser, ProjectMeta, Task } from "./types";

export default function App() {
  const [meta, setMeta] = useState<ProjectMeta | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<JiraUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const [view, setView] = useState<"gantt" | "resource">("gantt");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);

  async function loadAll() {
    setLoading(true);
    setLoadError(null);
    try {
      const [m, t, u] = await Promise.all([api.getMeta(), api.listTasks(), api.listUsers()]);
      setMeta(m);
      setTasks(t);
      setUsers(u);
    } catch (e: any) {
      setLoadError(e.message ?? "Không thể kết nối tới server");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleSync() {
    setSyncing(true);
    try {
      const result = await api.sync();
      setTasks(result.tasks);
      setLastSyncedAt(result.syncedAt);
    } catch (e: any) {
      setLoadError(e.message);
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
        Lỗi kết nối server: {loadError}
        <br />
        <small>Kiểm tra backend đã chạy tại đúng địa chỉ VITE_API_BASE chưa.</small>
        <div>
          <button onClick={loadAll}>Thử lại</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Toolbar
        meta={meta}
        view={view}
        onViewChange={setView}
        onAddTask={() => setCreating(true)}
        onSync={handleSync}
        syncing={syncing}
        lastSyncedAt={lastSyncedAt}
      />

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
    </div>
  );
}
