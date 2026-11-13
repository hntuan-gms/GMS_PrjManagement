import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { layoutClockwork, otherProjects, togglePin, workdaysBetween, type HistoryItem, type LayoutInput } from "../src/clockworkLayout";
import type { WorklogEntry } from "../src/types";
import { task } from "./fixtures";

const ME = "me";
// 2026-11-09 is a Monday; "today" is Friday 13/11.
const TODAY = "2026-11-13";
const entry = (issueKey: string, date: string, hours: number, mine = true): WorklogEntry => ({
  id: `${issueKey}-${date}`,
  issueKey,
  summary: `Việc ${issueKey}`,
  issueType: "Task",
  authorAccountId: mine ? ME : "other",
  authorName: "x",
  date,
  hours,
  comment: null,
  mine,
});
const hist = (key: string, lastDate: string, hours = 1, days = 1): HistoryItem => ({ key, summary: `Cũ ${key}`, issueType: "Task", lastDate, days, hours });
const work = (key: string, inProgress = false) => ({ key, summary: `Giao ${key}`, issueType: "Task", inProgress });
const base = (o: Partial<LayoutInput> = {}): LayoutInput => ({
  entries: [],
  history: [],
  openWork: [],
  tasks: [],
  me: ME,
  added: [],
  dismissed: [],
  pinned: [],
  today: TODAY,
  ...o,
});
const projects = (o: Partial<LayoutInput>) => layoutClockwork(base(o)).groups.map((g) => g.project);
const rowsOf = (o: Partial<LayoutInput>, project: string) => layoutClockwork(base(o)).groups.find((g) => g.project === project)?.rows.map((r) => r.key);

describe("workdaysBetween", () => {
  it("counts working days after the first date, weekends skipped", () => {
    assert.equal(workdaysBetween("2026-11-12", "2026-11-13"), 1);
    assert.equal(workdaysBetween("2026-11-06", "2026-11-09"), 1, "Friday to Monday is one working day");
    assert.equal(workdaysBetween("2026-11-13", "2026-11-13"), 0);
  });
});

describe("project order", () => {
  it("the project I logged on most recently leads, whatever project the tab is on", () => {
    const order = projects({
      entries: [entry("AI-1", "2026-11-10", 8)],
      history: [hist("GPM-2", "2026-11-05", 20)],
      openWork: [work("ADT-3", true)],
    });
    assert.deepEqual(order, ["AI", "GPM", "ADT"]);
  });

  it("same last day: more hours first", () => {
    assert.deepEqual(projects({ history: [hist("A-1", "2026-11-05", 2), hist("B-1", "2026-11-05", 9)] }), ["B", "A"]);
  });

  it("projects with only assigned work come after, the one with work in progress first", () => {
    assert.deepEqual(projects({ openWork: [work("Q-1"), work("P-1", true)] }), ["P", "Q"]);
  });

  it("pinned projects lead, in the order they were pinned, even with nothing on them", () => {
    const order = projects({ entries: [entry("AI-1", "2026-11-10", 8)], pinned: ["TRAIN", "GPM"], openWork: [work("GPM-1")] });
    assert.deepEqual(order, ["TRAIN", "GPM", "AI"]);
  });

  it("a project with nothing is not shown; one brought in by hand is", () => {
    assert.deepEqual(projects({}), []);
    assert.deepEqual(projects({ extraProjects: ["OLD"] }), ["OLD"]);
  });

  it("keeps the order it was first drawn in while typing; pinning still moves a project at once", () => {
    const first = layoutClockwork(base({ history: [hist("A-1", "2026-11-05")], openWork: [work("B-1", true)] }));
    assert.deepEqual(first.groups.map((g) => g.project), ["A", "B"]);
    // Logging on B today would put it first; the page keeps it where it was.
    const typed = layoutClockwork(base({ history: [hist("A-1", "2026-11-05")], openWork: [work("B-1", true)], entries: [entry("B-1", TODAY, 2)], projectOrder: first.projectOrder }));
    assert.deepEqual(typed.groups.map((g) => g.project), ["A", "B"]);
    const pinned = layoutClockwork(base({ history: [hist("A-1", "2026-11-05")], openWork: [work("B-1", true)], pinned: ["B"], projectOrder: first.projectOrder }));
    assert.deepEqual(pinned.groups.map((g) => g.project), ["B", "A"]);
  });
});

describe("open or folded", () => {
  const groups = (o: Partial<LayoutInput>) => Object.fromEntries(layoutClockwork(base(o)).groups.map((g) => [g.project, g.open]));

  it("open: logged in the period, logged in the last ten working days, work in progress, pinned", () => {
    assert.deepEqual(
      groups({
        entries: [entry("A-1", "2026-11-10", 1)],
        history: [hist("B-1", "2026-11-02")],
        openWork: [work("C-1", true), work("D-1")],
        pinned: ["E"],
      }),
      { E: true, A: true, B: true, C: true, D: false }
    );
  });

  it("folded: last logged more than ten working days ago, nothing in progress", () => {
    assert.deepEqual(groups({ history: [hist("OLD-1", "2026-10-20")] }), { OLD: false });
  });

  it("what the person opened or folded wins", () => {
    assert.deepEqual(groups({ openWork: [work("D-1")], openOverride: { D: true } }), { D: true });
    assert.deepEqual(groups({ entries: [entry("A-1", TODAY, 1)], openOverride: { A: false } }), { A: false });
  });
});

describe("rows in a project", () => {
  it("logged in the period, then picked, then logged before (latest first), then in progress, then assigned", () => {
    const keys = rowsOf(
      {
        entries: [entry("A-5", "2026-11-10", 1), entry("A-6", "2026-11-11", 1)],
        added: ["A-9"],
        history: [hist("A-1", "2026-11-03"), hist("A-2", "2026-11-06")].sort((a, b) => b.lastDate.localeCompare(a.lastDate)),
        openWork: [work("A-7"), work("A-8", true)],
      },
      "A"
    );
    assert.deepEqual(keys, ["A-6", "A-5", "A-9", "A-2", "A-1", "A-8", "A-7"]);
  });

  it("work I just finished stays a row, with the work in progress and before the backlog", () => {
    const g = layoutClockwork(base({ openWork: [work("A-1"), { ...work("A-2"), done: true }, work("A-3", true)] })).groups[0];
    assert.deepEqual(
      g.rows.map((r) => r.key),
      ["A-2", "A-3", "A-1"]
    );
    assert.equal(g.rows[0].status, "done", "a row of another project still says it is done");
    assert.equal(g.open, true, "a project with work just finished opens");
  });

  it("a task of the plan finished in the last two weeks is a row; one finished long ago is not", () => {
    const tasks = [
      task({ id: "A-1", summary: "Vừa xong", assigneeAccountId: ME, statusCategory: "done", resolvedAt: "2026-11-12T10:00:00.000+0700" }),
      task({ id: "A-2", summary: "Xong lâu rồi", assigneeAccountId: ME, statusCategory: "done", resolvedAt: "2026-10-01T10:00:00.000+0700" }),
    ];
    assert.deepEqual(rowsOf({ tasks }, "A"), ["A-1"]);
  });

  it("Epics and finished work are rows like any other", () => {
    const keys = rowsOf({ history: [{ ...hist("A-1", "2026-11-10"), issueType: "Epic" }], tasks: [task({ id: "A-1", summary: "Epic đã xong", issueType: "Epic", statusCategory: "done" })] }, "A");
    assert.deepEqual(keys, ["A-1"]);
  });

  it("at most eight rows, the rest behind '+n việc khác'; logged rows are never cut", () => {
    const openWork = Array.from({ length: 12 }, (_, i) => work(`A-${i + 1}`));
    const g = layoutClockwork(base({ openWork })).groups[0];
    assert.equal(g.rows.length, 8);
    assert.equal(g.more, 4);
    assert.equal(g.count, 12);
    const entries = Array.from({ length: 10 }, (_, i) => entry(`A-${i + 1}`, "2026-11-10", 1));
    const logged = layoutClockwork(base({ entries, openWork })).groups[0];
    assert.equal(logged.rows.length, 10);
    assert.equal(layoutClockwork(base({ openWork, showAll: ["A"] })).groups[0].rows.length, 12);
  });

  it("opened with '+n việc khác' it says it can be folded back; laid out again without it, eight rows", () => {
    const openWork = Array.from({ length: 12 }, (_, i) => work(`A-${i + 1}`));
    assert.equal(layoutClockwork(base({ openWork })).groups[0].expanded, false);
    const all = layoutClockwork(base({ openWork, showAll: ["A"] }));
    assert.equal(all.groups[0].expanded, true);
    // "Ẩn bớt" drops the project's rows from the remembered order, so the kept-rows rule does not hold them.
    const less = layoutClockwork(base({ openWork, rowOrder: all.rowOrder.filter((k) => !k.startsWith("A-")) }));
    assert.equal(less.groups[0].rows.length, 8);
    assert.equal(less.groups[0].more, 4);
  });

  it("a row that gets its first hours keeps its place and does not push the last one off", () => {
    const openWork = Array.from({ length: 10 }, (_, i) => work(`A-${i + 1}`, true));
    const first = layoutClockwork(base({ openWork }));
    assert.equal(first.groups[0].open, true);
    const before = first.groups[0].rows.map((r) => r.key);
    const after = layoutClockwork(base({ openWork, entries: [entry("A-5", TODAY, 2)], rowOrder: first.rowOrder })).groups[0].rows.map((r) => r.key);
    assert.deepEqual(after, before);
  });

  it("a row closed with × goes, unless it has hours", () => {
    assert.deepEqual(rowsOf({ openWork: [work("A-1"), work("A-2")], dismissed: ["A-1"] }, "A"), ["A-2"]);
    assert.deepEqual(rowsOf({ entries: [entry("A-1", TODAY, 1)], dismissed: ["A-1"] }, "A"), ["A-1"]);
  });

  it("names come from the plan when it has the task, else from what the server said", () => {
    const g = layoutClockwork(base({ history: [hist("A-1", "2026-11-10")], tasks: [task({ id: "A-1", summary: "Tên trong kế hoạch" })] })).groups[0];
    assert.equal(g.rows[0].summary, "Tên trong kế hoạch");
    assert.equal(layoutClockwork(base({ history: [hist("B-1", "2026-11-10")] })).groups[0].rows[0].summary, "Cũ B-1");
  });

  it("a project's day totals and total count every one of my worklogs on it", () => {
    const g = layoutClockwork(base({ entries: [entry("A-1", "2026-11-10", 1.5), entry("A-2", "2026-11-10", 2), entry("A-2", "2026-11-11", 1), entry("A-3", "2026-11-10", 9, false)] })).groups[0];
    assert.equal(g.total, 4.5);
    assert.equal(g.dayTotals.get("2026-11-10"), 3.5);
    assert.equal(g.dayTotals.get("2026-11-11"), 1);
  });
});

describe("pins and other projects", () => {
  it("pinning adds to the end of the pinned ones; pinning again unpins", () => {
    assert.deepEqual(togglePin(["A"], "B"), ["A", "B"]);
    assert.deepEqual(togglePin(["A", "B"], "A"), ["B"]);
  });

  it("a hidden project is left out until something is logged or picked in it, or it is pinned", () => {
    const o = { history: [hist("OLD-1", "2026-10-01")], openWork: [work("A-1", true)], hiddenProjects: ["OLD"] };
    assert.deepEqual(projects(o), ["A"]);
    assert.deepEqual(projects({ ...o, extraProjects: ["OLD"] }), ["A"], "booked or brought in is not enough");
    assert.deepEqual(projects({ ...o, entries: [entry("OLD-1", TODAY, 1)] }), ["OLD", "A"]);
    assert.deepEqual(projects({ ...o, added: ["OLD-1"] }), ["OLD", "A"]);
    assert.deepEqual(projects({ ...o, pinned: ["OLD"] }), ["OLD", "A"]);
  });

  it("only a project with nothing logged or picked this period offers to be hidden", () => {
    const g = Object.fromEntries(layoutClockwork(base({ entries: [entry("A-1", TODAY, 1)], openWork: [work("B-1")] })).groups.map((x) => [x.project, x.hideable]));
    assert.deepEqual(g, { A: false, B: true });
  });

  it("'Dự án khác' lists what the page does not show, by name", () => {
    const all = [{ key: "Z", name: "Zeta" }, { key: "A", name: "Alpha" }, { key: "M", name: "Một" }];
    assert.deepEqual(otherProjects(all, ["Z"]).map((p) => p.key), ["A", "M"]);
  });
});
