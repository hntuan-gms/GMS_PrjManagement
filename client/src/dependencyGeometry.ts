import type { DependencyType } from "./types";

export interface BarRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How far a looping connector (SS/FF/SF) travels past a bar's edge before turning. */
const LOOP = 16;

function arrowHead(x: number, y: number, pointing: "right" | "left"): string {
  const s = 5;
  return pointing === "right"
    ? `${x},${y} ${x - s},${y - s} ${x - s},${y + s}`
    : `${x},${y} ${x + s},${y - s} ${x + s},${y + s}`;
}

/**
 * One elbow-connector path per dependency type, per the FS/SS/FF/SF spec:
 * - FS: predecessor's Finish (right edge)  -> successor's Start (left edge)
 * - SS: predecessor's Start (left edge)    -> successor's Start (left edge), looping
 *       out to the left of both bars (a "C" hook)
 * - FF: predecessor's Finish (right edge)  -> successor's Finish (right edge),
 *       looping out to the right of both bars (a reverse "C" hook)
 * - SF: predecessor's Start (left edge)    -> successor's Finish (right edge)
 * The arrowhead always points INTO the successor's anchor edge: rightward into a
 * Start (left edge), leftward into a Finish (right edge).
 */
export function buildDependencyPath(
  type: DependencyType,
  pred: BarRect,
  succ: BarRect
): { path: string; arrow: string } {
  const predCY = pred.y + pred.height / 2;
  const succCY = succ.y + succ.height / 2;
  const predLeft = pred.x;
  const predRight = pred.x + pred.width;
  const succLeft = succ.x;
  const succRight = succ.x + succ.width;

  switch (type) {
    case "FS": {
      const startX = predRight;
      const startY = predCY;
      const endX = succLeft;
      const endY = succCY;
      const path =
        endX >= startX + LOOP
          ? `M ${startX} ${startY} H ${Math.max(startX + LOOP, endX - LOOP)} V ${endY} H ${endX}`
          : `M ${startX} ${startY} H ${startX + LOOP} V ${endY} H ${endX - LOOP} V ${endY} H ${endX}`;
      return { path, arrow: arrowHead(endX, endY, "right") };
    }
    case "SS": {
      const startX = predLeft;
      const startY = predCY;
      const endX = succLeft;
      const endY = succCY;
      const outX = Math.min(startX, endX) - LOOP;
      return {
        path: `M ${startX} ${startY} H ${outX} V ${endY} H ${endX}`,
        arrow: arrowHead(endX, endY, "right"),
      };
    }
    case "FF": {
      const startX = predRight;
      const startY = predCY;
      const endX = succRight;
      const endY = succCY;
      const outX = Math.max(startX, endX) + LOOP;
      return {
        path: `M ${startX} ${startY} H ${outX} V ${endY} H ${endX}`,
        arrow: arrowHead(endX, endY, "left"),
      };
    }
    case "SF": {
      const startX = predLeft;
      const startY = predCY;
      const endX = succRight;
      const endY = succCY;
      const outX = Math.min(startX, endX) - LOOP;
      return {
        path: `M ${startX} ${startY} H ${outX} V ${endY} H ${endX}`,
        arrow: arrowHead(endX, endY, "left"),
      };
    }
  }
}

/** The (x, y) of a bar's Start (left) or Finish (right) anchor, vertically centred. */
export function anchorPoint(rect: BarRect, edge: "start" | "end"): { x: number; y: number } {
  return { x: edge === "start" ? rect.x : rect.x + rect.width, y: rect.y + rect.height / 2 };
}
