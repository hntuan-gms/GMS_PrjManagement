import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { descendantsOf, parentOptions, typeBlockedReason } from "../src/structure";
import { fromSavedSpec, ME, toSavedSpec } from "../src/savedFilters";
import { EMPTY_TASK_FILTER, buildEpicIndex, filterTaskIds, isTaskFiltering, type TaskFilter } from "../src/taskFilter";
import { dateX, dayWidth, daysBetween, isMilestone } from "../src/timelineGeometry";
import { MAX_UNDO, makeEntry, pushEntry, undoSteps } from "../src/undo";
import { task } from "./fixtures";

const t = (id: string, o: Record<string, unknown> = {}) => task({ id, summary: id, ...o });

describe("undo", () => {
  const before = [t("A", { startDate: "2026-10-05", durationDays: 3 }), t("B", { startDate: "2026-10-08", durationDays: 2 }), t("C")];

  it("keeps the primary task first and ignores ids that no longer exist", () => {
    const e = makeEntry("dời A", before, ["A", "B", "ZZ", "A"]);
    assert.deepEqual(e?.before.map((s) => s.id), ["A", "B"]);
    assert.equal(makeEntry("x", before, ["ZZ"]), null);
  });

  it("steps put back what changed, and nothing else", () => {
    const e = makeEntry("dời A", before, ["A", "B"])!;
    const now = [t("A", { startDate: "2026-10-12", durationDays: 3 }), t("B", { startDate: "2026-10-15", durationDays: 2 }), t("C")];
    assert.deepEqual(undoSteps(e, now), [
      { id: "A", patch: { startDate: "2026-10-05", durationDays: 3 } },
      { id: "B", patch: { startDate: "2026-10-08", durationDays: 2 } },
    ]);
  });

  it("a task the cascade already pulled back needs no step", () => {
    const e = makeEntry("dời A", before, ["A", "B"])!;
    const now = [t("A", { startDate: "2026-10-12", durationDays: 3 }), t("B", { startDate: "2026-10-08", durationDays: 2 }), t("C")];
    assert.deepEqual(undoSteps(e, now).map((s) => s.id), ["A"]);
  });

  it("start and duration travel together, % on its own", () => {
    const e = makeEntry("đổi %", [t("A", { startDate: "2026-10-05", durationDays: 3, percentComplete: 20 })], ["A"])!;
    assert.deepEqual(undoSteps(e, [t("A", { startDate: "2026-10-05", durationDays: 3, percentComplete: 60 })]), [{ id: "A", patch: { percentComplete: 20 } }]);
    assert.deepEqual(undoSteps(e, [t("A", { startDate: "2026-10-05", durationDays: 5, percentComplete: 20 })]), [
      { id: "A", patch: { startDate: "2026-10-05", durationDays: 3 } },
    ]);
  });

  it("nothing to undo once everything is back, or the task was deleted", () => {
    const e = makeEntry("dời A", before, ["A"])!;
    assert.deepEqual(undoSteps(e, before), []);
    assert.deepEqual(undoSteps(e, [t("C")]), []);
  });

  it("the stack is capped, oldest first out", () => {
    let stack: ReturnType<typeof pushEntry> = [];
    for (let i = 0; i < MAX_UNDO + 5; i++) stack = pushEntry(stack, { label: `e${i}`, before: [] });
    assert.equal(stack.length, MAX_UNDO);
    assert.equal(stack[0].label, "e5");
    assert.equal(stack.at(-1)?.label, `e${MAX_UNDO + 4}`);
  });
});

describe("structure (client mirror)", () => {
  const types = [
    { name: "Epic", subtask: false },
    { name: "Story", subtask: false },
    { name: "Sub-task", subtask: true },
  ];
  const tasks = [
    t("E-1", { issueType: "Epic" }),
    t("S-2", { issueType: "Story", wbsParentId: "E-1" }),
    t("T-3", { issueType: "Sub-task", wbsParentId: "S-2" }),
    t("S-4", { issueType: "Story", wbsParentId: "E-1", assigneeAccountId: "a" }),
    t("E-5", { issueType: "Epic" }),
  ];

  it("descendantsOf walks every level", () => {
    assert.deepEqual([...descendantsOf(tasks, "E-1")].sort(), ["S-2", "S-4", "T-3"]);
  });

  it("parents offered: not itself, not anything beneath it, never a Sub-task", () => {
    assert.deepEqual(parentOptions(tasks, tasks[1], types).map((x) => x.id), ["E-1", "S-4", "E-5"]);
    assert.deepEqual(parentOptions(tasks, tasks[0], types), []); // an Epic has no parent
    assert.ok(!parentOptions(tasks, tasks[3], types).some((x) => x.id === "T-3"));
  });

  it("offers parents for the type being switched to, not only the current one", () => {
    assert.deepEqual(parentOptions(tasks, tasks[1], types, "Epic"), []);
  });

  it("explains why a type cannot be picked", () => {
    assert.match(typeBlockedReason(tasks, tasks[1], types[2]) ?? "", /việc con/);
    assert.match(typeBlockedReason(tasks, tasks[3], types[0]) ?? "", /người phụ trách/);
    assert.equal(typeBlockedReason(tasks, tasks[1], types[1]), null);
    assert.equal(typeBlockedReason(tasks, tasks[3], types[1]), null);
  });
});

describe("saved filters (client side)", () => {
  const f = (o: Partial<TaskFilter>): TaskFilter => ({ ...EMPTY_TASK_FILTER, ...o });

  it("my own account id is saved as @me and comes back as whoever opens it", () => {
    const spec = toSavedSpec(f({ people: new Set(["me-id", "other"]), onlyOverdue: true }), "me-id");
    assert.deepEqual(spec.people, [ME, "other"]);
    const opened = fromSavedSpec(spec, "someone-else");
    assert.deepEqual([...opened.people], ["someone-else", "other"]);
    assert.equal(opened.onlyOverdue, true);
  });

  it("round-trips every facet", () => {
    // The search box is never saved (it is a transient search), so it comes back empty.
    const original = f({
      statuses: new Set(["Done"]),
      types: new Set(["Bug"]),
      epics: new Set(["P-1"]),
      labels: new Set(["urgent"]),
      components: new Set(["Backend"]),
      versions: new Set(["1.0"]),
      sprints: new Set(["Sprint 7"]),
      jql: "assignee = currentUser()",
    });
    const back = fromSavedSpec(toSavedSpec(original, "me"), "me");
    assert.deepEqual({ ...back, people: [...back.people] }, { ...original, people: [] });
    assert.ok(isTaskFiltering(back));
  });

  it("a filter saved before these facets existed opens with them empty", () => {
    const old = { people: [], statuses: ["Done"], types: [], epics: [], labels: [], priorities: [], onlyOverdue: false } as never;
    const opened = fromSavedSpec(old, "me");
    assert.equal(opened.components.size + opened.versions.size + opened.sprints.size, 0);
    assert.equal(opened.jql, "");
    assert.deepEqual([...opened.statuses], ["Done"]);
  });
});

describe("task filter: components, versions, sprints, JQL (2.1, 2.7, 2.8)", () => {
  const tasks = [
    t("A", { components: ["Backend"], fixVersions: ["1.0"], sprint: { id: 7, name: "Sprint 7", state: "active" } }),
    t("B", { components: ["UI"], fixVersions: ["1.1"], sprint: null }),
    t("C"),
  ];
  const ctx = (jqlKeys?: Set<string> | null) => ({ today: "2026-10-14", epicOf: buildEpicIndex(tasks), jqlKeys });
  const ids = (f: Partial<TaskFilter>, c = ctx()) => [...(filterTaskIds(tasks, { ...EMPTY_TASK_FILTER, ...f }, c) ?? [])];

  it("by component, version and sprint name", () => {
    assert.deepEqual(ids({ components: new Set(["UI"]) }), ["B"]);
    assert.deepEqual(ids({ versions: new Set(["1.0", "1.1"]) }), ["A", "B"]);
    assert.deepEqual(ids({ sprints: new Set(["Sprint 7"]) }), ["A"]);
  });

  it("a JQL restricts to the keys Jira returned", () => {
    assert.deepEqual(ids({ jql: "x" }, ctx(new Set(["B", "C"]))), ["B", "C"]);
  });

  it("while the JQL result has not arrived (or failed) it restricts nothing, rather than blanking the chart", () => {
    assert.deepEqual(ids({ jql: "x" }, ctx(null)), ["A", "B", "C"]);
    assert.deepEqual(ids({ jql: "x" }, ctx(undefined)), ["A", "B", "C"]);
  });

  it("a JQL still counts as filtering, so 'Xoá lọc' shows", () => {
    assert.equal(isTaskFiltering({ ...EMPTY_TASK_FILTER, jql: "status = Done" }), true);
  });

  it("combines with the other facets", () => {
    assert.deepEqual(ids({ jql: "x", components: new Set(["Backend"]) }, ctx(new Set(["B", "C"]))), []);
  });
});

describe("timeline geometry (2.5, 2.9)", () => {
  const rect = { x: 100, y: 10, width: 60, height: 20 }; // 3 days at 20px
  const range = { start: "2026-10-05", end: "2026-10-07" };

  it("dayWidth is the bars own width over its days, both ends counted", () => {
    assert.equal(dayWidth(rect, range), 20);
  });

  it("a date is placed from the NEAREST bar, so uneven month days do not accumulate", () => {
    const near = { rect: { x: 1000, y: 0, width: 30, height: 20 }, range: { start: "2026-12-01", end: "2026-12-03" } };
    const far = { rect, range };
    assert.equal(dateX([far, near], "2026-12-05"), 1040);
    assert.equal(dateX([far, near], "2026-10-06"), 120);
    assert.equal(dateX([], "2026-10-06"), null);
  });

  it("daysBetween is signed whole days, immune to month ends", () => {
    assert.equal(daysBetween("2026-10-31", "2026-11-02"), 2);
    assert.equal(daysBetween("2026-11-02", "2026-10-31"), -2);
  });

  it("a milestone is a label or a type named so", () => {
    assert.equal(isMilestone({ labels: ["Milestone"], issueType: "Task" }), true);
    assert.equal(isMilestone({ labels: [], issueType: "milestone" as never }), true);
    assert.equal(isMilestone({ labels: ["urgent"], issueType: "Task" }), false);
  });
});
