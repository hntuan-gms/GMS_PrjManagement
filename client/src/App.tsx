import { useEffect, useRef, useState } from "react";
import "./App.css";
import ErrorBoundary from "./components/ErrorBoundary";
import LoginScreen from "./components/LoginScreen";
import ProjectPicker from "./components/ProjectPicker";
import ProjectWorkspace from "./components/ProjectWorkspace";
import { captureDeepLink, clearDeepLink, type DeepLink } from "./deepLink";
import { useSession } from "./useSession";

/**
 * Auth shell. Every hook runs before any branch, so the early returns below stay
 * clear of react/rules-of-hooks; all the workspace state lives in ProjectWorkspace
 * where it is likewise unconditional.
 */
export default function App() {
  const { status, session, authError, login, logout, selectProject } = useSession();
  const [switching, setSwitching] = useState(false);

  // A link to one saved report (deepLink.ts): parked on load, acted on once there is a session —
  // switch this tab to the link's project, then open the Báo cáo tab on that report.
  const [link, setLink] = useState<DeepLink | null>(captureDeepLink);
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const handlingLink = useRef(false);
  const projectKey = session?.project?.key ?? null;
  useEffect(() => {
    if (!link || !session || handlingLink.current) return;
    handlingLink.current = true;
    const finish = (reportId: string | null, error: string | null) => {
      clearDeepLink();
      setLink(null);
      setOpenReportId(reportId);
      setLinkError(error);
      handlingLink.current = false;
    };
    if (projectKey === link.project) {
      finish(link.reportId, null);
      return;
    }
    selectProject(link.project).then(
      () => finish(link.reportId, null),
      () => finish(null, `Không mở được liên kết: bạn chưa có quyền xem dự án ${link.project}.`)
    );
  }, [link, session, projectKey, selectProject]);

  if (status === "checking") {
    return <div className="center-message">Đang kiểm tra phiên đăng nhập...</div>;
  }
  // Holding the workspace back while the link's project is being switched to, so the wrong
  // project's tasks do not flash up first.
  if (link && session && projectKey !== link.project) {
    return <div className="center-message">Đang mở báo cáo...</div>;
  }

  if (status === "anonymous" || !session) {
    return <LoginScreen onLogin={login} error={authError} />;
  }

  if (!session.project) {
    return (
      <ProjectPicker
        session={session}
        variant="page"
        onSelect={selectProject}
        onLogout={logout}
      />
    );
  }

  return (
    <>
      {/* key remounts the subtree on project switch, discarding tasks, users,
          collapse set, selection and open modals without resetting each by hand.
          It sits on the boundary so switching project also clears a caught error;
          the picker below renders outside the boundary, so it stays reachable
          even while the workspace is broken. */}
      <ErrorBoundary
        key={session.project.key}
        onSwitchProject={() => setSwitching(true)}
        onLogout={logout}
      >
        {linkError && (
          <div className="notice notice-error" role="alert">
            <span>{linkError}</span>
            <button className="link-btn" onClick={() => setLinkError(null)}>
              Đóng
            </button>
          </div>
        )}
        <ProjectWorkspace
          initialReportId={openReportId}
          onInitialReportShown={() => setOpenReportId(null)}
          session={session}
          onSwitchProject={() => setSwitching(true)}
          onLogout={logout}
        />
      </ErrorBoundary>
      {switching && (
        <ProjectPicker
          session={session}
          variant="modal"
          onSelect={async (key) => {
            await selectProject(key);
            setSwitching(false);
          }}
          onCancel={() => setSwitching(false)}
          onLogout={logout}
        />
      )}
    </>
  );
}
