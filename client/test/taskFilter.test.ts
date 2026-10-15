import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEpicIndex, EMPTY_TASK_FILTER, filterTaskIds, isTaskFiltering, type TaskFilter } from "../src/taskFilter";
import { sampleProject } from "./fixtures";

const tasks = sampleProject();
const ctx = { today: "2026-10-14", epicOf: buildEpicIndex(tasks) };
const f = (o: Partial<TaskFilter>): TaskFilter => ({ ...EMPTY_TASK_FILTER, ...o });
const ids = (o: Partial<TaskFilter>) => [...(filterTaskIds(tasks, f(o), ctx) ?? [])].sort();

describe("buildEpicIndex", () => {
  it("maps a task to its nearest Epic; an Epic to itself; a sub-task through its Story", () => {
    assert.equal(ctx.epicOf.get("P-3"), "P-1");
    assert.equal(ctx.epicOf.get("P-1"), "P-1");
    assert.equal(ctx.epicOf.get("P-4"), "P-1");
  });

  it("survives a parent cycle instead of hanging", () => {
    const loop = [
      { ...tasks[2], id: "L-1", wbsParentId: "L-2" },
      { ...tasks[2], id: "L-2", wbsParentId: "L-1" },
    ];
    assert.equal(buildEpicIndex(loop).get("L-1"), null);
  });
});

describe("filterTaskIds", () => {
  it("is null when nothing is being filtered", () => {
    assert.equal(filterTaskIds(tasks, EMPTY_TASK_FILTER, ctx), null);
    assert.equal(isTaskFiltering(EMPTY_TASK_FILTER), false);
  });

  it("people: an account id, and 'none' for unassigned", () => {
    assert.deepEqual(ids({ people: new Set(["anh"]) }), ["P-4", "P-6"]);
    assert.deepEqual(ids({ people: new Set(["none"]) }), ["P-1", "P-2", "P-7"]);
  });

  it("labels", () => {
    assert.deepEqual(ids({ labels: new Set(["urgent"]) }), ["P-7"]);
  });

  it("free text also matches the assignee's name", () => {
    assert.deepEqual(ids({ text: "binh" }), ["P-5"]);
  });

  it("epics: through the nearest Epic ancestor", () => {
    assert.deepEqual(ids({ epics: new Set(["P-2"]) }), ["P-2", "P-6", "P-7"]);
  });

  it("overdue excludes done work", () => {
    const od = ids({ onlyOverdue: true });
    assert.ok(od.includes("P-6"));
    assert.ok(!od.includes("P-4")); // overdue by date, but done
  });

  it("facets combine (AND)", () => {
    assert.deepEqual(ids({ people: new Set(["anh"]), onlyOverdue: true }), ["P-6"]);
  });
});
