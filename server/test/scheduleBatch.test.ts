import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_BATCH_OPS, parseScheduleBatch } from "../src/scheduleBatch.js";

const ok = (body: unknown) => {
  const r = parseScheduleBatch(body, "GPM");
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.ok ? r.ops : [];
};
const bad = (body: unknown) => {
  const r = parseScheduleBatch(body, "GPM");
  assert.equal(r.ok, false, "phải bị từ chối: " + JSON.stringify(body));
};

test("a batch of schedule writes is accepted in order", () => {
  const ops = ok({ ops: [{ id: "GPM-312", patch: { startDate: "2026-12-05", durationDays: 3 } }, { id: "GPM-313", patch: { percentComplete: 40 } }] });
  assert.deepEqual(ops.map((o) => o.id), ["GPM-312", "GPM-313"]);
  assert.deepEqual(ops[0].patch, { startDate: "2026-12-05", durationDays: 3 });
});

test("a task with no start date can be put back to none", () => {
  assert.deepEqual(ok({ ops: [{ id: "GPM-1", patch: { startDate: null, durationDays: 1 } }] })[0].patch, { startDate: null, durationDays: 1 });
});

test("only this project's issues", () => {
  bad({ ops: [{ id: "OTHER-1", patch: { durationDays: 2 } }] });
  bad({ ops: [{ id: "GPM-1/../x", patch: { durationDays: 2 } }] });
  bad({ ops: [{ id: "GPM-", patch: { durationDays: 2 } }] });
  bad({ ops: [{ id: 5, patch: { durationDays: 2 } }] });
});

test("only the three schedule fields: nothing else can ride along", () => {
  for (const field of ["assigneeAccountId", "summary", "description", "statusTransition", "predecessors", "baselineStart", "priority"]) {
    bad({ ops: [{ id: "GPM-1", patch: { durationDays: 2, [field]: "x" } }] });
  }
});

test("values must make sense", () => {
  bad({ ops: [{ id: "GPM-1", patch: { startDate: "15/11/2026" } }] });
  bad({ ops: [{ id: "GPM-1", patch: { durationDays: 0 } }] });
  bad({ ops: [{ id: "GPM-1", patch: { durationDays: Number.NaN } }] });
  bad({ ops: [{ id: "GPM-1", patch: { durationDays: 99999 } }] });
  bad({ ops: [{ id: "GPM-1", patch: { percentComplete: 101 } }] });
  bad({ ops: [{ id: "GPM-1", patch: {} }] });
});

test("empty, missing, malformed or oversized batches are refused", () => {
  bad(null);
  bad({});
  bad({ ops: [] });
  bad({ ops: "x" });
  bad({ ops: [null] });
  bad({ ops: Array.from({ length: MAX_BATCH_OPS + 1 }, () => ({ id: "GPM-1", patch: { durationDays: 2 } })) });
});
