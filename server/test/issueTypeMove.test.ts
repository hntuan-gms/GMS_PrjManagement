import assert from "node:assert/strict";
import { test } from "node:test";
import { writeEffect } from "../src/issueCache.js";
import { buildMovePayload, planTypeMove, unmappable, type MoveSource, type TargetStatus } from "../src/issueTypeMove.js";

const src = (key: string, over: Partial<MoveSource> = {}): MoveSource => ({
  key,
  id: key.replace(/\D/g, "") + "0",
  summary: key,
  typeName: "Task",
  subtask: false,
  statusId: "3",
  statusName: "Done",
  statusCategory: "done",
  hasAssignee: false,
  ...over,
});
const issueType = { id: "10100", name: "Issue", subtask: false };
const targetStatuses: TargetStatus[] = [
  { id: "1", name: "To Do", category: "new" },
  { id: "2", name: "In Progress", category: "indeterminate" },
  { id: "9", name: "Closed", category: "done" },
];

test("a status the target workflow has needs no mapping", () => {
  const plan = planTypeMove([src("GMSPM-1", { statusId: "2", statusName: "In Progress", statusCategory: "indeterminate" })], issueType, targetStatuses);
  assert.deepEqual(plan.movable, ["GMSPM-1"]);
  assert.deepEqual(plan.statusProposals, []);
});

test("a missing status is proposed as one of the same category, grouped across issues", () => {
  const plan = planTypeMove([src("GMSPM-79"), src("GMSPM-48")], issueType, targetStatuses);
  assert.equal(plan.statusProposals.length, 1);
  assert.deepEqual(plan.statusProposals[0], {
    fromStatusId: "3",
    fromStatusName: "Done",
    toStatusId: "9",
    toStatusName: "Closed",
    keys: ["GMSPM-79", "GMSPM-48"],
  });
});

test("the same name wins over the first status of the category", () => {
  const withDone: TargetStatus[] = [{ id: "8", name: "Resolved", category: "done" }, { id: "7", name: "done", category: "done" }];
  const plan = planTypeMove([src("GMSPM-1")], issueType, withDone);
  assert.equal(plan.statusProposals[0].toStatusId, "7");
});

test("a category the target lacks is unmappable and blocks", () => {
  const plan = planTypeMove([src("GMSPM-1")], issueType, targetStatuses.filter((s) => s.category !== "done"));
  assert.equal(unmappable(plan).length, 1);
  assert.equal(unmappable(plan)[0].fromStatusName, "Done");
});

test("issues already of the target type are left alone", () => {
  const plan = planTypeMove([src("GMSPM-1", { typeName: "issue" })], issueType, targetStatuses);
  assert.deepEqual(plan.alreadyThere, ["GMSPM-1"]);
  assert.deepEqual(plan.movable, []);
});

test("sub-tasks, a sub-task target, and an owned issue becoming an Epic are refused with a reason", () => {
  const a = planTypeMove([src("GMSPM-1", { subtask: true })], issueType, targetStatuses);
  assert.equal(a.refused.length, 1);
  const b = planTypeMove([src("GMSPM-2")], { id: "5", name: "Sub-task", subtask: true }, targetStatuses);
  assert.equal(b.refused.length, 1);
  assert.deepEqual(b.movable, []);
  const c = planTypeMove([src("GMSPM-3", { hasAssignee: true })], { id: "6", name: "Epic", subtask: false }, targetStatuses);
  assert.equal(c.refused.length, 1);
  const d = planTypeMove([src("GMSPM-4", { hasAssignee: false })], { id: "6", name: "Epic", subtask: false }, targetStatuses);
  assert.deepEqual(d.movable, ["GMSPM-4"]);
});

test("payload: key is project,typeId; status mapping turns inference off; notification is off", () => {
  const plan = planTypeMove([src("GMSPM-79")], issueType, targetStatuses);
  const p = buildMovePayload("GMSPM", plan) as any;
  assert.equal(p.sendBulkNotification, false);
  const m = p.targetToSourcesMapping["GMSPM,10100"];
  assert.deepEqual(m.issueIdsOrKeys, ["GMSPM-79"]);
  assert.equal(m.inferStatusDefaults, false);
  assert.deepEqual(m.targetStatus, [{ statuses: { "9": ["3"] } }]);
  assert.equal(m.inferFieldDefaults, true);
});

test("payload: an explicit statusMap overrides the proposal; no mapping needed leaves inference on", () => {
  const plan = planTypeMove([src("GMSPM-79")], issueType, targetStatuses);
  const over = buildMovePayload("GMSPM", plan, { "3": "1" }) as any;
  assert.deepEqual(over.targetToSourcesMapping["GMSPM,10100"].targetStatus, [{ statuses: { "1": ["3"] } }]);
  const ok = planTypeMove([src("GMSPM-1", { statusId: "2", statusName: "In Progress", statusCategory: "indeterminate" })], issueType, targetStatuses);
  const plain = buildMovePayload("GMSPM", ok) as any;
  const m = plain.targetToSourcesMapping["GMSPM,10100"];
  assert.equal(m.inferStatusDefaults, true);
  assert.equal("targetStatus" in m, false);
});

test("issue copy: a bulk move marks every named issue stale", () => {
  const body = JSON.stringify({ targetToSourcesMapping: { "GMSPM,10100": { issueIdsOrKeys: ["GMSPM-76", "GMSPM-77", "10079", "not a key"] } } });
  const e = writeEffect("POST", "/rest/api/3/bulk/issues/move", body);
  assert.deepEqual(e.stale, ["GMSPM-76", "GMSPM-77", "10079"]);
  assert.equal(e.patch, null);
  assert.equal(e.created, false);
});
