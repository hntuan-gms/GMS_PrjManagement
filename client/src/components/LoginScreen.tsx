import { useEffect, useState } from "react";

interface Props {
  onLogin: () => void;
  error: string | null;
}

/** Never shown — the "session expired" notice is suppressed on this screen. */
const SESSION_EXPIRED_MESSAGE = "Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.";

export default function LoginScreen({ onLogin, error }: Props) {
  const [redirecting, setRedirecting] = useState(false);

  // `onLogin` is a full-page navigation (window.location.assign), not a fetch —
  // there is no promise to await and no "cancelled" callback. If the user backs
  // out of the Atlassian screen, the browser can restore this exact page (and
  // its JS heap, including `redirecting`) from bfcache instead of remounting it,
  // which would otherwise leave the button disabled forever. `pageshow` with
  // `persisted: true` is the signal that this was a bfcache restore, not a fresh
  // load, so release the button then.
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        setRedirecting(false);
      }
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  function handleLoginClick() {
    setRedirecting(true);
    try {
      onLogin();
    } catch {
      // Navigation never actually started — don't leave the button stuck.
      setRedirecting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="modal auth-card">
        <div className="auth-logo" aria-hidden="true">
          📊
        </div>
        <h1>GMS PrjManagement</h1>
        <p className="auth-sub">
          Lập kế hoạch và theo dõi tiến độ dự án Jira theo phong cách MS Project.
        </p>

        {error && error !== SESSION_EXPIRED_MESSAGE && <div className="modal-error">{error}</div>}

        <button className="auth-btn primary" disabled={redirecting} onClick={handleLoginClick}>
          {redirecting ? "Đang chuyển tới Atlassian..." : "Đăng nhập bằng Atlassian"}
        </button>

        <p className="auth-hint">
          Bạn sẽ được chuyển tới trang đăng nhập của Atlassian. Ứng dụng chỉ truy cập những
          dự án Jira mà tài khoản của bạn có quyền, và mọi thay đổi được ghi nhận dưới tên
          bạn.
        </p>
      </div>
    </div>
  );
}
