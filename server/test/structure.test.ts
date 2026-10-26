import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkStructure, isDescendant, type StructureNode, type TypeInfo } from "../src/structure.js";

const node = (id: string, typeName: string, parentKey: string | null = null, o: Partial<StructureNode> = {}): StructureNode => ({
  id,
  parentKey,
  typeName,
  subtask: typeName === "Sub-task",
  assigned: false,
  ...o,
});

const types: TypeInfo[] = [
  { name: "Epic", subtask: false },
  { name: "Story", subtask: false },
  { name: "Task", subtask: false },
  { name: "Sub-task", subtask: true },
];

//  E-1 (Epic)
//   S-2 (Story)
//    T-3 (Sub-task)
//   S-4 (Story, assigned)
//  E-5 (Epic)
const nodes = [
  node("E-1", "Epic"),
  node("S-2", "Story", "E-1"),
  node("T-3", "Sub-task", "S-2"),
  node("S-4", "Story", "E-1", { assigned: true }),
  node("E-5", "Epic"),
  node("S-6", "Story", null, { assigned: true }),
];
const check = (id: string, change: Parameters<typeof checkStructure>[3]) => checkStructure(nodes, types, id, change);

describe("isDescendant", () => {
  const map = new Map(nodes.map((n) => [n.id, n]));
  it("walks up through every level", () => {
    assert.equal(isDescendant(map, "T-3", "E-1"), true);
    assert.equal(isDescendant(map, "E-1", "T-3"), false);
  });
  it("survives a malformed parent loop", () => {
    const loop = new Map([node("A-1", "Task", "A-2"), node("A-2", "Task", "A-1")].map((n) => [n.id, n]));
    assert.equal(isDescendant(loop, "A-1", "A-9"), false);
  });
});

describe("checkStructure: moving under a new parent", () => {
  it("allows a move to another Epic, and to no parent at all", () => {
    assert.equal(check("S-2", { parentKey: "E-5" }), null);
    assert.equal(check("S-2", { parentKey: null }), null);
  });

  it("refuses a loop: a task cannot go under itself or anything beneath it", () => {
    assert.match(check("S-2", { parentKey: "S-2" }) ?? "", /chính nó/);
    assert.match(check("E-1", { parentKey: "S-2" }) ?? "", /vòng lặp/);
    assert.match(check("S-2", { parentKey: "T-3" }) ?? "", /vòng lặp|Sub-task/);
  });

  it("a Sub-task cannot be a parent", () => {
    assert.match(check("S-4", { parentKey: "T-3" }) ?? "", /Sub-task nên không làm việc cha/);
  });

  it("an unknown parent is refused", () => {
    assert.match(check("S-2", { parentKey: "X-9" }) ?? "", /Không tìm thấy việc cha/);
  });

  it("an Epic has no parent", () => {
    assert.match(check("E-5", { parentKey: "E-1" }) ?? "", /Epic không có việc cha/);
  });

  it("a Sub-task cannot be left without a parent", () => {
    assert.match(check("T-3", { parentKey: null }) ?? "", /phải có việc cha/);
  });

  it("an unknown task is refused", () => {
    assert.match(check("X-1", { parentKey: null }) ?? "", /Không tìm thấy X-1/);
  });
});

describe("checkStructure: changing the issue type", () => {
  it("allows Story ↔ Task", () => {
    assert.equal(check("S-2", { issueType: "Task" }), null);
  });

  it("is case-insensitive about the type name and refuses a type the project lacks", () => {
    assert.equal(check("S-2", { issueType: "task" }), null);
    assert.match(check("S-2", { issueType: "Bug" }) ?? "", /không có loại/);
  });

  it("an assigned task cannot become an Epic (Epics carry no owner)", () => {
    assert.match(check("S-6", { issueType: "Epic" }) ?? "", /bỏ người phụ trách/);
  });

  it("a task under a parent cannot become an Epic, but a top-level one can", () => {
    assert.match(check("S-2", { issueType: "Epic" }) ?? "", /Epic không có việc cha/);
    assert.equal(check("S-2", { issueType: "Epic", parentKey: null }), null);
  });

  it("something with children cannot become a Sub-task", () => {
    assert.match(check("S-2", { issueType: "Sub-task" }) ?? "", /việc con/);
  });

  it("becoming a Sub-task needs a parent in the same move", () => {
    assert.match(check("E-5", { issueType: "Sub-task" }) ?? "", /phải có việc cha/);
    assert.equal(check("E-5", { issueType: "Sub-task", parentKey: "S-4" }), null);
  });
});
