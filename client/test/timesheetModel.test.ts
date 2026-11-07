import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMyRows,
  buildTeamRows,
  cellEntries,
  dayState,
  filterTeam,
  fmtHours,
  isOddCapacity,
  myDayTotals,
  personRows,
  planCell,
  replacingEntry,
  stableOrder,
  suggestedTasks,
  teamCounts,
  withEntry,
  withoutEntries,
} from "../src/timesheetModel";
import { DEFAULT_WORK_CALENDAR, toWorkCalendar } from "../src/workCalendar";
import type { TimesheetPerson, WorklogEntry } from "../src/types";
import { task } from "./fixtures";

const ME = "me";
const entry = (o: Partial<WorklogEntry> & Pick<WorklogEntry, "id" | "issueKey" | "date" | "hours">): WorklogEntry => ({
  summary: o.issueKey,
  issueType: "Task",
  authorAccountId: ME,
  authorName: "Tôi",
  comment: null,
  mine: true,
  ...o,
});
const person = (accountId: string, o: Partial<TimesheetPerson> = {}): TimesheetPerson => ({
  accountId,
  displayName: accountId,
  avatarUrl: null,
  capacityHoursPerDay: 8,
  absences: [],
  outsider: false,
  ...o,
});

// 2026-11-02 is a Monday.
const DAYS = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];

describe("fmtHours", () => {
  it("writes hours with a comma and no float noise", () => {
    assert.equal(fmtHours(2), "2");
    assert.equal(fmtHours(2.5), "2,5");
    assert.equal(fmtHours(1.3300000001), "1,33");
  });
});

describe("planCell", () => {
  const e1 = entry({ id: "a", issueKey: "X-1", date: DAYS[0], hours: 2 });
  it("an empty cell takes hours as a new worklog", () => {
    assert.deepEqual(planCell("4", []), { kind: "create", hours: 4 });
    assert.deepEqual(planCell("2h30", []), { kind: "create", hours: 2.5 });
  });
  it("typing nothing in an empty cell does nothing", () => {
    assert.deepEqual(planCell("  ", []), { kind: "noop" });
  });
  it("a cell with one worklog changes it, or clears it", () => {
    assert.deepEqual(planCell("3", [e1]), { kind: "update", entry: e1, hours: 3 });
    assert.deepEqual(planCell("2", [e1]), { kind: "noop" });
    assert.deepEqual(planCell("", [e1]), { kind: "delete", entries: [e1] });
  });
  it("text that is not a duration is refused, not logged", () => {
    assert.deepEqual(planCell("abc", []), { kind: "invalid" });
    assert.deepEqual(planCell("25", [e1]), { kind: "invalid" });
  });
  it("a cell with several worklogs is not typed into", () => {
    const e2 = entry({ id: "b", issueKey: "X-1", date: DAYS[0], hours: 1 });
    assert.deepEqual(planCell("5", [e1, e2]), { kind: "noop" });
    assert.deepEqual(planCell("", [e1, e2]), { kind: "noop" });
  });
});

describe("buildMyRows", () => {
  const tasks = [
    task({ id: "X-1", summary: "Một", assigneeAccountId: ME, statusCategory: "indeterminate" }),
    task({ id: "X-2", summary: "Hai", assigneeAccountId: ME, statusCategory: "new" }),
    task({ id: "X-3", summary: "Ba (xong)", assigneeAccountId: ME, statusCategory: "done" }),
    task({ id: "X-4", summary: "Bốn của người khác", assigneeAccountId: "anh", statusCategory: "indeterminate" }),
    task({ id: "X-10", summary: "Mười", assigneeAccountId: ME, statusCategory: "indeterminate" }),
    task({ id: "X-E", summary: "Epic", issueType: "Epic", assigneeAccountId: ME, statusCategory: "indeterminate" }),
  ];
  const entries = [
    entry({ id: "1", issueKey: "X-10", date: DAYS[0], hours: 2 }),
    entry({ id: "2", issueKey: "X-10", date: DAYS[1], hours: 3 }),
    entry({ id: "3", issueKey: "X-2", date: DAYS[0], hours: 1 }),
    entry({ id: "4", issueKey: "X-2", date: DAYS[0], hours: 1.5 }),
    entry({ id: "5", issueKey: "X-4", date: DAYS[0], hours: 9, authorAccountId: "anh", mine: false }),
  ];

  it("logged rows first in natural key order, then suggestions; nobody else's hours; no Epic, no finished work", () => {
    const rows = buildMyRows({ entries, tasks, me: ME, added: [] });
    assert.deepEqual(rows.map((r) => `${r.key}:${r.kind}`), ["X-2:logged", "X-10:logged", "X-1:suggested"]);
  });
  it("sums a day's several worklogs into one cell and keeps them for the list", () => {
    const x2 = buildMyRows({ entries, tasks, me: ME, added: [] }).find((r) => r.key === "X-2")!;
    assert.equal(x2.cells.get(DAYS[0])?.hours, 2.5);
    assert.equal(x2.cells.get(DAYS[0])?.entries.length, 2);
    assert.equal(x2.total, 2.5);
  });
  it("a task picked by hand is a row even with no hours, and a logged one stays logged", () => {
    const rows = buildMyRows({ entries, tasks, me: ME, added: ["X-4", "X-10"] });
    assert.deepEqual(rows.map((r) => `${r.key}:${r.kind}`), ["X-2:logged", "X-10:logged", "X-4:added", "X-1:suggested"]);
  });
  it("a task of another project that was logged on still shows, by its worklog's own summary", () => {
    const rows = buildMyRows({ entries: [entry({ id: "9", issueKey: "OTHER-1", summary: "Ngoài dự án", date: DAYS[0], hours: 1 })], tasks: [], me: ME, added: [] });
    assert.equal(rows[0].summary, "Ngoài dự án");
    assert.equal(rows[0].task, null);
  });
  it("order keeps a row in its place when it gets its first hours", () => {
    const before = buildMyRows({ entries: [], tasks, me: ME, added: [] });
    const order = before.map((r) => r.key);
    const after = buildMyRows({ entries: [entry({ id: "n", issueKey: "X-10", date: DAYS[0], hours: 1 })], tasks, me: ME, added: [], order: stableOrder([], order) });
    assert.deepEqual(after.map((r) => r.key), order);
  });
  it("suggestions are capped", () => {
    const many = Array.from({ length: 20 }, (_, i) => task({ id: `M-${i}`, summary: "m", assigneeAccountId: ME, statusCategory: "indeterminate" }));
    assert.equal(suggestedTasks(many, ME, new Set()).length, 6);
    assert.equal(buildMyRows({ entries: [], tasks: many, me: ME, added: [], suggestLimit: 3 }).length, 3);
  });
});

describe("stableOrder", () => {
  it("keeps what was shown, appends what is new, drops what is gone", () => {
    assert.deepEqual(stableOrder(["b", "a", "z"], ["a", "b", "c"]), ["b", "a", "c"]);
    assert.deepEqual(stableOrder([], ["a", "b"]), ["a", "b"]);
  });
});

describe("dayState", () => {
  const p = person("p");
  const today = "2026-11-04";
  it("a working day: later, open, missing, short, full, over", () => {
    assert.equal(dayState(p, "2026-11-05", 0, today, DEFAULT_WORK_CALENDAR), "later");
    assert.equal(dayState(p, "2026-11-04", 0, today, DEFAULT_WORK_CALENDAR), "open");
    assert.equal(dayState(p, "2026-11-03", 0, today, DEFAULT_WORK_CALENDAR), "missing");
    assert.equal(dayState(p, "2026-11-03", 4, today, DEFAULT_WORK_CALENDAR), "short");
    assert.equal(dayState(p, "2026-11-03", 8, today, DEFAULT_WORK_CALENDAR), "full");
    assert.equal(dayState(p, "2026-11-03", 9, today, DEFAULT_WORK_CALENDAR), "over");
  });
  it("a weekend is off, and work on it is extra, never missing", () => {
    assert.equal(dayState(p, "2026-11-07", 0, today, DEFAULT_WORK_CALENDAR), "off");
    assert.equal(dayState(p, "2026-11-07", 3, today, DEFAULT_WORK_CALENDAR), "extra");
  });
  it("a holiday is off; a make-up Saturday is an ordinary day", () => {
    const cal = toWorkCalendar({ workDays: [1, 2, 3, 4, 5], holidays: [{ date: "2026-11-03", name: "Lễ" }], makeUpDays: [{ date: "2026-11-07", name: "Làm bù" }] });
    assert.equal(dayState(p, "2026-11-03", 0, today, cal), "off");
    assert.equal(dayState(p, "2026-11-07", 0, "2026-11-09", cal), "missing");
  });
  it("leave is off, and more than the day is over wherever it falls", () => {
    const away = person("p", { absences: [{ from: "2026-11-03", to: "2026-11-03" }] });
    assert.equal(dayState(away, "2026-11-03", 0, today, DEFAULT_WORK_CALENDAR), "off");
    assert.equal(dayState(away, "2026-11-03", 10, today, DEFAULT_WORK_CALENDAR), "over");
  });
});

describe("team grid", () => {
  const people = [person("zed", { displayName: "Zed" }), person("anh", { displayName: "Anh" }), person("me", { displayName: "Tôi" }), person("out", { displayName: "Ngoài", outsider: true })];
  const entries = [
    entry({ id: "1", issueKey: "X-1", date: "2026-11-02", hours: 8 }),
    entry({ id: "2", issueKey: "X-1", date: "2026-11-03", hours: 8 }),
    entry({ id: "3", issueKey: "X-1", date: "2026-11-02", hours: 10, authorAccountId: "anh", mine: false }),
    entry({ id: "4", issueKey: "X-2", date: "2026-11-03", hours: 2, authorAccountId: "anh", mine: false }),
  ];
  const rows = buildTeamRows({ people, entries, days: DAYS, today: "2026-11-05", calendar: DEFAULT_WORK_CALENDAR, me: ME });

  it("you first, then whoever owes most days, then by name", () => {
    assert.deepEqual(rows.map((r) => r.person.accountId), ["me", "zed", "anh", "out"]);
  });
  it("counts days gone with nothing logged, and over-capacity days", () => {
    const by = Object.fromEntries(rows.map((r) => [r.person.accountId, r]));
    assert.deepEqual(by.me.missing, ["2026-11-04"]); // Mon and Tue logged; Wed is gone and empty; Thu is today
    assert.deepEqual(by.zed.missing, ["2026-11-02", "2026-11-03", "2026-11-04"]);
    assert.equal(by.anh.overDays, 1);
    assert.equal(by.out.missing.length, 0, "someone outside the project is nobody's gap");
  });
  it("filters by name without diacritics and by what is owed", () => {
    assert.deepEqual(filterTeam(rows, "toi", "all").map((r) => r.person.accountId), ["me"]);
    assert.deepEqual(filterTeam(rows, "", "over").map((r) => r.person.accountId), ["anh"]);
    assert.ok(filterTeam(rows, "", "missing").every((r) => r.missing.length > 0));
    assert.deepEqual(teamCounts(rows), { all: 4, missing: rows.filter((r) => r.missing.length > 0).length, over: 1, overDays: 1 });
  });
  it("opens a person into their own tasks", () => {
    const opened = personRows(entries, "anh");
    assert.deepEqual(opened.map((r) => [r.key, r.total]), [["X-1", 10], ["X-2", 2]]);
  });
  it("flags a capacity nobody works", () => {
    assert.equal(isOddCapacity(person("p", { capacityHoursPerDay: 24 })), true);
    assert.equal(isOddCapacity(person("p")), false);
  });
});

describe("entry edits and totals", () => {
  const a = entry({ id: "a", issueKey: "X-1", date: DAYS[0], hours: 2 });
  const b = entry({ id: "b", issueKey: "X-2", date: DAYS[0], hours: 3 });
  it("add, replace and remove leave the rest alone", () => {
    const list = withEntry([a], b);
    assert.equal(list.length, 2);
    assert.equal(replacingEntry(list, "a", { ...a, hours: 5 })[0].hours, 5);
    assert.deepEqual(withoutEntries(list, new Set(["a"])).map((e) => e.id), ["b"]);
  });
  it("finds a cell's worklogs, mine only", () => {
    const other = entry({ id: "c", issueKey: "X-1", date: DAYS[0], hours: 1, mine: false });
    assert.deepEqual(cellEntries([a, b, other], "X-1", DAYS[0]).map((e) => e.id), ["a"]);
  });
  it("totals my day across every task", () => {
    assert.equal(myDayTotals([a, b]).get(DAYS[0]), 5);
  });
});
