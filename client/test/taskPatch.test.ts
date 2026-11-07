import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { optimisticTask, restoreFields, touchedFields } from "../src/taskPatch";
import type { JiraUser, Task } from "../src/types";

const task = {
  id: "P-1",
  wbsParentId: null,
  summary: "Cũ",
  issueType: "Task",
  statusName: "To Do",
  statusCategory: "new",
  assigneeAccountId: null,
  assigneeName: null,
  assigneeAvatarUrl: null,
  startDate: "2026-11-02",
  dueDate: "2026-11-04",
  durationDays: 3,
  percentComplete: 0,
  predecessors: [],
  baselineStart: null,
  baselineDue: null,
  estimateHours: null,
  spentHours: null,
  priority: "Medium",
  labels: [],
  components: [],
  fixVersions: [],
  sprint: null,
  jiraUrl: "https://x/browse/P-1",
} as Task;

const users: JiraUser[] = [{ accountId: "u1", displayName: "Nguyễn Anh", avatarUrl: "a.png" } as JiraUser];

describe("taskPatch", () => {
  it("a new start moves the end with it", () => {
    const t = optimisticTask(task, { startDate: "2026-11-10", durationDays: 3 }, users);
    assert.equal(t.startDate, "2026-11-10");
    assert.equal(t.dueDate, "2026-11-12");
  });

  it("a fractional duration takes the next whole day, as the server does", () => {
    const t = optimisticTask(task, { durationDays: 1.5 }, users);
    assert.equal(t.durationDays, 2);
    assert.equal(t.dueDate, "2026-11-03");
  });

  it("assigning fills the name and picture from the project's people", () => {
    const t = optimisticTask(task, { assigneeAccountId: "u1" }, users);
    assert.equal(t.assigneeName, "Nguyễn Anh");
    assert.equal(t.assigneeAvatarUrl, "a.png");
    const none = optimisticTask(t, { assigneeAccountId: null }, users);
    assert.equal(none.assigneeName, null);
  });

  it("parentKey is the task's wbsParentId, and null takes it off the parent", () => {
    assert.equal(optimisticTask(task, { parentKey: "P-9" }, users).wbsParentId, "P-9");
    assert.equal(optimisticTask({ ...task, wbsParentId: "P-9" }, { parentKey: null }, users).wbsParentId, null);
  });

  it("extra carries what a patch cannot say (the status a transition leads to)", () => {
    const t = optimisticTask(task, { statusTransition: "31" }, users, { statusName: "Done", statusCategory: "done" });
    assert.equal(t.statusName, "Done");
    assert.equal(t.statusCategory, "done");
  });

  it("leaves untouched fields alone and does not mutate its input", () => {
    const t = optimisticTask(task, { labels: ["a"] }, users);
    assert.deepEqual(t.labels, ["a"]);
    assert.equal(t.summary, "Cũ");
    assert.deepEqual(task.labels, []);
  });

  it("a refused save puts back exactly the fields it touched", () => {
    const patch = { assigneeAccountId: "u1", summary: "Mới" };
    const fields = touchedFields(patch);
    const edited = optimisticTask(task, patch, users);
    // something else changed meanwhile and must survive the rollback
    const meanwhile = { ...edited, percentComplete: 40 };
    const back = restoreFields(meanwhile, task, fields);
    assert.equal(back.summary, "Cũ");
    assert.equal(back.assigneeAccountId, null);
    assert.equal(back.assigneeName, null);
    assert.equal(back.percentComplete, 40);
  });

  it("a schedule edit touches start, duration and end together", () => {
    const f = touchedFields({ startDate: "2026-11-10" });
    for (const k of ["startDate", "durationDays", "dueDate"] as const) assert.ok(f.includes(k), k);
  });
});
