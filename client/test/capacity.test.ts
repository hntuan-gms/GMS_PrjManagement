import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capacityRows } from "../src/boardModel";
import type { BoardIssue, BoardSnapshot, SprintCapacityPerson } from "../src/types";

const issue = (key: string, assignee: string | null, estimate: number | null): BoardIssue => ({
  key,
  summary: key,
  issueType: "Task",
  subtask: false,
  statusId: "1",
  statusName: "To Do",
  statusCategory: "new",
  assigneeAccountId: assignee,
  assigneeName: assignee,
  priority: null,
  estimate,
  sprintId: 1,
  epicKey: null,
  epicSummary: null,
  parentKey: null,
  flagged: false,
  labels: [],
  fixVersions: [],
  dueDate: null,
  resolutionDate: null,
  updated: null,
  blockedBy: [],
});

const snap = (unit: "hours" | "points" | null) => ({ estimation: unit ? { fieldId: "f", name: "Est", unit } : null }) as BoardSnapshot;
const person = (accountId: string, days: number, hoursPerDay = 8): SprintCapacityPerson => ({
  accountId,
  name: accountId.toUpperCase(),
  days,
  hoursPerDay,
  capacityHours: days * hoursPerDay,
});

describe("sprint capacity rows (3.15)", () => {
  const team = [person("a", 10), person("b", 10), person("c", 0)];

  it("subtracts assigned hours from capacity when the board estimates in hours", () => {
    const rows = capacityRows(team, [issue("T-1", "a", 30), issue("T-2", "a", 40)], snap("hours"));
    const a = rows.find((r) => r.accountId === "a")!;
    assert.equal(a.capacityHours, 80);
    assert.equal(a.assignedHours, 70);
    assert.equal(a.remainingHours, 10);
    assert.equal(a.status, "tight"); // 10 of 80 left is under 15%
  });

  it("flags overload, someone away with work, and someone free", () => {
    const rows = capacityRows(team, [issue("T-1", "a", 100), issue("T-2", "c", 8)], snap("hours"));
    assert.equal(rows.find((r) => r.accountId === "a")!.status, "over");
    assert.equal(rows.find((r) => r.accountId === "a")!.remainingHours, -20);
    assert.equal(rows.find((r) => r.accountId === "c")!.status, "away");
    assert.equal(rows.find((r) => r.accountId === "b")!.status, "free");
  });

  it("on a points board there is no remaining-hours figure to invent", () => {
    const rows = capacityRows(team, [issue("T-1", "a", 5)], snap("points"));
    const a = rows.find((r) => r.accountId === "a")!;
    assert.equal(a.weight, 5);
    assert.equal(a.assignedHours, null);
    assert.equal(a.remainingHours, null);
    assert.equal(a.status, "ok");
  });

  it("collects unassigned work and people outside the team list on one last row", () => {
    const rows = capacityRows(team, [issue("T-1", null, 3), issue("T-2", "stranger", 2)], snap("points"));
    const last = rows.at(-1)!;
    assert.equal(last.accountId, null);
    assert.equal(last.count, 2);
    assert.equal(last.weight, 5);
  });

  it("puts the most committed people first", () => {
    const rows = capacityRows(team, [issue("T-1", "b", 1), issue("T-2", "b", 1), issue("T-3", "a", 1)], snap("points"));
    assert.deepEqual(rows.slice(0, 2).map((r) => r.accountId), ["b", "a"]);
  });
});
