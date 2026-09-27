import { useEffect, useState } from "react";

interface Props {
  onLogin: () => void;
  error: string | null;
}

/** Never shown — the "session expired" notice is suppressed on this screen. */
const SESSION_EXPIRED_MESSAGE = "Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.";

/**
 * Atlassian's own logout page, for switching account.
 *
 * "Đăng xuất" in this app only ends the app's session. The browser stays signed
 * in to Atlassian, so the next login goes straight to the consent screen for the
 * same account — `prompt=consent` re-shows consent, it does not ask who you are.
 * Ending the Atlassian session is the only way to get an account choice.
 *
 * Deliberately a separate link, not what "Đăng xuất" does: it also signs the
 * browser out of Jira and Confluence in every other tab, which someone who just
 * wants to leave this app would not expect.
 *
 * Opened in a NEW tab, with no return URL. `?continue=` is undocumented, and in
 * testing Atlassian ignored it for this app's origin and left the user stranded
 * on Atlassian's own pages. A second tab needs no redirect back: this login
 * screen is still here, waiting, when the user closes the Atlassian one.
 */
const ATLASSIAN_LOGOUT_URL = "https://id.atlassian.com/logout";

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

        <div className="auth-switch">
          <a href={ATLASSIAN_LOGOUT_URL} target="_blank" rel="noopener noreferrer">
            Đăng nhập bằng tài khoản Atlassian khác ↗
          </a>
          <span>
            Trình duyệt vẫn đang đăng nhập Atlassian bằng tài khoản cũ. Liên kết mở trang đăng xuất
            Atlassian trong tab mới — việc này đăng xuất cả các tab Jira, Confluence đang mở.
          </span>
          <ol className="auth-switch-steps">
            <li>Đăng xuất ở tab vừa mở, rồi đóng tab đó.</li>
            <li>
              Quay lại đây, bấm <b>Đăng nhập bằng Atlassian</b> và chọn tài khoản mới. Nếu đăng nhập
              Atlassian bằng Google, hãy chọn đúng tài khoản Google.
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
