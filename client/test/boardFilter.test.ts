import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boardFilterFrom, EMPTY_BOARD_ONLY, isBoardFiltering, splitBoardFilter, taskOnlyKeys } from "../src/boardFilter";
import { EMPTY_FILTER, isFiltering, matchesFilter } from "../src/boardModel";
import { EMPTY_TASK_FILTER, type TaskFilter } from "../src/taskFilter";
import type { BoardIssue } from "../src/types";
import { sampleProject, task } from "./fixtures";

const tf = (o: Partial<TaskFilter>): TaskFilter => ({ ...EMPTY_TASK_FILTER, ...o });
const issue = (o: Partial<BoardIssue>): BoardIssue => ({
  key: "P-6",
  summary: "task B",
  issueType: "Task",
  subtask: false,
  statusId: "1",
  statusName: "To Do",
  statusCategory: "new",
  assigneeAccountId: "anh",
  assigneeName: "Anh",
  priority: "Medium",
  estimate: null,
  sprintId: null,
  epicKey: "P-2",
  epicSummary: "Phase B",
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

describe("boardFilterFrom", () => {
  it("an empty shared filter and no board-only switches is not filtering", () => {
    const bf = boardFilterFrom(EMPTY_TASK_FILTER, EMPTY_BOARD_ONLY);
    assert.equal(isFiltering(bf), false);
    assert.equal(isBoardFiltering(EMPTY_TASK_FILTER, EMPTY_BOARD_ONLY), false);
  });

  it("carries the shared facets over, and matchesFilter reads them", () => {
    const bf = boardFilterFrom(tf({ people: new Set(["anh"]), epics: new Set(["P-2"]), priorities: new Set(["High"]) }), EMPTY_BOARD_ONLY);
    assert.equal(matchesFilter(issue({ priority: "High" }), bf, "2026-10-14"), true);
    assert.equal(matchesFilter(issue({ priority: "Low" }), bf, "2026-10-14"), false);
    assert.equal(matchesFilter(issue({ assigneeAccountId: "binh", priority: "High" }), bf, "2026-10-14"), false);
  });

  it("a status filter from the Gantt still applies on the board", () => {
    const bf = boardFilterFrom(tf({ statuses: new Set(["Done"]) }), EMPTY_BOARD_ONLY);
    assert.equal(matchesFilter(issue({ statusName: "To Do" }), bf, "2026-10-14"), false);
    assert.equal(matchesFilter(issue({ statusName: "Done" }), bf, "2026-10-14"), true);
  });

  it("'Bị chặn' and quick filters are the board's own", () => {
    const only = { onlyBlocked: true, quick: new Set(["7"]) };
    const bf = boardFilterFrom(EMPTY_TASK_FILTER, only);
    assert.equal(bf.onlyBlocked, true);
    assert.deepEqual([...bf.quick], ["7"]);
    assert.equal(isBoardFiltering(EMPTY_TASK_FILTER, only), true);
    assert.equal(matchesFilter(issue({}), bf, "2026-10-14", new Set(["P-6"])), false);
    assert.equal(matchesFilter(issue({ blockedBy: ["P-1"] }), bf, "2026-10-14", new Set(["P-6"])), true);
  });
});

describe("splitBoardFilter", () => {
  it("round-trips through boardFilterFrom", () => {
    const bf = { ...EMPTY_FILTER, text: "api", people: new Set(["anh"]), onlyBlocked: true, versions: new Set(["1.0"]), quick: new Set(["3"]) };
    const { task: t, boardOnly } = splitBoardFilter(bf);
    assert.equal(t.text, "api");
    assert.deepEqual([...t.people], ["anh"]);
    assert.deepEqual([...t.versions], ["1.0"]);
    assert.equal(boardOnly.onlyBlocked, true);
    const back = boardFilterFrom(t, boardOnly);
    assert.deepEqual([...back.quick], ["3"]);
    assert.equal(back.onlyBlocked, true);
    assert.equal(back.text, "api");
  });
});

describe("taskOnlyKeys", () => {
  const tasks = [
    ...sampleProject(),
    task({ id: "P-8", summary: "with component", components: ["API"], sprint: { id: 5, name: "Sprint 5", state: "active" } as never }),
  ];
  const ctx = { today: "2026-10-14" };

  it("is null while none of components / sprint / JQL / SLA is on", () => {
    assert.equal(taskOnlyKeys(tasks, tf({ people: new Set(["anh"]) }), ctx), null);
  });

  it("components and sprint answer from the tasks", () => {
    assert.deepEqual([...(taskOnlyKeys(tasks, tf({ components: new Set(["API"]) }), ctx) ?? [])], ["P-8"]);
    assert.deepEqual([...(taskOnlyKeys(tasks, tf({ sprints: new Set(["Sprint 5"]) }), ctx) ?? [])], ["P-8"]);
  });

  it("a JQL restricts only once its keys are known; Trễ SLA likewise", () => {
    assert.equal(taskOnlyKeys(tasks, tf({ jql: "x" }), ctx)?.size, tasks.length);
    assert.deepEqual([...(taskOnlyKeys(tasks, tf({ jql: "x" }), { ...ctx, jqlKeys: new Set(["P-3"]) }) ?? [])], ["P-3"]);
    assert.deepEqual([...(taskOnlyKeys(tasks, tf({ onlySlaBreached: true }), { ...ctx, slaBreached: new Set(["P-6"]) }) ?? [])], ["P-6"]);
  });
});
