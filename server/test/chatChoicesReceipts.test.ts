import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { choicesFor } from "../src/ai/choices.js";
import { buildReceipt, isReceiptTool } from "../src/ai/receipts.js";
import { contextLine, sanitizeContext } from "../src/ai/chatContext.js";
import { resolvePerson } from "../src/ai/toolUtils.js";
import { task } from "./fixtures.js";

describe("choicesFor", () => {
  it("asks before deleting, with a danger button and a way out", () => {
    const c = choicesFor({ needsConfirmation: true, willDelete: { id: "P-4", summary: "Kiểm thử" }, alsoDeletesSubtasks: ["P-5", "P-6"] })!;
    assert.match(c.prompt, /Xoá P-4 · Kiểm thử, kèm 2 việc con/);
    assert.deepEqual(c.options.map((o) => [o.label, o.message, o.tone]), [
      ["Xoá P-4", "Xác nhận xoá P-4", "danger"],
      ["Thôi", "Thôi, không làm nữa", "default"],
    ]);
  });

  it("offers to create anyway when similar work exists", () => {
    const c = choicesFor({ needsConfirmation: true, created: false, possibleDuplicates: [{ id: "P-1" }, { id: "P-2" }] })!;
    assert.match(c.prompt, /P-1, P-2/);
    assert.equal(c.options[0].message, "Vẫn tạo việc mới, dù đã có việc giống");
  });

  it("covers type moves and sprint completion", () => {
    assert.match(choicesFor({ needsConfirmation: true, willMoveTo: "Bug", willMove: ["P-1", "P-2"] })!.options[0].message, /Xác nhận đổi loại sang Bug/);
    const s = choicesFor({ needsConfirmation: true, sprint: "Sprint 4", openWillMove: ["P-1"], target: "Backlog" })!;
    assert.equal(s.options[0].message, "Xác nhận đóng Sprint 4");
    assert.equal(s.options[0].tone, "danger");
  });

  it("makes one button per person when a name is ambiguous, carrying the accountId", () => {
    const team = [
      { accountId: "a1", displayName: "Nguyễn Quang" },
      { accountId: "a2", displayName: "Trần Quang" },
    ] as never;
    const found = resolvePerson(team, "Quang");
    assert.ok("error" in found && found.ambiguous?.length === 2);
    const c = choicesFor({ ...found })!;
    assert.deepEqual(c.options.slice(0, 2).map((o) => o.message), ["Ý tôi là Nguyễn Quang (a1)", "Ý tôi là Trần Quang (a2)"]);
    assert.equal(c.options.at(-1)!.label, "Thôi");
  });

  it("is silent for an unknown name, an ordinary answer, or a response with no id", () => {
    const none = resolvePerson([{ accountId: "a1", displayName: "An" }] as never, "Zed");
    assert.ok("error" in none && none.ambiguous === undefined);
    assert.equal(choicesFor({ ...none }), null);
    assert.equal(choicesFor({ created: "P-9" }), null);
    assert.equal(choicesFor({ needsConfirmation: true, willDelete: {} }), null);
  });
});

describe("buildReceipt", () => {
  const a = task({ id: "P-1", summary: "A", assigneeAccountId: "u1", assigneeName: "An", startDate: "2026-10-01", durationDays: 3, dueDate: "2026-10-03", percentComplete: 10 });
  const b = task({ id: "P-2", summary: "B", startDate: "2026-10-04", dueDate: "2026-10-06", durationDays: 3 });

  it("knows which tools write", () => {
    assert.ok(isReceiptTool("assign_task"));
    assert.ok(!isReceiptTool("team_workload"));
  });

  it("assign: restores the previous assignee through PATCH assigneeAccountId", () => {
    const after = [{ ...a, assigneeAccountId: "u2", assigneeName: "Bình" }, b];
    const [r] = buildReceipt("assign_task", {}, { taskId: "P-1", assignedTo: "Bình" }, [a, b], after);
    assert.equal(r.text, "P-1 → Bình");
    assert.deepEqual(r.undo, { patch: { assigneeAccountId: "u1" } });
    const [fresh] = buildReceipt("assign_task", {}, { taskId: "P-2", assignedTo: "An" }, [a, b], [a, { ...b, assigneeAccountId: "u1" }]);
    assert.deepEqual(fresh.undo, { patch: { assigneeAccountId: null } });
  });

  it("unassign: undo puts the person back, nothing to undo when there was nobody", () => {
    const [r] = buildReceipt("unassign_task", {}, { taskId: "P-1", assignee: null }, [a], [{ ...a, assigneeAccountId: null, assigneeName: null }]);
    assert.equal(r.text, "P-1 bỏ gán");
    assert.deepEqual(r.undo, { patch: { assigneeAccountId: "u1" } });
    assert.equal(buildReceipt("unassign_task", {}, { taskId: "P-2" }, [b], [b])[0].undo, undefined);
  });

  it("update: dates and % are restorable, and cascaded successors are counted", () => {
    const moved = { ...a, startDate: "2026-10-05", dueDate: "2026-10-07", percentComplete: 40 };
    const [r] = buildReceipt("update_task", {}, { task: { id: "P-1" } }, [a, b], [moved, { ...b, startDate: "2026-10-08" }]);
    assert.match(r.text, /^P-1: ngày 05\/10–07\/10 · 40% · 1 việc dời theo$/);
    assert.deepEqual(r.undo, { patch: { startDate: "2026-10-01", durationDays: 3, percentComplete: 10 } });
  });

  it("update: any change that cannot be restored through PATCH removes the undo", () => {
    const [r] = buildReceipt("update_task", {}, { task: { id: "P-1" } }, [a], [{ ...a, statusName: "Done", percentComplete: 100 }]);
    assert.match(r.text, /To Do → Done/);
    assert.equal(r.undo, undefined);
    const [t] = buildReceipt("update_task", {}, { task: { id: "P-1" } }, [a], [{ ...a, summary: "A2" }]);
    assert.equal(t.undo, undefined);
  });

  it("other writes get a plain line, failures and questions get none", () => {
    assert.deepEqual(buildReceipt("create_task", {}, { created: "P-9", summary: "Mới" }, [], []), [{ key: "P-9", text: "Đã tạo P-9 · Mới" }]);
    assert.deepEqual(buildReceipt("delete_task", {}, { deleted: "P-9" }, [], []), [{ key: "P-9", text: "Đã xoá P-9" }]);
    assert.deepEqual(buildReceipt("log_work", {}, { logged: { task: "P-1", hours: 2 } }, [], []), [{ key: "P-1", text: "Đã ghi 2h vào P-1" }]);
    assert.equal(buildReceipt("move_to_sprint", {}, { moved: ["P-1", "P-2"], to: "Sprint 5" }, [], []).length, 2);
    assert.deepEqual(buildReceipt("assign_task", {}, { error: "x" }, [a], [a]), []);
    assert.deepEqual(buildReceipt("delete_task", {}, { needsConfirmation: true }, [a], [a]), []);
    assert.deepEqual(buildReceipt("team_workload", {}, {}, [], []), []);
  });
});

describe("chat context", () => {
  it("keeps a known tab and only this project's keys, deduplicated and capped", () => {
    const many = Array.from({ length: 30 }, (_, i) => `gpm-${i + 1}`);
    const c = sanitizeContext({ view: "gantt", selected: ["GPM-1", "gpm-1", "OTHER-2", "GPM-x", 5, ...many] }, "GPM");
    assert.equal(c.view, "gantt");
    assert.equal(c.selected!.length, 20);
    assert.ok(c.selected!.every((k) => k.startsWith("GPM-")));
    assert.equal(c.selected!.filter((k) => k === "GPM-1").length, 1);
  });

  it("drops an unknown view and junk bodies", () => {
    assert.deepEqual(sanitizeContext({ view: "<script>", selected: "GPM-1" }, "GPM"), {});
    assert.deepEqual(sanitizeContext(null, "GPM"), {});
    assert.deepEqual(sanitizeContext("x", "GPM"), {});
  });

  it("is one line, only when there is something to say", () => {
    assert.equal(contextLine({}), null);
    assert.equal(contextLine(undefined), null);
    assert.equal(contextLine({ view: "gantt" }), "Người dùng đang xem tab Kế hoạch.");
    assert.match(contextLine({ view: "board", selected: ["GPM-1", "GPM-2"] })!, /tab Bảng; đang chọn: GPM-1, GPM-2\. 'việc này'/);
  });
});
