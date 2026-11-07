import { useEffect, useState } from "react";
import { api } from "../api";
import type { Watchers } from "../types";
import { Icon } from "./Icons";

/**
 * Who follows the task in Jira, and a toggle for YOU. Only yourself: adding someone
 * else needs an admin permission this app never asks for, and "follow" is something a
 * person does for themselves. Whether the names are listed depends on a Jira
 * permission most people lack; without it only the count is known, and it says so.
 *
 * The detail panel shows the count in its header line and the toggle in its ⋯ menu, so this is a
 * hook (the state and the two calls) rather than a row of its own.
 */
export function useTaskWatchers(taskId: string) {
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
    if (!w || busy) return;
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

  return { watchers: w, busy, error, toggle };
}

/** "2" with a tooltip of who, or of why the names are missing. Nothing while unknown or nobody follows. */
export function WatcherCount({ watchers }: { watchers: Watchers | null }) {
  if (!watchers || watchers.count === 0) return null;
  const names = watchers.listed ? watchers.watchers.map((x) => x.displayName) : [];
  const title = names.length > 0 ? `${watchers.count} người theo dõi: ${names.join(", ")}` : watchers.listed ? `${watchers.count} người theo dõi` : `${watchers.count} người theo dõi (Jira không cho xem tên)`;
  return (
    <span className={`td-watchers${watchers.isWatching ? " is-on" : ""}`} title={title} aria-label={title}>
      <Icon name="eye" size={13} />
      {watchers.count}
    </span>
  );
}
