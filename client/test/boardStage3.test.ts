import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_FILTER, epicRollup, isFiltering, matchesFilter, versionRollup } from "../src/boardModel";
import {
  DEFAULT_CARD_OPTIONS,
  cardAccent,
  hueOf,
  isCustomized,
  parseCardOptions,
  subtaskProgress,
  subtasksByParent,
  withoutMergedSubtasks,
} from "../src/cardOptions";
import type { BoardIssue, BoardSnapshot } from "../src/types";

const issue = (key: string, o: Partial<BoardIssue> = {}): BoardIssue => ({
  key,
  summary: key,
  issueType: "Task",
  subtask: false,
  statusId: "1",
  statusName: "To Do",
  statusCategory: "new",
  assigneeAccountId: null,
  assigneeName: null,
  priority: null,
  estimate: null,
  sprintId: null,
  epicKey: null,
  epicSummary: null,
  parentKey: null,
  flagged: false,
  labels: [],
  fixVersions: [],
  dueDate: null,
  resolutionDate: null,
  updated: null,
  blockedBy: [],
  ...o,
});

const snap = { estimation: { fieldId: "f", name: "Pts", unit: "points" } } as BoardSnapshot;
const noEstimate = { estimation: null } as BoardSnapshot;

describe("board filter: versions and quick filters (3.1, 3.4)", () => {
  it("a version filter keeps only issues carrying one of the chosen versions", () => {
    const f = { ...EMPTY_FILTER, versions: new Set(["1.0"]) };
    assert.equal(matchesFilter(issue("A-1", { fixVersions: ["1.0", "2.0"] }), f, "2026-01-01"), true);
    assert.equal(matchesFilter(issue("A-2", { fixVersions: ["2.0"] }), f, "2026-01-01"), false);
    assert.equal(matchesFilter(issue("A-3"), f, "2026-01-01"), false);
  });

  it("quick filters keep only the keys Jira returned for them", () => {
    const f = { ...EMPTY_FILTER, quick: new Set(["7"]) };
    const keys = new Set(["A-1"]);
    assert.equal(matchesFilter(issue("A-1"), f, "2026-01-01", keys), true);
    assert.equal(matchesFilter(issue("A-2"), f, "2026-01-01", keys), false);
  });

  it("until Jira answers — or if its JQL is refused — a quick filter restricts nothing", () => {
    const f = { ...EMPTY_FILTER, quick: new Set(["7"]) };
    assert.equal(matchesFilter(issue("A-2"), f, "2026-01-01", null), true);
  });

  it("both count as filtering, so 'Xoá lọc' appears", () => {
    assert.equal(isFiltering({ ...EMPTY_FILTER, versions: new Set(["1.0"]) }), true);
    assert.equal(isFiltering({ ...EMPTY_FILTER, quick: new Set(["7"]) }), true);
    assert.equal(isFiltering(EMPTY_FILTER), false);
  });
});

describe("epic and version rollups (3.4)", () => {
  const issues = [
    issue("A-1", { epicKey: "A-100", epicSummary: "Đăng nhập", statusCategory: "done", estimate: 3 }),
    issue("A-2", { epicKey: "A-100", epicSummary: "Đăng nhập", estimate: 5 }),
    issue("A-3", { epicKey: "A-200", epicSummary: "Báo cáo", statusCategory: "done", estimate: 2 }),
    issue("A-4", { estimate: 1 }),
    issue("A-5", { subtask: true, parentKey: "A-2", epicKey: "A-100", epicSummary: "Đăng nhập" }),
    issue("A-100", { issueType: "Epic" }),
  ];

  it("counts done against total per Epic, ignoring sub-tasks and the Epic itself", () => {
    const rows = epicRollup(issues, snap);
    const login = rows.find((r) => r.key === "A-100")!;
    assert.deepEqual([login.total, login.done, login.weight, login.openWeight], [2, 1, 8, 5]);
  });

  it("lists unfinished Epics first and the no-Epic bucket last", () => {
    assert.deepEqual(epicRollup(issues, snap).map((r) => r.key), ["A-100", "A-200", "none"]);
  });

  it("weighs 1 per issue when the board has no estimate field", () => {
    assert.equal(epicRollup(issues, noEstimate).find((r) => r.key === "A-100")!.weight, 2);
  });

  it("versions keep the project's order, and an empty release still has a row", () => {
    const withVersions = [issue("A-1", { fixVersions: ["1.0"], statusCategory: "done" }), issue("A-2", { fixVersions: ["1.0", "Lạ"] })];
    const rows = versionRollup(
      withVersions,
      [
        { name: "2.0", released: false, releaseDate: "2026-12-01" },
        { name: "1.0", released: true, releaseDate: "2026-06-01" },
      ],
      snap
    );
    assert.deepEqual(rows.map((r) => r.key), ["2.0", "1.0", "Lạ"]);
    assert.equal(rows[0].total, 0);
    assert.deepEqual([rows[1].total, rows[1].done, rows[1].released], [2, 1, true]);
  });
});

describe("card options and colours (3.2)", () => {
  it("anything stored is laid over the defaults, so a field added later starts at its default", () => {
    const o = parseCardOptions({ fields: { labels: true, key: false }, colorBy: "epic" });
    assert.equal(o.fields.labels, true);
    assert.equal(o.fields.key, false);
    assert.equal(o.fields.assignee, DEFAULT_CARD_OPTIONS.fields.assignee);
    assert.equal(o.colorBy, "epic");
  });

  it("ignores garbage rather than crashing", () => {
    assert.deepEqual(parseCardOptions("nope"), DEFAULT_CARD_OPTIONS);
    assert.equal(parseCardOptions({ colorBy: "rainbow" }).colorBy, "none");
    assert.equal(parseCardOptions({ fields: { key: "yes" } }).fields.key, true);
  });

  it("knows when the layout is no longer the default", () => {
    assert.equal(isCustomized(DEFAULT_CARD_OPTIONS), false);
    assert.equal(isCustomized(parseCardOptions({ colorBy: "priority" })), true);
    assert.equal(isCustomized(parseCardOptions({ mergeSubtasks: true })), true);
  });

  it("colours by priority tone, and gives nothing to an unset priority", () => {
    assert.equal(cardAccent(issue("A-1", { priority: "Highest" }), "priority"), "var(--color-danger)");
    assert.equal(cardAccent(issue("A-1", { priority: "Low" }), "priority"), "var(--color-primary)");
    assert.equal(cardAccent(issue("A-1"), "priority"), null);
    assert.equal(cardAccent(issue("A-1", { priority: "Highest" }), "none"), null);
  });

  it("colours Epics and people by a stable hash, and nothing for no Epic / no owner", () => {
    const a = cardAccent(issue("A-1", { epicKey: "A-100" }), "epic");
    assert.equal(a, cardAccent(issue("A-2", { epicKey: "A-100" }), "epic"));
    assert.equal(a, `hsl(${hueOf("A-100")} 60% 50%)`);
    assert.equal(cardAccent(issue("A-1"), "epic"), null);
    assert.equal(cardAccent(issue("A-1"), "assignee"), null);
  });

  it("colours a renamed type by what it means (Lỗi is a Bug)", () => {
    assert.equal(cardAccent(issue("A-1", { issueType: "Lỗi" }), "type"), "var(--color-danger)");
  });
});

describe("sub-tasks on the parent card (3.3)", () => {
  const all = [
    issue("A-1"),
    issue("A-2", { subtask: true, parentKey: "A-1", statusCategory: "done" }),
    issue("A-3", { subtask: true, parentKey: "A-1" }),
    issue("A-4", { subtask: true, parentKey: "A-9" }),
  ];

  it("groups sub-tasks under their parent and counts the finished ones", () => {
    const by = subtasksByParent(all);
    assert.deepEqual(by.get("A-1")!.map((i) => i.key), ["A-2", "A-3"]);
    assert.deepEqual(subtaskProgress(by.get("A-1")!), { done: 1, total: 2 });
    assert.equal(by.has("A-2"), false);
  });

  it("merging hides a sub-task only while its parent is on screen", () => {
    assert.deepEqual(withoutMergedSubtasks(all, true).map((i) => i.key), ["A-1", "A-4"]);
    assert.equal(withoutMergedSubtasks(all, false).length, 4);
  });
});
