import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { orderTasksForLogging, parseHours } from "../src/parseHours";
import { task } from "./fixtures";

describe("parseHours", () => {
  it("plain numbers, with a dot or a comma", () => {
    assert.equal(parseHours("4"), 4);
    assert.equal(parseHours("1.5"), 1.5);
    assert.equal(parseHours("1,5"), 1.5);
    assert.equal(parseHours(" .5 "), 0.5);
  });

  it("hours and minutes", () => {
    assert.equal(parseHours("2h"), 2);
    assert.equal(parseHours("2h30"), 2.5);
    assert.equal(parseHours("2h 30"), 2.5);
    assert.equal(parseHours("2:15"), 2.25);
    assert.equal(parseHours("1h20"), 1.33);
    assert.equal(parseHours("90m"), 1.5);
    assert.equal(parseHours("45p"), 0.75);
  });

  it("refuses what cannot be a duration", () => {
    for (const bad of ["", "  ", "abc", "0", "-2", "25", "24.5", "2h75", "1.2.3", "h"]) assert.equal(parseHours(bad), null, bad);
    assert.equal(parseHours("24"), 24);
  });
});

describe("orderTasksForLogging", () => {
  const mk = (id: string, patch: Partial<ReturnType<typeof task>> = {}) => task({ id, summary: id, ...patch });
  const tasks = [
    mk("T-1", { assigneeAccountId: "other" }),
    mk("T-2", { assigneeAccountId: "me", statusCategory: "new" }),
    mk("T-3", { assigneeAccountId: "me", statusCategory: "indeterminate" }),
    mk("T-4", { assigneeAccountId: "other", statusCategory: "indeterminate" }),
    mk("E-1", { issueType: "Epic", assigneeAccountId: null }),
  ];

  it("last logged, then my work in progress, then my other open work, then the rest; no Epics", () => {
    const order = orderTasksForLogging(tasks, "me", [
      { issueKey: "T-4", date: "2026-11-03", mine: true },
      { issueKey: "T-1", date: "2026-11-05", mine: false },
    ]).map((t) => t.id);
    assert.deepEqual(order, ["T-4", "T-3", "T-2", "T-1"]);
  });

  it("with nothing logged yet it starts at my work in progress", () => {
    assert.equal(orderTasksForLogging(tasks, "me", [])[0].id, "T-3");
  });
});
