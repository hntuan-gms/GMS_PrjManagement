/**
 * Dragging work out of the plan, the board, Today or the resource tab into the assistant.
 *
 * A drag carries the issue keys under one custom type, plus `text/plain` ("GPM-1, GPM-2") so that
 * dropping on a plain text field still types something sensible. Which keys travel follows a file
 * manager: a row inside the selection takes the whole selection, any other row takes only itself.
 * `getData` is write-only while dragging in Chrome and Safari, so what is being dragged is also held
 * here, where the drop targets can read it to light up before the drop.
 */
import { useSyncExternalStore } from "react";

export const TASK_MIME = "application/x-gms-tasks";

/** Most issues one message may carry: the keys travel in the message text. */
export const MAX_ATTACHED_TASKS = 30;

/** The keys a drag of `key` carries: the whole selection (in list order) when the row is part of it. */
export function dragKeysFor(key: string, selected: ReadonlySet<string>, order: readonly string[]): string[] {
  if (!selected.has(key) || selected.size <= 1) return [key];
  const inOrder = order.filter((k) => selected.has(k));
  // A selected key that is not in the visible order (filtered out, collapsed) still goes along.
  const rest = [...selected].filter((k) => !inOrder.includes(k));
  const all = [...inOrder, ...rest];
  return all.includes(key) ? all : [key];
}

interface DragLike {
  dataTransfer: DataTransfer | null;
  types?: readonly string[];
}

/** True when what is being dragged is work from the app (works during dragover, where only `types` is readable). */
export function isTaskDrag(e: DragLike): boolean {
  const types = e.dataTransfer?.types;
  return !!types && Array.from(types).includes(TASK_MIME);
}

/** The keys of a finished drop, or [] when the drop was not work from the app. */
export function readTaskDrag(e: DragLike): string[] {
  try {
    const raw = e.dataTransfer?.getData(TASK_MIME);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((k): k is string => typeof k === "string" && /^[A-Z][A-Z0-9_]*-\d+$/.test(k));
  } catch {
    return [];
  }
}

/* ---- what is being dragged right now, for the drop targets to light up ---- */

let active: string[] | null = null;
const listeners = new Set<() => void>();
function setActive(next: string[] | null) {
  active = next;
  for (const fn of listeners) fn();
}

/** The keys under the cursor while a drag is under way, else null. */
export function useTaskDragging(): string[] | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => active,
    () => null
  );
}

/**
 * Begin a drag of `keys` on this `dragstart` event. `effectAllowed` is `copyMove` so the same drag
 * still moves a card between columns (their targets answer `move`) and copies into the assistant.
 */
export function startTaskDrag(e: { dataTransfer: DataTransfer | null }, keys: string[], label?: string) {
  const dt = e.dataTransfer;
  if (!dt || keys.length === 0) return;
  dt.effectAllowed = "copyMove";
  dt.setData(TASK_MIME, JSON.stringify(keys));
  dt.setData("text/plain", keys.join(", "));
  const ghost = dragImage(keys, label);
  if (ghost) dt.setDragImage(ghost, 12, 12);
  setActive(keys);
  const end = () => {
    window.removeEventListener("dragend", end, true);
    window.removeEventListener("drop", afterDrop, true);
    setActive(null);
  };
  // The drop target may be drawn only while a drag is on (the closed assistant's drop zone): clearing in the
  // capture phase of `drop` would remove it before the event reached it, so that one waits for the handlers.
  const afterDrop = () => window.setTimeout(end, 0);
  window.addEventListener("dragend", end, true);
  window.addEventListener("drop", afterDrop, true);
}

/** A small chip for the cursor: the key, or "n việc" for several, so a multi-drag looks like a bundle. */
function dragImage(keys: string[], label?: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const el = document.createElement("div");
  el.className = "task-drag-ghost";
  el.textContent = keys.length === 1 ? (label ? `${keys[0]}  ${label}` : keys[0]) : `${keys.length} việc`;
  document.body.appendChild(el);
  // The browser has taken its snapshot by the next frame; the element is only needed until then.
  setTimeout(() => el.remove(), 0);
  return el;
}
