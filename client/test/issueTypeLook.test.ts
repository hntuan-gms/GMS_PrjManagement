import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GENERIC, KIND_PATHS, issueTypeLook, rememberIssueTypes, resetIssueTypeSlots } from "../src/issueTypeLook";

describe("issueTypeLook", () => {
  it("gives every kind and every generic shape its own drawing", () => {
    const all = [...Object.values(KIND_PATHS), ...GENERIC];
    assert.equal(new Set(all).size, all.length);
  });

  it("tells apart the types Jira users meet most", () => {
    const names = ["Epic", "Story", "Task", "Sub-task", "Bug", "Sub Bug", "Issue", "Risk", "NC", "Deliverable", "Change Request", "Improvement", "New Feature", "Testcase", "Sub Testcase", "Spike", "Support", "Question", "Incident"];
    const paths = names.map((n) => issueTypeLook(n).path);
    assert.equal(new Set(paths).size, names.length);
    for (const n of names) assert.notEqual(issueTypeLook(n).kind, null, n);
  });

  it("decides from the real name even when the board passes a mapped type", () => {
    // canonicalIssueType maps Issue and Change Request to "Task": the icons must still differ.
    assert.equal(issueTypeLook("Task", "Issue").kind, "issue");
    assert.equal(issueTypeLook("Task", "Change Request").kind, "changerequest");
    assert.equal(issueTypeLook("Task", "Task").kind, "task");
  });

  it("matches names however they are spelled", () => {
    assert.equal(issueTypeLook("Sub-Bug").kind, "subbug");
    assert.equal(issueTypeLook("sub_bug").kind, "subbug");
    assert.equal(issueTypeLook("Lỗi").kind, "bug");
    assert.equal(issueTypeLook("change-request").kind, "changerequest");
    assert.equal(issueTypeLook("Rủi ro").kind, "risk");
    assert.equal(issueTypeLook("Subtask").kind, "subtask");
  });

  it("gives an unknown type a stable generic drawing", () => {
    const a = issueTypeLook("Hồ sơ pháp lý");
    assert.equal(a.kind, null);
    assert.ok(GENERIC.includes(a.path));
    assert.equal(issueTypeLook("Hồ sơ pháp lý").path, a.path);
    assert.equal(a.tone, null);
  });

  it("colours bugs red, Issue orange, Task and Sub-task blue, Epic purple", () => {
    for (const n of ["Bug", "Sub Bug", "Lỗi"]) assert.equal(issueTypeLook(n).tone, "bug", n);
    assert.equal(issueTypeLook("Issue").tone, "issue");
    assert.equal(issueTypeLook("Task").tone, "task");
    assert.equal(issueTypeLook("Sub-task").tone, "task");
    assert.equal(issueTypeLook("Epic").tone, "epic");
    for (const n of ["Story", "Risk", "Change Request", "Spike", "Hồ sơ"]) assert.equal(issueTypeLook(n).tone, null, n);
  });
});

describe("generic drawings", () => {
  it("never gives two unknown types of a project the same drawing while shapes are free", () => {
    resetIssueTypeSlots();
    const names = ["Spike-ish", "Đón khách", "Hồ sơ", "Báo giá", "Hợp đồng", "Khảo sát", "Đào tạo", "Bàn giao", "Họp", "Văn bản", "Nghiệm thu", "Thanh toán"];
    rememberIssueTypes(names);
    const paths = names.map((n) => issueTypeLook(n).path);
    assert.equal(new Set(paths).size, names.length);
  });

  it("gives the same project the same icons whatever order rows render in", () => {
    const names = ["Đón khách", "Hồ sơ", "Báo giá"];
    resetIssueTypeSlots();
    rememberIssueTypes(names);
    const first = names.map((n) => issueTypeLook(n).path);
    resetIssueTypeSlots();
    rememberIssueTypes([...names].reverse());
    assert.deepEqual(names.map((n) => issueTypeLook(n).path), first);
  });
});
