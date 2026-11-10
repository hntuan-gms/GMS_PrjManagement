import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { placeHoverCard } from "../hoverCardPosition";

/*
 * The card shown while hovering a Gantt bar, drawn beside the pointer (see hoverCardPosition.ts for why not
 * where the library puts it). The pointer is tracked once for the whole page; a card reads it when it opens.
 * It is a portal on <body>, position: fixed, so no scrolled or clipped ancestor can move or hide it.
 */

const pointer = { x: 0, y: 0 };
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointermove",
    (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    },
    { capture: true, passive: true }
  );
}

export default function HoverCard({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  // Measured once it is in the DOM (its size depends on the text), before the first paint, so it is never
  // seen in the wrong place. The card stays where it opened: the pointer is on its bar and the text changes
  // only while a bar is dragged.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAt(placeHoverCard(pointer, { width: r.width, height: r.height }, { width: window.innerWidth, height: window.innerHeight }));
  }, []);

  return createPortal(
    <div ref={ref} className="gantt-tip gantt-tip-float" style={at ? { left: at.x, top: at.y } : { left: 0, top: 0, visibility: "hidden" }}>
      {children}
    </div>,
    document.body
  );
}
