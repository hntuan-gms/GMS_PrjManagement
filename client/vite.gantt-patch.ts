import type { Plugin } from "vite";

/**
 * gantt-task-react keeps its scroll position in React state and re-renders its whole
 * tree on every wheel event — every bar, every grid row, every calendar cell, O(rows)
 * per frame. With a few hundred rows the chart stutters while scrolling sideways or down
 * (e2e/perf-scroll.mjs measures it). Scrolling changes none of what those parts draw:
 * TaskGantt only passes scrollX/scrollY to its own two effects.
 *
 * One more cause is upstream of those: the effect that rebuilds every bar and the whole
 * date range (convertToBarTasks, seedDates) lists `scrollX` among its dependencies, which
 * only right-to-left layouts need. Left-to-right, every wheel event re-ran O(rows) work
 * AND handed the children a fresh `tasks` array, so the memo below could never hit.
 * It also made horizontal scrolling fight itself: each wheel step re-rendered the chart
 * before the next one, so steps computed from a stale position and the scrollbar echoed
 * it back (the "khựng" — in the worst case React's "Maximum update depth exceeded").
 *
 * So the three heavy children are wrapped in React.memo. Their props are values that
 * stay identical across a scroll, with one exception: `setSelectedTask` is a closure
 * the library rebuilds on every render. It reads `barTasks` and `selectedTask`, which
 * arrive as the `tasks` and `selectedTask` props and ARE compared, so skipping the
 * function's identity cannot leave a stale closure behind. Every other prop is
 * compared by identity, so a re-render of GanttView (new callbacks) or of the library
 * (a drag, a selection) still goes through as before.
 *
 * Done as a build-time text patch rather than a fork or patch-package: it is a handful
 * of lines, it needs no install step, and it FAILS THE BUILD if a library upgrade moves
 * the code it expects, instead of silently going back to being slow.
 */
const LIBRARY = /gantt-task-react[\\/]dist[\\/]index\.modern\.js$/;

const MEMOS = `
// --- gms patch (client/vite.gantt-patch.ts): scrolling must not re-render the chart ---
var gmsSameProps = function (prev, next) {
  var keys = Object.keys(prev).concat(Object.keys(next));
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k === "setSelectedTask") continue;
    if (prev[k] !== next[k]) return false;
  }
  return true;
};
var MemoCalendar = React.memo(Calendar);
var MemoGrid = React.memo(Grid);
var MemoTaskGanttContent = React.memo(TaskGanttContent, gmsSameProps);
// --- end gms patch ---

`;

const EDITS: Array<[string, string]> = [
  [
    "milestoneBackgroundColor, milestoneBackgroundSelectedColor, rtl, scrollX, onExpanderClick]);",
    "milestoneBackgroundColor, milestoneBackgroundSelectedColor, rtl, rtl ? scrollX : 0, onExpanderClick]);",
  ],
  ["var TaskGantt = function TaskGantt(_ref) {", MEMOS + "var TaskGantt = function TaskGantt(_ref) {"],
  ["React.createElement(Calendar, Object.assign({}, calendarProps))", "React.createElement(MemoCalendar, Object.assign({}, calendarProps))"],
  [
    "React.createElement(Grid, Object.assign({}, gridProps)), React.createElement(TaskGanttContent, Object.assign({}, newBarProps))",
    "React.createElement(MemoGrid, Object.assign({}, gridProps)), React.createElement(MemoTaskGanttContent, Object.assign({}, newBarProps))",
  ],
];

export function ganttScrollPatch(): Plugin {
  return {
    name: "gms-gantt-scroll-patch",
    enforce: "pre",
    transform(code, id) {
      if (!LIBRARY.test(id.split("?")[0])) return null;
      let out = code;
      for (const [from, to] of EDITS) {
        if (out.split(from).length !== 2) {
          throw new Error(
            `gantt-task-react changed: could not find the code client/vite.gantt-patch.ts expects ("${from.slice(0, 60)}…"). ` +
              "Re-check the patch against the new version, or drop it and accept the slower scrolling."
          );
        }
        out = out.replace(from, () => to);
      }
      return { code: out, map: null };
    },
  };
}
