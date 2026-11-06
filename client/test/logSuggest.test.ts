import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { suggestWorklogs } from "../src/logSuggest";
import { task } from "./fixtures";

const TODAY = "2026-11-06";
// Noon UTC is 6/11 in every timezone from UTC−11 to UTC+11, so the test does not depend on the machine's zone.
const RESOLVED_TODAY = "2026-11-06T12:00:00.000Z";

const tasks = [
  task({ id: "T-14", summary: "Đang làm", assigneeAccountId: "me", statusCategory: "indeterminate" }),
  task({ id: "T-3", summary: "Vừa xong", assigneeAccountId: "me", statusCategory: "done", resolvedAt: RESOLVED_TODAY }),
  task({ id: "T-17", summary: "Bình luận", assigneeAccountId: "chi" }),
  task({ id: "T-20", summary: "Không đụng", assigneeAccountId: "me" }),
  task({ id: "T-21", summary: "Người khác đang làm", assigneeAccountId: "chi", statusCategory: "indeterminate" }),
  task({ id: "E-1", summary: "Epic", issueType: "Epic", assigneeAccountId: "me", statusCategory: "indeterminate" }),
];
const touched = new Set(["T-3", "T-17", "E-1"]);

describe("suggestWorklogs", () => {
  it("weights 3 / 2 / 1 over the hours left, in half hours", () => {
    assert.deepEqual(suggestWorklogs(tasks, "me", TODAY, 8, 0, touched), [
      { taskId: "T-14", hours: 4, reason: "đang làm" },
      { taskId: "T-3", hours: 2.5, reason: "đổi trạng thái" },
      { taskId: "T-17", hours: 1.5, reason: "có cập nhật" },
    ]);
  });

  it("never exceeds what is left, and uses all of it down to the half hour", () => {
    const out = suggestWorklogs(tasks, "me", TODAY, 8, 1.25, touched);
    const total = out.reduce((s, x) => s + x.hours, 0);
    assert.equal(total, 6.5);
    for (const x of out) assert.equal(x.hours * 2, Math.round(x.hours * 2));
  });

  it("a day already full suggests nothing", () => {
    assert.deepEqual(suggestWorklogs(tasks, "me", TODAY, 8, 8, touched), []);
    assert.deepEqual(suggestWorklogs(tasks, "me", TODAY, 8, 9, touched), []);
  });

  it("a share too small for half an hour is dropped", () => {
    const out = suggestWorklogs(tasks, "me", TODAY, 1, 0, touched);
    assert.deepEqual(out.map((x) => [x.taskId, x.hours]), [
      ["T-14", 0.5],
      ["T-3", 0.5],
    ]);
  });

  it("untouched: only my in-progress work; Epics and others' in-progress work never", () => {
    assert.deepEqual(suggestWorklogs(tasks, "me", TODAY, 8, 0, new Set()), [{ taskId: "T-14", hours: 8, reason: "đang làm" }]);
  });

  it("resolved on another day is just an update", () => {
    const old = [task({ id: "T-3", summary: "x", statusCategory: "done", resolvedAt: "2026-10-01T12:00:00.000Z" })];
    assert.deepEqual(suggestWorklogs(old, "me", TODAY, 2, 0, new Set(["T-3"])), [{ taskId: "T-3", hours: 2, reason: "có cập nhật" }]);
  });
});
