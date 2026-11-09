import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { issueTypeLook } from "../src/issueTypeLook";

describe("issueTypeLook", () => {
  it("colours every kind of bug red and draws the beetle", () => {
    for (const name of ["Bug", "Sub Bug", "Sub-Bug", "sub_bug", "Lỗi"]) {
      assert.deepEqual(issueTypeLook(name), { glyph: "Bug", tone: "bug" }, name);
    }
  });

  it("colours Issue orange and keeps its neutral glyph", () => {
    assert.deepEqual(issueTypeLook("Issue"), { glyph: null, tone: "issue" });
  });

  it("colours Task and Sub-task blue", () => {
    assert.deepEqual(issueTypeLook("Task"), { glyph: "Task", tone: "task" });
    assert.deepEqual(issueTypeLook("Sub-task"), { glyph: "Sub-task", tone: "task" });
    assert.deepEqual(issueTypeLook("Subtask"), { glyph: "Sub-task", tone: "task" });
  });

  it("leaves Epic, Story and unknown types in ink", () => {
    assert.equal(issueTypeLook("Epic").tone, null);
    assert.equal(issueTypeLook("Story").tone, null);
    assert.deepEqual(issueTypeLook("Improvement"), { glyph: null, tone: null });
  });

  it("decides the colour from the real name when the glyph was mapped (board, backlog)", () => {
    // canonicalIssueType maps "Issue" to the Task glyph; the real name still says orange.
    assert.deepEqual(issueTypeLook("Task", "Issue"), { glyph: "Task", tone: "issue" });
    assert.deepEqual(issueTypeLook("Bug", "Sub Bug"), { glyph: "Bug", tone: "bug" });
    assert.deepEqual(issueTypeLook("Task", "Nhiệm vụ"), { glyph: "Task", tone: "task" });
  });
});
