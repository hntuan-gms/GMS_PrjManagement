import type { ProjectMeta } from "../types";

interface Props {
  meta: ProjectMeta | null;
  view: "gantt" | "resource";
  onViewChange: (v: "gantt" | "resource") => void;
  onAddTask: () => void;
  onSync: () => void;
  syncing: boolean;
  lastSyncedAt: string | null;
}

export default function Toolbar({ meta, view, onViewChange, onAddTask, onSync, syncing, lastSyncedAt }: Props) {
  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <h1>GMS PrjManagement</h1>
        {meta && (
          <span className={`mode-badge mode-${meta.mode}`}>
            {meta.mode === "live" ? `● Live — Jira ${meta.projectKey}` : "○ Mock data (chưa cấu hình Jira)"}
          </span>
        )}
      </div>
      <div className="toolbar-tabs">
        <button className={view === "gantt" ? "active" : ""} onClick={() => onViewChange("gantt")}>
          Gantt / WBS
        </button>
        <button className={view === "resource" ? "active" : ""} onClick={() => onViewChange("resource")}>
          Resource
        </button>
      </div>
      <div className="toolbar-right">
        {lastSyncedAt && <span className="sync-time">Đã đồng bộ: {new Date(lastSyncedAt).toLocaleTimeString("vi-VN")}</span>}
        <button onClick={onSync} disabled={syncing}>
          {syncing ? "Đang đồng bộ..." : "⟳ Đồng bộ từ Jira"}
        </button>
        <button className="primary" onClick={onAddTask}>
          + Task mới
        </button>
      </div>
    </div>
  );
}
