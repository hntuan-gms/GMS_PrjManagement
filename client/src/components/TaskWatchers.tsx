import { useEffect, useState } from "react";
import { api } from "../api";
import type { Watchers } from "../types";

/**
 * Who follows the task in Jira, and a toggle for YOU. Only yourself: adding someone
 * else needs an admin permission this app never asks for, and "follow" is something a
 * person does for themselves. Whether the names are listed depends on a Jira
 * permission most people lack; without it only the count is known, and it says so.
 */
export default function TaskWatchers({ taskId }: { taskId: string }) {
  const [w, setW] = useState<Watchers | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getTaskWatchers(taskId)
      .then((x) => alive && setW(x))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Không tải được người theo dõi."));
    return () => {
      alive = false;
    };
  }, [taskId]);

  async function toggle() {
    if (!w) return;
    setBusy(true);
    setError(null);
    try {
      setW(await api.setTaskWatching(taskId, !w.isWatching));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đổi được trạng thái theo dõi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field td-row">
      <span>Người theo dõi</span>
      <div className="watchers">
        <button type="button" className={w?.isWatching ? "is-on" : ""} onClick={toggle} disabled={!w || busy} aria-pressed={!!w?.isWatching}>
          {w?.isWatching ? "✓ Đang theo dõi" : "Theo dõi"}
        </button>
        {w && (
          <span
            className="muted"
            title={w.listed ? w.watchers.map((x) => x.displayName).join(", ") : undefined}
          >
            {w.count} người{w.listed ? (w.watchers.length > 0 ? ": " + w.watchers.map((x) => x.displayName).join(", ") : "") : " (Jira không cho xem danh sách)"}
          </span>
        )}
        {!w && !error && <span className="muted">Đang tải…</span>}
      </div>
      {error && <small className="field-note is-error">{error}</small>}
    </div>
  );
}
