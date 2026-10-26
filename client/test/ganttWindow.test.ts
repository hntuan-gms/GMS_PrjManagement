import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BUFFER_ROWS,
  CHUNK_ROWS,
  WINDOW_THRESHOLD,
  axisSentinels,
  isSentinel,
  isWindowed,
  windowEnd,
  windowRows,
  windowStartFor,
} from "../src/ganttWindow";

const ROW = 42;
const VIEW = 20; // rows on screen

describe("gantt row window", () => {
  it("small projects are drawn whole", () => {
    assert.equal(isWindowed(WINDOW_THRESHOLD), false);
    assert.equal(isWindowed(WINDOW_THRESHOLD + 1), true);
  });

  it("at the top the window starts at 0", () => {
    assert.equal(windowStartFor(0, ROW, 3000, VIEW), 0);
    assert.equal(windowStartFor(ROW * 10, ROW, 3000, VIEW), 0);
  });

  it("always covers the viewport plus the buffer on both sides, wherever you scroll", () => {
    const count = 3000;
    for (let top = 0; top <= (count - VIEW) * ROW; top += ROW * 7 + 13) {
      const start = windowStartFor(top, ROW, count, VIEW);
      const end = windowEnd(start, count, VIEW);
      const firstVisible = Math.floor(top / ROW);
      const lastVisible = Math.min(count, firstVisible + VIEW + 1);
      assert(start <= Math.max(0, firstVisible - BUFFER_ROWS), `no buffer above at ${top}: start ${start}, first ${firstVisible}`);
      assert(end >= Math.min(count, lastVisible + BUFFER_ROWS), `no buffer below at ${top}: end ${end}, last ${lastVisible}`);
      assert.equal(start % CHUNK_ROWS === 0 || start === count - windowRows(VIEW), true);
    }
  });

  it("only moves in whole chunks, so scrolling does not re-render every row", () => {
    const starts = new Set<number>();
    for (let row = 0; row < 400; row++) starts.add(windowStartFor(row * ROW, ROW, 3000, VIEW));
    for (const s of starts) assert.equal(s % CHUNK_ROWS, 0);
    assert(starts.size < 400 / CHUNK_ROWS + 2);
  });

  it("the window never runs past the end of the list", () => {
    const count = 500;
    const start = windowStartFor(count * ROW * 2, ROW, count, VIEW);
    assert.equal(windowEnd(start, count, VIEW), count);
    assert.equal(start, count - windowRows(VIEW));
  });

  it("a list shorter than the window is drawn from its first row", () => {
    assert.equal(windowStartFor(999999, ROW, 60, VIEW), 0);
    assert.equal(windowEnd(0, 60, VIEW), 60);
  });
});

describe("axis sentinels", () => {
  const d = (s: string) => new Date(`${s}T00:00:00`);
  const make = (id: string, start: Date, end: Date) => ({ id, start, end });

  it("pin the date axis to the whole list: earliest start and latest end", () => {
    const all = [
      { id: "a", start: d("2026-03-10"), end: d("2026-03-12") },
      { id: "b", start: d("2026-01-05"), end: d("2026-01-06") },
      { id: "c", start: d("2026-08-01"), end: d("2026-09-30") },
    ];
    const [first, last] = axisSentinels(all, make);
    assert(isSentinel(first.id) && isSentinel(last.id));
    assert.equal(first.start.getTime(), d("2026-01-05").getTime());
    assert.equal(last.end.getTime(), d("2026-09-30").getTime());
  });

  it("nothing to pin for an empty list, and real ids are never mistaken for sentinels", () => {
    assert.deepEqual(axisSentinels([], make), []);
    assert.equal(isSentinel("DEMO-1"), false);
  });
});
