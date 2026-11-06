import { useState, type ReactNode } from "react";
import type { Session } from "../types";
import { setDensity, setThemeChoice, type Density, type ThemeChoice } from "../theme";
import { useAppearance } from "../useAppearance";
import { Icon, type IconName } from "./Icons";
import { useDialogs } from "./dialogContext";
import Popover from "./Popover";

import { LENSES, type SyncState, type WorkspaceView } from "../lenses";

interface Props {
  session: Session;
  view: WorkspaceView;
  onViewChange: (v: WorkspaceView) => void;
  /** People overloaded in the near-term window — badged on the Nhân lực lens. */
  overloadedPeople: number;
  /** False hides the Nhân lực lens: only project admins get an accurate member list. */
  showResources: boolean;
  onAddTask: () => void;
  onSync: () => void;
  sync: SyncState;
  onSwitchProject: () => void;
  onOpenSla: () => void;
  onOpenCalendar: () => void;
  onOpenCommand: () => void;
  onOpenShortcuts: () => void;
  onOpenAssistant?: () => void;
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

function RailButton({
  icon,
  label,
  keys,
  active,
  onClick,
  view,
  badge,
}: {
  icon: IconName;
  label: string;
  keys?: string;
  active?: boolean;
  onClick: () => void;
  view?: string;
  badge?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`rail-btn${active ? " is-active" : ""}`}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      data-view={view}
      data-tip={keys ? `${label}  ${keys}` : label}
      onClick={onClick}
    >
      <Icon name={icon} size={18} />
      {badge}
    </button>
  );
}

function SyncIndicator({ sync, onSync }: { sync: SyncState; onSync: () => void }) {
  const text =
    sync.kind === "ok"
      ? "Khớp Jira"
      : sync.kind === "reading"
        ? "Đang đọc Jira…"
        : sync.kind === "limited"
          ? `Jira đang giới hạn · ${sync.minutes} phút`
          : "Lỗi đồng bộ";
  const title =
    sync.kind === "ok"
      ? `${sync.at ? `Đọc lần cuối ${new Date(sync.at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}. ` : ""}Bấm để đọc lại ngay (Shift R)`
      : sync.kind === "limited"
        ? "Jira đang giới hạn số lượt truy cập của ứng dụng: đây là dữ liệu đã lưu, thao tác ghi có thể bị từ chối."
        : sync.kind === "error"
          ? sync.message
          : "Đang đọc dữ liệu mới từ Jira";
  return (
    <button
      type="button"
      className={`sync-indicator is-${sync.kind}`}
      onClick={onSync}
      disabled={sync.kind === "reading"}
      title={title}
      aria-label={`${text}. ${title}`}
    >
      <span className="sync-dot" aria-hidden="true" />
      <span className="sync-text">{text}</span>
    </button>
  );
}

const THEME_LABEL: Record<ThemeChoice, string> = { light: "Sáng", dark: "Tối", system: "Theo máy" };
const DENSITY_LABEL: Record<Density, string> = { compact: "Gọn", default: "Vừa", comfortable: "Thoáng" };

export default function Toolbar({
  session,
  view,
  onViewChange,
  overloadedPeople,
  showResources,
  onAddTask,
  onSync,
  sync,
  onSwitchProject,
  onOpenSla,
  onOpenCalendar,
  onOpenCommand,
  onOpenShortcuts,
  onOpenAssistant,
  onLogout,
}: Props) {
  // Jira avatar URLs behind the OAuth gateway need a bearer token and 403 as a
  // bare <img src>, so a fallback is mandatory rather than defensive.
  const [avatarFailed, setAvatarFailed] = useState(false);
  const { user, project, site } = session;
  const dialogs = useDialogs();
  const appearance = useAppearance();
  const lensView = LENSES.some((l) => l.id === view) ? view : null;

  const avatar =
    user.avatarUrl && !avatarFailed ? (
      <img className="user-avatar" src={user.avatarUrl} alt="" onError={() => setAvatarFailed(true)} />
    ) : (
      <span className="user-avatar user-avatar-fallback" aria-hidden="true">
        {initials(user.displayName)}
      </span>
    );

  const lenses = LENSES.filter((l) => l.id !== "resource" || showResources);

  return (
    <>
      <nav className="app-rail" aria-label="Điều hướng">
        <button type="button" className="rail-mark" aria-label="GMS · về Hôm nay" data-tip="Về Hôm nay  G H" onClick={() => onViewChange("today")}>
          <span aria-hidden="true">G</span>
        </button>
        <RailButton icon="plus" label="Tạo việc" keys="C" onClick={onAddTask} />
        <span className="rail-sep" aria-hidden="true" />
        <RailButton icon="sun" label="Hôm nay" keys="G H" view="today" active={view === "today"} onClick={() => onViewChange("today")} />
        <RailButton
          icon="plan"
          label="Dự án"
          keys="1–4"
          view="plan"
          active={lensView !== null}
          onClick={() => onViewChange(lensView ?? "gantt")}
        />
        <RailButton icon="clock" label="Giờ làm" keys="G T" view="timesheet" active={view === "timesheet"} onClick={() => onViewChange("timesheet")} />
        <span className="rail-fill" />
        {onOpenAssistant && <RailButton icon="chat" label="Trợ lý" onClick={onOpenAssistant} />}
        <RailButton icon="search" label="Tìm, tạo, hỏi" keys="Ctrl K" onClick={onOpenCommand} />
        <RailButton icon="keyboard" label="Phím tắt" keys="?" onClick={onOpenShortcuts} />
        <Popover
          className="rail-btn rail-avatar"
          role="menu"
          align="start"
          placement="top"
          caret={false}
          menuLabel="Tài khoản"
          menuClassName="rail-menu"
          ariaLabel={`Tài khoản: ${user.displayName}`}
          title={user.displayName}
          label={avatar}
        >
          {({ close }) => (
            <>
              <div className="menu-profile">
                {avatar}
                <span className="menu-profile-name">
                  {user.displayName}
                  <small>{site.name}</small>
                </span>
              </div>
              <div className="menu-sep" role="separator" />
              <div className="menu-heading">Giao diện</div>
              <div className="seg-group menu-seg" role="group" aria-label="Giao diện">
                {(Object.keys(THEME_LABEL) as ThemeChoice[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={appearance.choice === c ? "active" : ""}
                    aria-pressed={appearance.choice === c}
                    onClick={() => setThemeChoice(c)}
                  >
                    <Icon name={c === "light" ? "sun" : c === "dark" ? "moon" : "monitor"} size={14} />
                    {THEME_LABEL[c]}
                  </button>
                ))}
              </div>
              <div className="menu-heading">Mật độ dòng</div>
              <div className="seg-group menu-seg" role="group" aria-label="Mật độ dòng">
                {(Object.keys(DENSITY_LABEL) as Density[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={appearance.density === d ? "active" : ""}
                    aria-pressed={appearance.density === d}
                    onClick={() => setDensity(d)}
                  >
                    {DENSITY_LABEL[d]}
                  </button>
                ))}
              </div>
              <div className="menu-sep" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={async () => {
                  close();
                  if (sync.kind === "reading" && !(await dialogs.confirm({ message: "Đang đọc dữ liệu từ Jira. Vẫn đăng xuất?", confirmLabel: "Đăng xuất" })))
                    return;
                  onLogout();
                }}
              >
                <Icon name="logout" />
                Đăng xuất
              </button>
            </>
          )}
        </Popover>
      </nav>

      <header className="toolbar">
        <div className="toolbar-left">
          {project && (
            <Popover
              className="hd-btn project-switch"
              role="menu"
              menuLabel="Dự án"
              title={`${site.name} — ${site.url}`}
              label={
                <>
                  <span className="proj-name">{project.name}</span>
                  <span className="proj-key">{project.key}</span>
                </>
              }
            >
              {({ close }) => (
                <>
                  <div className="menu-heading">{site.name}</div>
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
                    <span className="menu-item-text">Đổi dự án…</span>
                    <kbd className="menu-kbd">Ctrl P</kbd>
                  </button>
                  <div className="menu-sep" role="separator" />
                  <div className="menu-heading">Cài đặt dự án</div>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      close();
                      onOpenSla();
                    }}
                  >
                    <Icon name="clock" />
                    Cài đặt SLA…
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      close();
                      onOpenCalendar();
                    }}
                  >
                    <Icon name="calendar" />
                    Lịch làm việc & ngày lễ…
                  </button>
                </>
              )}
            </Popover>
          )}
        </div>

        <nav className="toolbar-tabs lens-tabs" aria-label="Lăng kính">
          {lenses.map((l) => (
            <button
              key={l.id}
              type="button"
              className={view === l.id ? "active" : ""}
              aria-current={view === l.id ? "page" : undefined}
              data-lens={l.id}
              onClick={() => onViewChange(l.id)}
              title={`${l.label} (phím ${l.key})`}
            >
              {l.label}
              {l.id === "resource" && overloadedPeople > 0 && (
                <span className="tab-badge" title={`${overloadedPeople} thành viên đang quá tải`}>
                  {overloadedPeople}
                  <span className="sr-only"> thành viên đang quá tải</span>
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="toolbar-right">
          <SyncIndicator sync={sync} onSync={onSync} />
          <button type="button" className="cmdk-trigger" onClick={onOpenCommand} aria-label="Mở ô lệnh (Ctrl K)">
            <Icon name="search" size={14} />
            <span>Tìm, tạo, hỏi…</span>
            <kbd>Ctrl K</kbd>
          </button>
        </div>
      </header>
    </>
  );
}
