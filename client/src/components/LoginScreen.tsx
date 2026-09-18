import { useState } from "react";

interface Props {
  onLogin: () => void;
  error: string | null;
}

export default function LoginScreen({ onLogin, error }: Props) {
  const [redirecting, setRedirecting] = useState(false);

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

        {error && <div className="modal-error">{error}</div>}

        <button
          className="auth-btn primary"
          disabled={redirecting}
          onClick={() => {
            setRedirecting(true);
            onLogin();
          }}
        >
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
