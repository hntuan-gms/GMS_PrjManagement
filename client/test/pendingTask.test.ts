import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dropPending, isPendingId, nextPendingId, pendingTask, settlePending } from "../src/pendingTask";

const make = (id: string, extra: Partial<Parameters<typeof pendingTask>[0]> = {}) =>
  pendingTask({
    id,
    summary: "Việc thử",
    issueType: "Task",
    parentId: null,
    startDate: null,
    durationDays: 1,
    assignee: null,
    priority: null,
    labels: [],
    estimateHours: null,
    ...extra,
  });

describe("pendingTask", () => {
  it("ids never look like a real key and are all different", () => {
    const a = nextPendingId();
    const b = nextPendingId();
    assert.notEqual(a, b);
    assert.ok(isPendingId(a));
    assert.equal(isPendingId("GPM-12"), false);
  });

  it("is drawn with its dates, owner and parent, and marked pending", () => {
    const t = make("NEW-1", {
      parentId: "GPM-1",
      startDate: "2026-11-12",
      durationDays: 3,
      assignee: { accountId: "a1", displayName: "Minh", avatarUrl: null },
    });
    assert.equal(t.pending, true);
    assert.equal(t.wbsParentId, "GPM-1");
    assert.equal(t.dueDate, "2026-11-14");
    assert.equal(t.assigneeName, "Minh");
    assert.equal(t.statusCategory, "new");
  });

  it("with no start date it has no due date either", () => {
    const t = make("NEW-2");
    assert.equal(t.startDate, null);
    assert.equal(t.dueDate, null);
  });

  it("is swapped for the real task in the same place", () => {
    const real = { ...make("GPM-9"), pending: undefined };
    const out = settlePending([make("GPM-1"), make("NEW-3"), make("GPM-2")], "NEW-3", real);
    assert.deepEqual(out.map((t) => t.id), ["GPM-1", "GPM-9", "GPM-2"]);
  });

  it("is added when a re-read dropped the row meanwhile, and not twice when the re-read already has it", () => {
    const real = make("GPM-9");
    assert.deepEqual(settlePending([make("GPM-1")], "NEW-3", real).map((t) => t.id), ["GPM-1", "GPM-9"]);
    assert.deepEqual(settlePending([make("GPM-1"), make("GPM-9")], "NEW-3", real).map((t) => t.id), ["GPM-1", "GPM-9"]);
  });

  it("is removed when Jira refused it", () => {
    assert.deepEqual(dropPending([make("GPM-1"), make("NEW-3")], "NEW-3").map((t) => t.id), ["GPM-1"]);
  });
});
