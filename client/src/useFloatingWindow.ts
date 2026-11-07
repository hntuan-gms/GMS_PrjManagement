import { useCallback, useEffect, useRef, useState } from "react";
import { clampRect, defaultRect, maximizedRect, parseRect, resizeRect, type Edge, type Rect } from "./windowGeometry";

/**
 * A window that can be dragged by its title bar and resized from any edge, like one in an operating
 * system, and remembers where it was left. While a drag is under way the element's style is written
 * directly and React is told only at the end: the window holds a whole conversation, and re-rendering
 * it on every pointer move is what makes a dragged panel stutter.
 */
const STORAGE_KEY = "gms.chat.window";

function viewport() {
  return { vw: window.innerWidth, vh: window.innerHeight };
}

function readSaved(): Rect | null {
  try {
    return parseRect(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function save(r: Rect) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(r));
  } catch {
    // Private mode: the window just opens in its default place next time.
  }
}

function railWidth(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--rail-w");
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 56;
}

export function useFloatingWindow(enabled: boolean) {
  const elRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect>(() => {
    const { vw, vh } = viewport();
    const saved = readSaved();
    return saved ? clampRect(saved, vw, vh) : defaultRect(vw, vh);
  });
  const [maximized, setMaximized] = useState(false);
  const [busy, setBusy] = useState<"move" | "resize" | null>(null);
  const restore = useRef<Rect | null>(null);
  const rectRef = useRef(rect);
  rectRef.current = rect;

  const paint = (r: Rect) => {
    const el = elRef.current;
    if (!el) return;
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
  };

  const commit = useCallback((r: Rect, remember = true) => {
    setRect(r);
    rectRef.current = r;
    if (remember) save(r);
  }, []);

  // The window stays inside the browser when the browser is made smaller.
  useEffect(() => {
    if (!enabled) return;
    function onResize() {
      const { vw, vh } = viewport();
      setRect((r) => (maximized ? maximizedRect(vw, vh, railWidth()) : clampRect(r, vw, vh)));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [enabled, maximized]);

  function drag(e: React.PointerEvent, onMove: (dx: number, dy: number) => Rect, kind: "move" | "resize") {
    if (!enabled || e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    let last = rectRef.current;
    setBusy(kind);
    const move = (ev: PointerEvent) => {
      last = onMove(ev.clientX - startX, ev.clientY - startY);
      paint(last);
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      setBusy(null);
      commit(last, !maximized);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  /** Pointer down on the title bar: buttons, fields and links in it keep their own click. */
  const startMove = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, input, textarea, select, a, [data-nodrag]")) return;
    if (maximized) return;
    const start = rectRef.current;
    const { vw, vh } = viewport();
    drag(e, (dx, dy) => clampRect({ ...start, x: start.x + dx, y: start.y + dy }, vw, vh), "move");
  };

  const startResize = (edge: Edge) => (e: React.PointerEvent) => {
    if (maximized) return;
    e.stopPropagation();
    const start = rectRef.current;
    const { vw, vh } = viewport();
    drag(e, (dx, dy) => resizeRect(start, edge, dx, dy, vw, vh), "resize");
  };

  const toggleMaximized = useCallback(() => {
    const { vw, vh } = viewport();
    if (maximized) {
      setMaximized(false);
      commit(restore.current ?? defaultRect(vw, vh), false);
    } else {
      restore.current = rectRef.current;
      setMaximized(true);
      commit(maximizedRect(vw, vh, railWidth()), false);
    }
  }, [maximized, commit]);

  const reset = useCallback(() => {
    const { vw, vh } = viewport();
    setMaximized(false);
    commit(defaultRect(vw, vh));
  }, [commit]);

  return { elRef, rect, maximized, busy, startMove, startResize, toggleMaximized, reset };
}
