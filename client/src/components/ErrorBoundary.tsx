import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Escape hatches. Without them a crash here is a dead end — see below. */
  onSwitchProject?: () => void;
  onLogout?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors in the workspace subtree.
 *
 * React unmounts the whole tree when a render throws and nothing catches it, so
 * before this existed any single bad value anywhere in the workspace produced a
 * blank white page with the real error only in the browser console — and no way
 * out of it: the chosen project lives in the session cookie, "Đổi dự án" is
 * inside the subtree that just vanished, and /api/auth/logout is POST-only, so
 * the only recovery was clearing site cookies by hand. That is why the fallback
 * carries the switch-project and logout actions rather than just a message.
 *
 * Must be a class: there is no hook form of componentDidCatch.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The console is the only place this is diagnosable in production; the
    // component stack is what names the failing component, so keep it.
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="center-message error">
        <strong>Giao diện gặp lỗi và không hiển thị được.</strong>
        <span>
          Bạn có thể thử lại, chọn dự án khác, hoặc đăng xuất. Nếu lỗi lặp lại, hãy gửi nội dung
          bên dưới cho quản trị viên.
        </span>
        <code className="error-detail">{error.message}</code>
        <div className="error-actions">
          {/* Clears the error and re-renders the same subtree: recovers a
              transient failure, and simply throws again on a deterministic one,
              which is why the other two actions are here. */}
          <button onClick={() => this.setState({ error: null })}>Thử lại</button>
          {this.props.onSwitchProject && (
            <button onClick={this.props.onSwitchProject}>Đổi dự án</button>
          )}
          {this.props.onLogout && <button onClick={this.props.onLogout}>Đăng xuất</button>}
        </div>
      </div>
    );
  }
}
