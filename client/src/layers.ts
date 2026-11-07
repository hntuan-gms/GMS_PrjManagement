/**
 * Everything that lays over the page (dialogs, side sheets, pickers, the command bar) registers here, so the
 * two questions "is something open?" and "what does Esc close?" have one answer instead of one per component.
 *
 * - `overlayOpen()` (shortcuts.ts) reads `isOpen()`, so letter keys, Ctrl K, Ctrl P stand down behind a layer.
 * - One `keydown` on `window`, registered when this module loads (so it runs before the workspace's own Esc
 *   handler, which was added later), gives Esc to the top layer if that layer has an `onEscape`. A layer
 *   whose component already handles Esc itself (and stops it) never reaches here; one registered without
 *   `onEscape` only blocks shortcuts and lets Esc through to whoever listens.
 * - `dismissForNavigation()` is for a rail button pressed while a sheet is open: the sheet closes (and saves,
 *   if its `onEscape` does), then the button does its job.
 *
 * Pure but for the one window listener, so the stack can be tested without a DOM.
 */
export interface LayerOptions {
  /** Called when Esc reaches this layer while it is on top. Absent: the layer does not take Esc. */
  onEscape?: () => void;
  /** Closed by `dismissForNavigation()` too (sheets); dialogs that must be answered stay. */
  dismissOnNav?: boolean;
}

interface Layer extends LayerOptions {
  id: string;
  token: symbol;
}

let stack: Layer[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Registers a layer; the returned function removes exactly this registration. */
export function push(id: string, options: LayerOptions = {}): () => void {
  const layer: Layer = { id, token: Symbol(id), ...options };
  stack = [...stack, layer];
  emit();
  return () => {
    const before = stack.length;
    stack = stack.filter((l) => l.token !== layer.token);
    if (stack.length !== before) emit();
  };
}

/** Removes the most recent layer with this id. Naming one that is not open does nothing. */
export function pop(id: string): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].id === id) {
      stack = [...stack.slice(0, i), ...stack.slice(i + 1)];
      emit();
      return;
    }
  }
}

export function top(): { id: string } | null {
  const l = stack.at(-1);
  return l ? { id: l.id } : null;
}

export function isOpen(...except: string[]): boolean {
  return stack.some((l) => !except.includes(l.id));
}

export function openIds(): string[] {
  return stack.map((l) => l.id);
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Esc: gives it to the top layer. Returns true if that layer took it. */
export function escape(): boolean {
  const l = stack.at(-1);
  if (!l?.onEscape) return false;
  l.onEscape();
  return true;
}

/** Closes every sheet that agrees to be closed by navigating elsewhere, topmost first. */
export function dismissForNavigation(): void {
  for (const l of [...stack].reverse()) {
    if (l.dismissOnNav && l.onEscape) l.onEscape();
  }
}

/** Test seam. */
export function resetLayers(): void {
  stack = [];
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (escape()) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  });
}
