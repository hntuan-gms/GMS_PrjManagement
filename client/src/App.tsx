import { useState } from "react";
import "./App.css";
import LoginScreen from "./components/LoginScreen";
import ProjectPicker from "./components/ProjectPicker";
import ProjectWorkspace from "./components/ProjectWorkspace";
import { useSession } from "./useSession";

/**
 * Auth shell. Every hook runs before any branch, so the early returns below stay
 * clear of react/rules-of-hooks; all the workspace state lives in ProjectWorkspace
 * where it is likewise unconditional.
 */
export default function App() {
  const { status, session, authError, login, logout, selectProject } = useSession();
  const [switching, setSwitching] = useState(false);

  if (status === "checking") {
    return <div className="center-message">Đang kiểm tra phiên đăng nhập...</div>;
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
          collapse set, selection and open modals without resetting each by hand. */}
      <ProjectWorkspace
        key={session.project.key}
        session={session}
        onSwitchProject={() => setSwitching(true)}
        onLogout={logout}
      />
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
