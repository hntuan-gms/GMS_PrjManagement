import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTaskDigest, daysBetween } from "../src/ai/taskDigest.js";
import type { ActivityEntry, TaskComment } from "../src/taskActivity.js";
import { task } from "./fixtures.js";

const TODAY = "2026-10-14";

const comment = (o: Partial<TaskComment> & { created: string }): TaskComment => ({
  id: "c",
  authorAccountId: "a",
  authorName: "Lan",
  authorAvatarUrl: null,
  text: "ok",
  updated: o.created,
  mine: false,
  ...o,
});
const entry = (o: Partial<ActivityEntry> & { created: string }): ActivityEntry => ({
  id: "h",
  authorName: "Minh",
  authorAccountId: "m",
  changes: [],
  ...o,
});

describe("daysBetween", () => {
  it("counts calendar days by date part", () => {
    assert.equal(daysBetween("2026-10-10", "2026-10-14"), 4);
    assert.equal(daysBetween("2026-10-10T23:30:00.000+0700", "2026-10-14"), 4);
    assert.equal(daysBetween("2026-10-14", "2026-10-10"), -4);
  });
});

describe("buildTaskDigest", () => {
  const dep = task({ id: "P-1", summary: "Thiết kế DB", statusName: "In Progress", statusCategory: "indeterminate", assigneeName: "Anh", dueDate: "2026-10-10" });
  const doneDep = task({ id: "P-2", summary: "Chốt yêu cầu", statusName: "Done", statusCategory: "done" });
  const t = task({
    id: "P-3",
    summary: "Dựng API",
    statusName: "In Progress",
    statusCategory: "indeterminate",
    assigneeAccountId: "b",
    assigneeName: "Binh",
    startDate: "2026-10-05",
    dueDate: "2026-10-12",
    predecessors: [
      { taskId: "P-1", type: "FS", lagDays: 0 },
      { taskId: "P-2", type: "FS", lagDays: 0 },
    ],
    estimateHours: 16,
    spentHours: 20,
  });
  const after = task({ id: "P-4", summary: "Tích hợp", statusName: "To Do", predecessors: [{ taskId: "P-3", type: "FS", lagDays: 0 }] });
  const all = [dep, doneDep, t, after];

  const digest = buildTaskDigest({
    task: t,
    tasks: all,
    comments: [comment({ created: "2026-10-08T09:00:00.000+0700", text: "Chờ @[Anh](a) xong DB" })],
    activity: [
      entry({ created: "2026-10-09T10:00:00.000+0700", changes: [{ field: "status", from: "To Do", to: "In Progress" }] }),
    ],
    today: TODAY,
  });

  it("measures how overdue the task is", () => {
    assert.equal(digest.schedule.overdueDays, 2);
    assert.ok(digest.signals.some((s) => s.startsWith("Quá hạn 2 ngày")));
  });

  it("only unfinished predecessors block it, and says how late each is", () => {
    assert.deepEqual(digest.blockedBy.map((b) => b.id), ["P-1"]);
    assert.equal(digest.blockedBy[0].lateDays, 4);
    assert.ok(digest.signals.some((s) => s.includes("Đang chờ P-1") && s.includes("trễ 4 ngày")));
  });

  it("lists what is waiting on it", () => {
    assert.deepEqual(digest.blocking.map((b) => b.id), ["P-4"]);
  });

  it("flags logged time beyond the estimate", () => {
    assert.equal(digest.effort.overEstimate, true);
    assert.equal(digest.effort.remainingHours, -4);
  });

  it("finds the last status change and the quiet period since the last change", () => {
    assert.deepEqual(digest.activity.lastStatusChange, { from: "To Do", to: "In Progress", at: "2026-10-09T10:00:00.000+0700", by: "Minh" });
    assert.equal(digest.activity.daysSinceLastChange, 5);
    assert.ok(digest.signals.some((s) => s.includes("5 ngày chưa có thay đổi")));
  });

  it("reads comments back with mentions as @Name", () => {
    assert.equal(digest.comments.latest[0].text, "Chờ @Anh xong DB");
    assert.equal(digest.comments.daysSinceLast, 6);
  });

  it("a finished task raises no overdue or blocked signals", () => {
    const finished = buildTaskDigest({
      task: { ...t, statusName: "Done", statusCategory: "done" },
      tasks: all,
      comments: [],
      activity: [],
      today: TODAY,
    });
    assert.equal(finished.schedule.overdueDays, null);
    assert.deepEqual(finished.signals, ["Đã ghi 20h, vượt ước lượng 16h."]);
  });

  it("works with no history and no comments (Jira unreachable)", () => {
    const bare = buildTaskDigest({ task: t, tasks: all, comments: [], activity: [], today: TODAY });
    assert.equal(bare.activity.lastChangeAt, null);
    assert.equal(bare.comments.total, 0);
  });

  it("an unassigned open task says so", () => {
    const d = buildTaskDigest({ task: task({ id: "P-9", summary: "x" }), tasks: [], comments: [], activity: [], today: TODAY });
    assert.ok(d.signals.includes("Chưa có người phụ trách."));
  });

  it("clips a very long description", () => {
    const d = buildTaskDigest({ task: task({ id: "P-9", summary: "x", description: "a".repeat(5000) }), tasks: [], comments: [], activity: [], today: TODAY });
    assert.ok((d.task.description ?? "").length <= 1501);
  });
});
