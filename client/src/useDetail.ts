import { useEffect, useReducer, useRef, useState } from "react";
import { dropDetail, loadDetail, peekDetail, putDetail, subscribeDetail } from "./detailCache";

/**
 * One read of the task panel's data through detailCache: the held answer is there on the first render
 * (`value`), the read behind it replaces it when it lands, and `loading` is true only when there is
 * nothing to show yet. `set` writes an answer the panel produced itself (a comment sent, a file added).
 */
export function useDetail<T>(kind: string, id: string, fetcher: () => Promise<T>, maxAgeMs: number, enabled = true) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  // Which read the message belongs to, so a refusal for one task is never shown under the next.
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const fetchRef = useRef(fetcher);
  useEffect(() => {
    fetchRef.current = fetcher;
  });
  const key = `${kind}|${id}`;

  useEffect(() => subscribeDetail(kind, id, rerender), [kind, id]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadDetail(kind, id, () => fetchRef.current(), maxAgeMs).then(
      () => alive && setFailure((f) => (f?.key === key ? null : f)),
      (e) => alive && setFailure({ key, message: e instanceof Error ? e.message : "Không tải được." })
    );
    return () => {
      alive = false;
    };
  }, [kind, id, key, maxAgeMs, enabled]);

  const value = peekDetail<T>(kind, id);
  const error = failure?.key === key ? failure.message : null;
  return {
    value,
    loading: enabled && value === undefined && !error,
    error,
    /** Read again now, keeping what is shown until the answer lands. */
    reload: () => loadDetail(kind, id, () => fetchRef.current(), 0).catch(() => undefined),
    /** Replace what is held (and shown). */
    set: (next: T) => putDetail(kind, id, next),
    /** Forget it; the next read starts from nothing. */
    drop: () => dropDetail(kind, id),
  };
}
