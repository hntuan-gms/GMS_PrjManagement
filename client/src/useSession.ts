import { useCallback, useEffect, useState } from "react";
import { ApiError, api, loginUrl, setUnauthorizedHandler } from "./api";
import type { Session } from "./types";

export type AuthStatus = "checking" | "anonymous" | "needsProject" | "ready";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Bạn đã từ chối cấp quyền truy cập. Vui lòng thử lại.",
  invalid_state: "Yêu cầu đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.",
  missing_code: "Atlassian không trả về mã xác thực. Vui lòng thử lại.",
  insufficient_scope:
    "Ứng dụng chưa được cấp đủ quyền trên Atlassian. Liên hệ quản trị viên để bật đủ scope.",
  identity_scope_missing:
    "Ứng dụng Atlassian chưa bật quyền \"User identity API\" (read:me) nên không đọc được " +
    "email để xác thực. Liên hệ quản trị viên để bật quyền này.",
  site_not_allowed:
    "Tài khoản Atlassian của bạn chưa được mời vào site Jira của Gimasys. " +
    "Hãy đề nghị quản trị viên dự án mời bạn, rồi đăng nhập lại.",
  no_site_access: "Tài khoản của bạn chưa có quyền truy cập site Jira nào.",
  login_failed: "Đăng nhập thất bại. Vui lòng thử lại.",
  invalid_client:
    "Client ID hoặc Client Secret của ứng dụng Atlassian không đúng. Liên hệ quản trị viên.",
};

const EXPIRED_MESSAGE = "Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.";

/** Read once, in a lazy initializer — StrictMode double-invokes effects, and the
 *  param would already be stripped by the time the second pass ran. */
function initialAuthError(): string | null {
  if (typeof window === "undefined") return null;
  const code = new URLSearchParams(window.location.search).get("auth_error");
  if (!code) return null;
  return AUTH_ERROR_MESSAGES[code] ?? "Đăng nhập thất bại. Vui lòng thử lại.";
}

export function useSession() {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [session, setSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState<string | null>(initialAuthError);

  // Strip ?auth_error= so a refresh doesn't resurrect the message.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("auth_error")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSession(null);
      setStatus("anonymous");
      setAuthError(EXPIRED_MESSAGE);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await api.getSession();
      setSession(next);
      setStatus(next.project ? "ready" : "needsProject");
    } catch (e) {
      // A 401 here is the normal logged-out path, not an expiry — don't shout.
      if (e instanceof ApiError && e.status === 401) {
        setSession(null);
        setStatus("anonymous");
        return;
      }
      setSession(null);
      setStatus("anonymous");
      setAuthError(e instanceof Error ? e.message : "Không kiểm tra được phiên đăng nhập.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(() => {
    window.location.assign(loginUrl);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Clearing local state matters more than the request succeeding.
    }
    setSession(null);
    setAuthError(null);
    setStatus("anonymous");
  }, []);

  const selectProject = useCallback(async (key: string) => {
    const project = await api.selectProject(key);
    setSession((prev) => (prev ? { ...prev, project } : prev));
    setStatus("ready");
  }, []);

  const clearProject = useCallback(() => {
    setSession((prev) => (prev ? { ...prev, project: null } : prev));
    setStatus("needsProject");
  }, []);

  return { status, session, authError, login, logout, selectProject, clearProject, refresh };
}
