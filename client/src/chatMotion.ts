import { launchOrigin, type Rect } from "./windowGeometry";

/**
 * How the assistant's window appears and goes away: it grows out of the rail button that opens it, and
 * shrinks back into it. Only `transform` and `opacity` move (Web Animations API, so the browser runs it
 * off the main thread and nothing in the conversation re-renders); the parts of the window then arrive one
 * after another, a beat behind the frame, so the text is never seen squeezed while the frame is small.
 * A phone has no button to come from: the sheet slides up from the bottom edge.
 */

const OPEN_MS = 480;
const CLOSE_MS = 260;
// Leaves the button gently and decelerates into place (a steeper start reads as a pop, not as being pulled
// out). Closing is quicker and accelerates away.
const EASE_OPEN = "cubic-bezier(0.3, 0.7, 0.2, 1)";
const EASE_CLOSE = "cubic-bezier(0.4, 0, 0.8, 0.3)";
const EASE_PART = "cubic-bezier(0.23, 1, 0.32, 1)";
/** The pieces of the window and how late each one arrives (ms) and how far it rises. */
const PARTS: Array<[selector: string, delay: number, rise: number]> = [
  [".chat-dock-header", 70, 0],
  [".chat-messages-wrap", 120, 6],
  [".chat-composer-wrap", 170, 10],
];

export function motionAllowed(): boolean {
  try {
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches && typeof Element.prototype.animate === "function";
  } catch {
    return false;
  }
}

/** The button that opens the assistant, wherever it is on the page. */
function launcherRect(): Rect | null {
  const el = document.querySelector<HTMLElement>('.app-rail [data-view="assistant"]');
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return b.width > 0 ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
}

function boxOf(el: HTMLElement): Rect {
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

export interface Run {
  /** Resolves when the movement is over; rejects if it was cancelled. */
  finished: Promise<unknown>;
  cancel: () => void;
}

function runOf(anims: Animation[]): Run {
  return {
    finished: Promise.all(anims.map((a) => a.finished)),
    cancel: () => anims.forEach((a) => a.cancel()),
  };
}

export function playOpen(el: HTMLElement, phone: boolean): Run {
  if (phone) {
    return runOf([
      el.animate(
        [
          { transform: "translateY(28px)", opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 260, easing: EASE_PART }
      ),
    ]);
  }
  const { ox, oy, scale } = launchOrigin(boxOf(el), launcherRect());
  const origin = `${ox}px ${oy}px`;
  const frame = el.animate(
    [
      { transformOrigin: origin, transform: `translateY(10px) scale(${scale})`, opacity: 0 },
      { transformOrigin: origin, opacity: 1, offset: 0.3 },
      { transformOrigin: origin, transform: "none", opacity: 1 },
    ],
    { duration: OPEN_MS, easing: EASE_OPEN }
  );
  const parts = PARTS.flatMap(([selector, delay, rise]) => {
    const part = el.querySelector<HTMLElement>(selector);
    if (!part) return [];
    return [
      part.animate(
        [
          { opacity: 0, transform: `translateY(${rise}px)` },
          { opacity: 1, transform: "none" },
        ],
        { duration: 240, delay, easing: EASE_PART, fill: "backwards" }
      ),
    ];
  });
  return runOf([frame, ...parts]);
}

/** The reverse. The window stays hidden once it ends (`fill`), so it can be removed on `finished`. */
export function playClose(el: HTMLElement, phone: boolean): Run {
  if (phone) {
    return runOf([
      el.animate(
        [
          { transform: "none", opacity: 1 },
          { transform: "translateY(28px)", opacity: 0 },
        ],
        { duration: 200, easing: EASE_CLOSE, fill: "forwards" }
      ),
    ]);
  }
  const { ox, oy, scale } = launchOrigin(boxOf(el), launcherRect());
  const origin = `${ox}px ${oy}px`;
  return runOf([
    el.animate(
      [
        { transformOrigin: origin, transform: "none", opacity: 1 },
        { transformOrigin: origin, opacity: 1, offset: 0.55 },
        { transformOrigin: origin, transform: `translateY(10px) scale(${scale})`, opacity: 0 },
      ],
      { duration: CLOSE_MS, easing: EASE_CLOSE, fill: "forwards" }
    ),
  ]);
}
