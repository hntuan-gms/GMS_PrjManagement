import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeProgress } from "../src/progress.js";
import { sampleProject, task } from "./fixtures.js";

const TODAY = "2026-10-14";
const total = (scope?: Parameters<typeof computeProgress>[2], tasks = sampleProject()) =>
  computeProgress(tasks, TODAY, scope).counts.total;

describe("computeProgress: what counts as work", () => {
  it("counts leaf, assignable tasks only (P-4, P-5, P-6, P-7)", () => {
    assert.equal(total(), 4);
  });

  it("never counts an Epic, even a childless one", () => {
    const tasks = [...sampleProject(), task({ id: "P-8", summary: "empty epic", issueType: "Epic" })];
    assert.equal(total(undefined, tasks), 4);
  });
});

describe("computeProgress: scope narrows after the leaf test", () => {
  it("assignee: only that person's leaves", () => {
    assert.equal(total({ assignee: "anh" }), 2); // P-4, P-6
  });

  it("assignee: a Story whose sub-tasks are someone else's is not a leaf of its own", () => {
    assert.equal(total({ assignee: "boss" }), 0);
  });

  it('assignee "none": unowned work', () => {
    assert.equal(total({ assignee: "none" }), 1); // P-7
  });

  it("epic: through the Story down to its sub-tasks", () => {
    assert.equal(total({ epic: "P-1" }), 2); // P-4, P-5
    assert.equal(total({ epic: "P-2" }), 2); // P-6, P-7
  });

  it("types: one or several", () => {
    assert.equal(total({ types: ["Bug"] }), 1);
    assert.equal(total({ types: ["Bug", "Task"] }), 2);
  });

  it("an empty scope is no scope", () => {
    assert.equal(total({}), 4);
    assert.equal(total({ types: [] }), 4);
  });

  it("scopes combine (AND)", () => {
    assert.equal(total({ assignee: "anh", epic: "P-2" }), 1); // P-6
  });
});

describe("computeProgress: percentages", () => {
  it("a done task is 100% whatever the overlay says", () => {
    const m = computeProgress(
      [task({ id: "P-1", summary: "x", statusCategory: "done", statusName: "Done", percentComplete: 0 })],
      TODAY
    );
    assert.equal(m.actualPct, 100);
  });

  it("undated work is reported as a count, not folded into the percentages", () => {
    const m = computeProgress(
      [
        task({ id: "P-1", summary: "dated", statusCategory: "done", statusName: "Done" }),
        task({ id: "P-2", summary: "undated", startDate: null, dueDate: null, baselineStart: null, baselineDue: null }),
      ],
      TODAY
    );
    assert.equal(m.actualPct, 100);
    assert.equal(m.counts.total, 2);
    assert.equal(m.counts.undated, 1);
  });

  it("planned % is measured against the baseline, so a slipped plan does not look on time", () => {
    // Baseline said done by 10-10; the live dates moved to 10-10..10-20. Judged
    // against the moved dates the task would be ~20% planned; against the baseline, 100%.
    const slipped = task({
      id: "P-1",
      summary: "slipped",
      startDate: "2026-10-10",
      dueDate: "2026-10-20",
      baselineStart: "2026-10-01",
      baselineDue: "2026-10-10",
    });
    assert.equal(computeProgress([slipped], "2026-10-14").plannedPct, 100);
  });

  it("with no baseline, planned falls back to the current dates and the gap is surfaced", () => {
    const t = task({ id: "P-1", summary: "no baseline", baselineStart: null, baselineDue: null });
    const m = computeProgress([t], "2026-10-14");
    assert.equal(m.counts.noBaseline, 1);
    assert.equal(m.plannedPct, 100);
  });
});
