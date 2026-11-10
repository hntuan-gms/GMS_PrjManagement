import { Fragment, useEffect, useMemo, useState } from "react";
import Spinner from "./Spinner";
import { fold } from "../csvImport";
import { api } from "../api";
import type { ProjectSummary, Session } from "../types";
import { useLayer } from "../useLayer";
import { Icon } from "./Icons";
import { readViewCache, viewCacheScope, writeViewCache } from "../viewCache";

interface Props {
  session: Session;
  /** "page" is the post-login step; "modal" is the toolbar's "Đổi dự án". */
  variant: "page" | "modal";
  onSelect: (key: string) => Promise<void>;
  onCancel?: () => void;
  onLogout: () => void;
}

export default function ProjectPicker({ session, variant, onSelect, onCancel, onLogout }: Props) {
  // The list this account saw last time (viewCache.ts, survives F5) is shown at once while the fresh one is
  // fetched: with hundreds of projects the listing is several Jira pages, and "Đổi dự án" waited for all of
  // them every time.
  // Esc and the keys behind it: a modal picker is a layer like any other (layers.ts).
  useLayer("project-picker", variant === "modal", { onEscape: onCancel });
  const cacheScope = viewCacheScope(session.site.cloudId, session.user.accountId, "");
  const [projects, setProjects] = useState<ProjectSummary[] | null>(
    () => readViewCache<ProjectSummary[]>(cacheScope, "projects", "") ?? null
  );
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [choosing, setChoosing] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .listProjects()
      .then((list) => {
        writeViewCache(cacheScope, "projects", "", list);
        if (!cancelled) setProjects(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Không tải được danh sách dự án.");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken, cacheScope]);

  // The projects this person opened last on this site come first (Ctrl P is mostly "go back to X").
  const recentKey = `gms.recentProjects.${session.site.cloudId}`;
  const [recent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(recentKey) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const isRecent = (k: string) => recent.includes(k);
  const visible = useMemo(() => {
    if (!projects) return [];
    const q = fold(filter);
    const rank = (k: string) => {
      const i = recent.indexOf(k);
      return i === -1 ? Infinity : i;
    };
    const list = q ? projects.filter((p) => fold(`${p.key} ${p.name}`).includes(q)) : projects;
    return [...list].sort((a, b) => rank(a.key) - rank(b.key));
  }, [projects, filter, recent]);

  async function choose(key: string) {
    try {
      localStorage.setItem(recentKey, JSON.stringify([key, ...recent.filter((k) => k !== key)].slice(0, 5)));
    } catch {
      /* private mode */
    }
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
        </div>
        {onCancel && (
          <button className="modal-close" onClick={onCancel} aria-label="Đóng">
            ×
          </button>
        )}
      </div>

      <label className="field">
        <input
          autoFocus
          aria-label="Tìm dự án"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(visible.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && visible[active] && choosing === null) {
              e.preventDefault();
              void choose(visible[active].key);
            }
          }}
          placeholder="Search projects"
        />
      </label>

      {error && <div className="modal-error">{error}</div>}

      {projects === null && !error && <Spinner block />}

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
          {visible.map((p, i) => (
            <Fragment key={p.id}>
              {!filter && i === 0 && isRecent(p.key) && <div className="project-group-label">Gần đây</div>}
              {!filter && i > 0 && !isRecent(p.key) && isRecent(visible[i - 1].key) && <div className="project-group-label">Tất cả</div>}
            <div
              className={`project-row clickable-row ${i === active ? "is-active" : ""}`}
              ref={i === active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
              onClick={() => choosing === null && choose(p.key)}
              onMouseMove={() => i !== active && setActive(i)}
            >
              {p.avatarUrl && <img className="project-avatar" src={p.avatarUrl} alt="" />}
              <span className="project-key">{p.key}</span>
              <span className="project-name">{p.name}</span>
              {session.project?.key === p.key && (
                <span className="project-current" role="img" aria-label="Đang mở">
                  <Icon name="check" size={14} />
                </span>
              )}
              {choosing === p.key && <span className="muted-inline">Đang mở...</span>}
            </div>
            </Fragment>
          ))}
        </div>
      )}

      <div className="modal-footer">
        <span className="picker-identity">
          Đang đăng nhập với tư cách {session.user.displayName}
        </span>
        <div className="spacer" />
        {error && <button onClick={() => setReloadToken((t) => t + 1)}>Thử lại</button>}
        {variant === "page" && <button onClick={onLogout}>Đăng xuất</button>}
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
