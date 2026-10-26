import { useState, type ReactNode } from "react";
import type { Session } from "../types";
import { Icon } from "./Icons";
import Popover from "./Popover";

export type WorkspaceView = "gantt" | "board" | "timesheet" | "resource" | "report";

interface Props {
  session: Session;
  view: WorkspaceView;
  onViewChange: (v: WorkspaceView) => void;
  /** People overloaded in the near-term window — badged on the resource tab. */
  overloadedPeople: number;
  /** False hides the resource tab: only project admins get an accurate member list. */
  showResources: boolean;
  onAddTask: () => void;
  onSync: () => void;
  syncing: boolean;
  /** A saved copy is on screen while the current one loads. */
  refreshing?: boolean;
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
  refreshing,
  lastSyncedAt,
  onSwitchProject,
  onLogout,
}: Props) {
  // Jira avatar URLs behind the OAuth gateway need a bearer token and 403 as a
  // bare <img src>, so a fallback is mandatory rather than defensive.
  const [avatarFailed, setAvatarFailed] = useState(false);
  const { user, project, site } = session;

  const avatar =
    user.avatarUrl && !avatarFailed ? (
      <img className="user-avatar" src={user.avatarUrl} alt="" onError={() => setAvatarFailed(true)} />
    ) : (
      <span className="user-avatar user-avatar-fallback" aria-hidden="true">
        {initials(user.displayName)}
      </span>
    );

  const tab = (id: WorkspaceView, text: string, badge?: ReactNode) => (
    <button
      type="button"
      className={view === id ? "active" : ""}
      aria-current={view === id ? "page" : undefined}
      onClick={() => onViewChange(id)}
    >
      {text}
      {badge}
    </button>
  );

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <span className="brand" title="GMS PrjManagement">
          <Icon name="logo" size={20} />
          <h1>GMS PrjManagement</h1>
        </span>
        {project && (
          <Popover
            className="hd-btn project-switch"
            role="menu"
            menuLabel="Dự án"
            title={`${site.name} — ${site.url}`}
            label={
              <>
                <span className="proj-key">{project.key}</span>
                <span className="proj-name">{project.name}</span>
              </>
            }
          >
            {({ close }) => (
              <>
                <div className="menu-heading">{site.name}</div>
                <div className="menu-current">
                  <span className="proj-key">{project.key}</span>
                  <span className="menu-current-name">{project.name}</span>
                </div>
                <div className="menu-sep" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    close();
                    onSwitchProject();
                  }}
                >
                  <Icon name="switch" />
                  Đổi dự án…
                </button>
              </>
            )}
          </Popover>
        )}
      </div>

      <nav className="toolbar-tabs" aria-label="Chế độ xem">
        {tab("gantt", "Gantt / WBS")}
        {tab("board", "Bảng")}
        {tab("timesheet", "Chấm công")}
        {/* Project admins only — see requireResourceAccess on the server. */}
        {showResources &&
          tab(
            "resource",
            "Nguồn lực",
            /* The overload count lives on the tab, not inside it: the reason to
               open this tab is that someone is overbooked, and that is exactly
               what you cannot see from the Gantt. */
            overloadedPeople > 0 && (
              <span className="tab-badge" title={`${overloadedPeople} thành viên đang quá tải`}>
                {overloadedPeople}
                <span className="sr-only"> thành viên đang quá tải</span>
              </span>
            )
          )}
        {tab("report", "Báo cáo")}
      </nav>

      <div className="toolbar-right">
        {lastSyncedAt && (
          <span className="sync-time">Đã đồng bộ: {new Date(lastSyncedAt).toLocaleTimeString("vi-VN")}</span>
        )}
        <button type="button" className="hd-btn ghost" onClick={onSync} disabled={syncing || refreshing}>
          <Icon name="sync" className={syncing || refreshing ? "spin" : undefined} />
          {syncing ? "Đang đồng bộ..." : refreshing ? "Đang cập nhật..." : "Đồng bộ từ Jira"}
        </button>
        <button type="button" className="hd-btn primary" onClick={onAddTask}>
          <Icon name="plus" />
          Task mới
        </button>

        <Popover
          className="hd-btn hd-avatar"
          role="menu"
          align="end"
          caret={false}
          menuLabel="Tài khoản"
          ariaLabel={`Tài khoản: ${user.displayName}`}
          title={user.displayName}
          label={avatar}
        >
          {({ close }) => (
            <>
              <div className="menu-profile">
                {avatar}
                <span className="menu-profile-name">{user.displayName}</span>
              </div>
              <div className="menu-sep" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  close();
                  if (syncing && !confirm("Đang đồng bộ. Vẫn đăng xuất?")) return;
                  onLogout();
                }}
              >
                <Icon name="logout" />
                Đăng xuất
              </button>
            </>
          )}
        </Popover>
      </div>
    </header>
  );
}
