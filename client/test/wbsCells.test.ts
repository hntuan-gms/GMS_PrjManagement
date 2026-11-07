import assert from "node:assert/strict";
import { test } from "node:test";
import { editableKinds, neighbourStop, nextRowFor, stopsFor } from "../src/wbsCells";
import { predecessorProblem } from "../src/predecessorCheck";

const ctx = { issueType: "Task", hasChildren: false, canAssign: true, canUpdate: true, canSchedule: true, canProgress: true };

test("a plain task can edit every cell", () => {
  assert.deepEqual([...editableKinds(ctx)].sort(), ["assignee", "due", "duration", "pct", "predecessors", "start", "summary"]);
});

test("an Epic with children keeps its name and links but not dates or %", () => {
  const k = editableKinds({ ...ctx, issueType: "Epic", hasChildren: true, canAssign: false });
  assert.deepEqual([...k].sort(), ["predecessors", "summary"]);
});

test("a childless Epic stays editable (its bar is draggable)", () => {
  assert.ok(editableKinds({ ...ctx, issueType: "Epic", canAssign: false }).has("start"));
});

test("nothing wired, nothing editable", () => {
  assert.equal(editableKinds({ ...ctx, canUpdate: false, canAssign: false, canSchedule: false, canProgress: false }).size, 0);
});

test("stops follow the visible columns in table order, the name first", () => {
  const e = editableKinds(ctx);
  assert.deepEqual(stopsFor(e, ["status", "assignee", "pct"]), ["summary", "assignee", "pct"]);
  assert.deepEqual(stopsFor(e, ["pct", "due", "start"]), ["summary", "start", "due", "pct"]);
  assert.deepEqual(stopsFor(e, []), ["summary"]);
});

test("Tab and Shift Tab stop at the ends of the row", () => {
  const stops = ["summary", "start", "due"] as const;
  assert.equal(neighbourStop(stops, "summary", 1), "start");
  assert.equal(neighbourStop(stops, "due", 1), null);
  assert.equal(neighbourStop(stops, "summary", -1), null);
  assert.equal(neighbourStop(stops, "due", -1), "start");
});

test("Enter goes to the next row where the column is editable", () => {
  const order = ["A-1", "A-2", "A-3", "A-4"];
  assert.equal(nextRowFor(order, "A-1", (id) => id !== "A-2"), "A-3");
  assert.equal(nextRowFor(order, "A-4", () => true), null);
  assert.equal(nextRowFor(order, "A-9", () => true), "A-1");
});

const t = (id: string, preds: string[] = []) => ({ id, predecessors: preds.map((taskId) => ({ taskId, type: "FS" as const, lagDays: 0 })) });

test("predecessors: unknown, self and loops are named", () => {
  const tasks = [t("D-1"), t("D-2", ["D-1"]), t("D-3", ["D-2"])];
  assert.match(predecessorProblem(tasks, "D-1", [{ taskId: "D-3", type: "FS", lagDays: 0 }])!, /vòng/);
  assert.match(predecessorProblem(tasks, "D-2", [{ taskId: "D-2", type: "FS", lagDays: 0 }])!, /chính nó/);
  assert.match(predecessorProblem(tasks, "D-2", [{ taskId: "D-9", type: "FS", lagDays: 0 }])!, /Không có việc D-9/);
  assert.equal(predecessorProblem(tasks, "D-3", [{ taskId: "D-1", type: "SS", lagDays: 1 }]), null);
});
