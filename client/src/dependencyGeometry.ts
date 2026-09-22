import type { DependencyType } from "./types";

export interface BarRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

/** How far a connector leaves a bar before it is allowed to turn. */
const STUB = 14;
/** Vertical clearance used when a connector has to route around its own bar. */
const GAP = 10;
/** Corner rounding, clamped per corner to half the shorter adjoining segment. */
const RADIUS = 5;

/** Which edge each end of a link attaches to, and which way the arrowhead points. */
const ENDS: Record<DependencyType, { from: "start" | "end"; to: "start" | "end" }> = {
  FS: { from: "end", to: "start" },
  SS: { from: "start", to: "start" },
  FF: { from: "end", to: "end" },
  SF: { from: "start", to: "end" },
};

/** The (x, y) of a bar's Start (left) or Finish (right) anchor, vertically centred. */
export function anchorPoint(rect: BarRect, edge: "start" | "end"): Point {
  return { x: edge === "start" ? rect.x : rect.x + rect.width, y: rect.y + rect.height / 2 };
}

function arrowHead(x: number, y: number, pointing: "right" | "left"): string {
  const s = 5;
  return pointing === "right"
    ? `${x},${y} ${x - s},${y - s} ${x - s},${y + s}`
    : `${x},${y} ${x + s},${y - s} ${x + s},${y + s}`;
}

/** Drops repeated points and any vertex that just continues a straight run. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push(p);
  }
  for (let i = 1; i < out.length - 1; ) {
    const [a, b, c] = [out[i - 1], out[i], out[i + 1]];
    const straight =
      (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) ||
      (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5);
    if (straight) out.splice(i, 1);
    else i++;
  }
  return out;
}

function towards(from: Point, to: Point, distance: number): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return {
    x: from.x + ((to.x - from.x) / length) * distance,
    y: from.y + ((to.y - from.y) / length) * distance,
  };
}

/** An orthogonal polyline as an SVG path, with the corners rounded off. */
function toPath(points: Point[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [prev, corner, next] = [points[i - 1], points[i], points[i + 1]];
    const radius = Math.min(
      RADIUS,
      Math.hypot(corner.x - prev.x, corner.y - prev.y) / 2,
      Math.hypot(next.x - corner.x, next.y - corner.y) / 2
    );
    if (radius < 0.5) {
      d += ` L ${corner.x} ${corner.y}`;
      continue;
    }
    const into = towards(corner, prev, radius);
    const outOf = towards(corner, next, radius);
    d += ` L ${into.x} ${into.y} Q ${corner.x} ${corner.y} ${outOf.x} ${outOf.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

/** A horizontal lane clear of both bars, for links that must route around. */
function laneBetween(pred: BarRect, succ: BarRect): number {
  const predBottom = pred.y + pred.height;
  const succBottom = succ.y + succ.height;
  if (succ.y >= predBottom) return (predBottom + succ.y) / 2; // successor below
  if (pred.y >= succBottom) return (succBottom + pred.y) / 2; // successor above
  return predBottom + GAP; // same row — duck underneath
}

/** Midpoint of the longest segment: the calmest place to hang a label or popover. */
function anchorForLabel(points: Point[]): Point {
  let best = points[0];
  let bestLength = -1;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > bestLength) {
      bestLength = length;
      best = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  return best;
}

export interface DependencyPath {
  path: string;
  arrow: string;
  /** Where to anchor a popover for this link. */
  label: Point;
}

/**
 * Routes one FS/SS/FF/SF link as a proper orthogonal connector.
 *
 * Both ends leave their bar straight out along a stub, so the link always reads
 * as attached to a specific edge — which edge is what distinguishes the four
 * types. Between the stubs it takes the shortest route that stays orthogonal:
 *
 *  - If a single vertical run can join them without either end doubling back
 *    through its own bar, it uses that (three segments, or one straight line
 *    when the two bars share a row).
 *  - Otherwise the ends face away from each other — a successor scheduled to the
 *    left of its predecessor, say — and it routes around through a horizontal
 *    lane in the gap between the two rows, five segments. The old code drew a
 *    single line straight across the chart in that case, cutting through
 *    whatever bars lay between.
 */
export function buildDependencyPath(
  type: DependencyType,
  pred: BarRect,
  succ: BarRect
): DependencyPath {
  const ends = ENDS[type];
  const start = anchorPoint(pred, ends.from);
  const end = anchorPoint(succ, ends.to);

  // Which way each end points: out of the predecessor's edge, and into the
  // successor's edge from the outside.
  const outward = ends.from === "end" ? 1 : -1;
  const approach = ends.to === "start" ? -1 : 1;
  const pointing = ends.to === "start" ? "right" : "left";

  const stubOut = { x: start.x + outward * STUB, y: start.y };
  const stubIn = { x: end.x + approach * STUB, y: end.y };

  // A single vertical run works only at an x that both ends can reach without
  // reversing: at or beyond the outgoing stub, and on the approach side of the
  // incoming one.
  const lowest = Math.max(
    outward > 0 ? stubOut.x : Number.NEGATIVE_INFINITY,
    approach > 0 ? stubIn.x : Number.NEGATIVE_INFINITY
  );
  const highest = Math.min(
    outward < 0 ? stubOut.x : Number.POSITIVE_INFINITY,
    approach < 0 ? stubIn.x : Number.POSITIVE_INFINITY
  );

  let points: Point[];
  if (lowest <= highest) {
    // Hug the successor: turn as late as possible so the link runs alongside the
    // predecessor's row rather than cutting across the middle of the chart.
    const turnX = approach < 0 ? highest : lowest;
    points = [start, { x: turnX, y: start.y }, { x: turnX, y: end.y }, end];
  } else {
    const lane = laneBetween(pred, succ);
    points = [
      start,
      stubOut,
      { x: stubOut.x, y: lane },
      { x: stubIn.x, y: lane },
      stubIn,
      end,
    ];
  }

  const simplified = simplify(points);
  return {
    path: toPath(simplified),
    arrow: arrowHead(end.x, end.y, pointing),
    label: anchorForLabel(simplified),
  };
}
