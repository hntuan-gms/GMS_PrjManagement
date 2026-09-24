import { useState } from "react";
import type { Session } from "../types";

interface Props {
  session: Session;
  view: "gantt" | "resource";
  onViewChange: (v: "gantt" | "resource") => void;
  /** People overloaded in the near-term window — badged on the resource tab. */
  overloadedPeople: number;
  /** False hides the resource tab: only project admins get an accurate member list. */
  showResources: boolean;
  onAddTask: () => void;
  onSync: () => void;
  syncing: boolean;
  lastSyncedAt: string | null;
  onSwitchProject: () => void;
  onLogout: () => void;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export default function Toolbar({
  session,
  view,
  onViewChange,
  overloadedPeople,
  showResources,
  onAddTask,
  onSync,
  syncing,
  lastSyncedAt,
  onSwitchProject,
  onLogout,
}: Props) {
  // Jira avatar URLs behind the OAuth gateway need a bearer token and 403 as a
  // bare <img src>, so a fallback is mandatory rather than defensive.
  const [avatarFailed, setAvatarFailed] = useState(false);
  const { user, project, site } = session;

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <h1>GMS PrjManagement</h1>
        {project && (
          <span className="project-badge" title={`${site.name} — ${site.url}`}>
            ● {project.key} — {project.name}
          </span>
        )}
      </div>
      <div className="toolbar-tabs">
        <button className={view === "gantt" ? "active" : ""} onClick={() => onViewChange("gantt")}>
          Gantt / WBS
        </button>
        {/* Project admins only — see requireResourceAccess on the server. */}
        {showResources && (
          <button className={view === "resource" ? "active" : ""} onClick={() => onViewChange("resource")}>
            Nguồn lực
            {/* The overload count lives on the tab, not inside it: the reason to
                open this tab is that someone is overbooked, and that is exactly
                what you cannot see from the Gantt. */}
            {overloadedPeople > 0 && (
              <span className="tab-badge" title={`${overloadedPeople} thành viên đang quá tải`}>
                {overloadedPeople}
              </span>
            )}
          </button>
        )}
      </div>
      <div className="toolbar-right">
        {lastSyncedAt && (
          <span className="sync-time">
            Đã đồng bộ: {new Date(lastSyncedAt).toLocaleTimeString("vi-VN")}
          </span>
        )}
        <button onClick={onSync} disabled={syncing}>
          {syncing ? "Đang đồng bộ..." : "⟳ Đồng bộ từ Jira"}
        </button>
        <button className="primary" onClick={onAddTask}>
          + Task mới
        </button>

        <span className="toolbar-divider" aria-hidden="true" />

        <span className="user-chip" title={user.displayName}>
          {user.avatarUrl && !avatarFailed ? (
            <img
              className="user-avatar"
              src={user.avatarUrl}
              alt=""
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            <span className="user-avatar user-avatar-fallback" aria-hidden="true">
              {initials(user.displayName)}
            </span>
          )}
          <span className="user-name">{user.displayName}</span>
        </span>
        <button onClick={onSwitchProject}>Đổi dự án</button>
        <button
          onClick={() => {
            if (syncing && !confirm("Đang đồng bộ. Vẫn đăng xuất?")) return;
            onLogout();
          }}
        >
          Đăng xuất
        </button>
      </div>
    </div>
  );
}
