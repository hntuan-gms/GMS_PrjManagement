import { test } from "node:test";
import assert from "node:assert/strict";
import { addDraftEdit, compactEdits, draftChanges, planEnd, startDraft } from "../src/planDraft";
import { task } from "./fixtures";

// A → B (FS): B starts the day after A ends. C is unrelated.
const plan = () => [
  task({ id: "D-1", summary: "A", startDate: "2026-11-02", dueDate: "2026-11-04", durationDays: 3 }),
  task({
    id: "D-2",
    summary: "B",
    startDate: "2026-11-05",
    dueDate: "2026-11-06",
    durationDays: 2,
    predecessors: [{ taskId: "D-1", type: "FS", lagDays: 0 }],
  }),
  task({ id: "D-3", summary: "C", startDate: "2026-11-02", dueDate: "2026-11-03", durationDays: 2 }),
];

test("a draft move cascades in the preview, and nothing else changes", () => {
  const base = plan();
  const { draft, tasks } = addDraftEdit(startDraft(base), base, { id: "D-1", startDate: "2026-11-09", durationDays: 3 });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  assert.equal(byId.get("D-1")!.startDate, "2026-11-09");
  assert.equal(byId.get("D-2")!.startDate, "2026-11-12", "B is pushed behind A");
  assert.equal(byId.get("D-3")!.startDate, "2026-11-02");
  assert.equal(draft.base, base, "the base is kept as it was");
});

test("changes list the moved task first, then what the cascade pushed", () => {
  const base = plan();
  const { draft, tasks } = addDraftEdit(startDraft(base), base, { id: "D-1", startDate: "2026-11-09", durationDays: 3 });
  const changes = draftChanges(draft, tasks);
  assert.deepEqual(
    changes.map((c) => [c.id, c.kind]),
    [
      ["D-1", "edited"],
      ["D-2", "pushed"],
    ]
  );
  assert.deepEqual(changes[1].from, { start: "2026-11-05", end: "2026-11-06" });
  assert.equal(planEnd(base), "2026-11-06");
  assert.equal(planEnd(tasks), "2026-11-13");
});

test("compactEdits keeps each task's last move, in the order of those last moves", () => {
  assert.deepEqual(
    compactEdits([
      { id: "D-1", startDate: "2026-11-09", durationDays: 3 },
      { id: "D-3", startDate: "2026-11-10", durationDays: 2 },
      { id: "D-1", startDate: "2026-11-12", durationDays: 3 },
    ]).map((e) => `${e.id}@${e.startDate}`),
    ["D-3@2026-11-10", "D-1@2026-11-12"]
  );
});

test("moving a task back where it was leaves no change", () => {
  const base = plan();
  let step = addDraftEdit(startDraft(base), base, { id: "D-3", startDate: "2026-11-05", durationDays: 2 });
  step = addDraftEdit(step.draft, step.tasks, { id: "D-3", startDate: "2026-11-02", durationDays: 2 });
  assert.deepEqual(draftChanges(step.draft, step.tasks), []);
});
