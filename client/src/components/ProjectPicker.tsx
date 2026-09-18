import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { ProjectSummary, Session } from "../types";

interface Props {
  session: Session;
  /** "page" is the post-login step; "modal" is the toolbar's "Đổi dự án". */
  variant: "page" | "modal";
  onSelect: (key: string) => Promise<void>;
  onCancel?: () => void;
  onLogout: () => void;
}

export default function ProjectPicker({ session, variant, onSelect, onCancel, onLogout }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [choosing, setChoosing] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setProjects(null);
    setError(null);
    api
      .listProjects()
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Không tải được danh sách dự án.");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const visible = useMemo(() => {
    if (!projects) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) => p.key.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
    );
  }, [projects, filter]);

  async function choose(key: string) {
    setChoosing(key);
    setError(null);
    try {
      await onSelect(key);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không mở được dự án.");
      setChoosing(null);
    }
  }

  const body = (
    <>
      <div className="modal-header">
        <div>
          <h2 className="picker-title">Chọn dự án</h2>
          <p className="auth-sub">Chọn dự án Jira bạn muốn lập kế hoạch.</p>
        </div>
        {onCancel && (
          <button className="modal-close" onClick={onCancel} aria-label="Đóng">
            ×
          </button>
        )}
      </div>

      <label className="field">
        <span>Tìm dự án</span>
        <input
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Tìm theo tên hoặc mã dự án..."
        />
      </label>

      {error && <div className="modal-error">{error}</div>}

      {projects === null && !error && <div className="picker-empty">Đang tải danh sách dự án...</div>}

      {projects !== null && projects.length === 0 && (
        <div className="picker-empty">
          Tài khoản của bạn chưa có quyền xem dự án nào trên site {session.site.name}.
        </div>
      )}

      {projects !== null && projects.length > 0 && visible.length === 0 && (
        <div className="picker-empty">Không tìm thấy dự án nào phù hợp.</div>
      )}

      {visible.length > 0 && (
        <div className="project-list">
          {visible.map((p) => (
            <div
              key={p.id}
              className="project-row clickable-row"
              onClick={() => choosing === null && choose(p.key)}
            >
              {p.avatarUrl ? (
                <img className="project-avatar" src={p.avatarUrl} alt="" />
              ) : (
                <span className="project-avatar project-avatar-blank" aria-hidden="true" />
              )}
              <span className="project-key">{p.key}</span>
              <span className="project-name">{p.name}</span>
              {choosing === p.key && <span className="muted-inline">Đang mở...</span>}
            </div>
          ))}
        </div>
      )}

      <div className="modal-footer">
        <span className="picker-identity">
          Đang đăng nhập với tư cách {session.user.displayName}
        </span>
        <div className="spacer" />
        {error && <button onClick={() => setReloadToken((t) => t + 1)}>Thử lại</button>}
        <button onClick={onLogout}>Đăng xuất</button>
      </div>
    </>
  );

  if (variant === "modal") {
    return (
      <div className="modal-overlay" onClick={onCancel}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          {body}
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="modal picker-card">{body}</div>
    </div>
  );
}
