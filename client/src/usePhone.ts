import { useSyncExternalStore } from "react";

/** The widest window that counts as a phone: below it the app is Hôm nay and the board as a list (rà soát 2026-11-07, 3.9). */
export const PHONE_MAX_WIDTH = 767;

const QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;

function subscribe(fn: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", fn);
  return () => mq.removeEventListener("change", fn);
}

export function usePhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}

/** What a phone can show: Hôm nay, the board (columns stacked, status changed in the panel) and the settings page. */
export function phoneView<V extends string>(view: V, phone: boolean): V | "today" {
  if (!phone) return view;
  return view === "today" || view === "board" || view === "settings" ? view : "today";
}
