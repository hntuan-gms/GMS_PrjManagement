import { useSyncExternalStore } from "react";

/**
 * Toasts: the one place a change reports back ("Đã chuyển DEMO-5 sang Đang làm · Hoàn tác").
 * A module-level store rather than context so any handler — a drag, a bulk run, the command
 * bar — can raise one without being threaded a callback. Bottom-left, so it never sits on the
 * selection bar (bottom centre) or the detail panel (right). See plan §5.6.
 */
export type ToastTone = "info" | "success" | "error";

export interface ToastAction {
  label: string;
  /** Shown beside the label, e.g. "Ctrl Z". */
  hint?: string;
  run: () => void;
}

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  /** Errors stay until dismissed; everything else leaves after `ms`. */
  sticky: boolean;
  ms: number;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => {
  for (const fn of listeners) fn();
};

/** At most three on screen; the oldest goes first. */
const MAX = 3;

export function toast(message: string, opts: { tone?: ToastTone; action?: ToastAction; sticky?: boolean; ms?: number } = {}): number {
  const tone = opts.tone ?? "info";
  const t: Toast = {
    id: nextId++,
    message,
    tone,
    action: opts.action,
    sticky: opts.sticky ?? tone === "error",
    ms: opts.ms ?? 5000,
  };
  toasts = [...toasts, t].slice(-MAX);
  emit();
  return t.id;
}

export function dismissToast(id: number) {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length !== toasts.length) {
    toasts = next;
    emit();
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const snapshot = () => toasts;

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
