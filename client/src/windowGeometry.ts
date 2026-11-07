/**
 * Geometry of the assistant's floating window, pure so it can be tested: where it opens, how far it may
 * be dragged or resized, and where it steps aside to when the task panel docks on the right.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_W = 340;
export const MIN_H = 360;
/**
 * How much of the window must stay on screen. The title (the part that is grabbed) sits on the left of the bar and
 * the buttons on the right, so a window pushed off the left edge keeps enough of its right side to show the end of
 * the title as well; one pushed off the right keeps its left side, which is the title itself.
 */
const KEEP_WHEN_LEFT = 260;
const KEEP_WHEN_RIGHT = 120;
const MARGIN = 16;

export function defaultRect(vw: number, vh: number): Rect {
  const w = Math.min(420, Math.max(MIN_W, vw - MARGIN * 2));
  const h = Math.min(620, Math.max(MIN_H, vh - 96));
  return clampRect({ x: Math.max(0, vw - w - 24), y: Math.max(0, vh - h - 24), w, h }, vw, vh);
}

/** Size within [min, viewport]; position so that the title bar stays on screen and grabbable. */
export function clampRect(r: Rect, vw: number, vh: number): Rect {
  const w = Math.max(Math.min(MIN_W, vw), Math.min(r.w, vw));
  const h = Math.max(Math.min(MIN_H, vh), Math.min(r.h, vh));
  const x = Math.min(Math.max(r.x, Math.min(KEEP_WHEN_LEFT, w) - w), vw - KEEP_WHEN_RIGHT);
  const y = Math.min(Math.max(r.y, 0), vh - 40);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

export type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** The rect after dragging `edge` by (dx, dy) from `start`; the opposite edge stays put and the minimum size holds. */
export function resizeRect(start: Rect, edge: Edge, dx: number, dy: number, vw: number, vh: number): Rect {
  let { x, y, w, h } = start;
  if (edge.includes("e")) w = start.w + dx;
  if (edge.includes("s")) h = start.h + dy;
  if (edge.includes("w")) {
    w = start.w - dx;
    x = start.x + dx;
    if (w < MIN_W) {
      x = start.x + start.w - MIN_W;
      w = MIN_W;
    }
  }
  if (edge.includes("n")) {
    h = start.h - dy;
    y = start.y + dy;
    if (h < MIN_H) {
      y = start.y + start.h - MIN_H;
      h = MIN_H;
    }
  }
  w = Math.max(MIN_W, w);
  h = Math.max(MIN_H, h);
  return clampRect({ x, y, w, h }, vw, vh);
}

/** The width the task panel takes on the right (mirrors `--peek-w` and the 1200px breakpoint in peek.css). */
export function peekWidth(vw: number): number {
  return Math.min(vw, Math.min(480, Math.max(400, vw * 0.34)));
}

/**
 * The window moved left of the docked task panel when it would sit on top of it, else null.
 * Opening a task from a reply must not hide the very conversation that pointed at it.
 */
export function stepAsideOfPeek(r: Rect, vw: number, vh: number): Rect | null {
  if (vw < 1201) return null;
  const left = vw - peekWidth(vw);
  if (r.x + r.w <= left) return null;
  const x = left - r.w - 12;
  if (x < 8) return null;
  return clampRect({ ...r, x }, vw, vh);
}

/** Full-window size beside the rail, for the "mở rộng" toggle. */
export function maximizedRect(vw: number, vh: number, railW: number): Rect {
  return clampRect({ x: railW + MARGIN, y: MARGIN, w: vw - railW - MARGIN * 2, h: vh - MARGIN * 2 }, vw, vh);
}

export function parseRect(raw: string | null): Rect | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Rect>;
    if ([v.x, v.y, v.w, v.h].every((n) => typeof n === "number" && Number.isFinite(n))) return v as Rect;
  } catch {
    // A damaged entry is the same as none.
  }
  return null;
}
