import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { statusKind } from "../src/statusKind";

describe("statusKind", () => {
  it("falls back to the category when the name says nothing", () => {
    assert.equal(statusKind("new", "To Do"), "todo");
    assert.equal(statusKind("new"), "todo");
    assert.equal(statusKind("indeterminate", "In Progress"), "doing");
    assert.equal(statusKind("indeterminate", "In-Progress"), "doing");
    assert.equal(statusKind("done", "Done"), "done");
    assert.equal(statusKind("done", "Resolved"), "done");
  });

  it("tells the in-between workflow states apart, in English and Vietnamese", () => {
    const cases: Array<[Parameters<typeof statusKind>[0], string, string]> = [
      ["indeterminate", "Blocked", "blocked"],
      ["indeterminate", "Bị chặn", "blocked"],
      ["indeterminate", "In Review", "review"],
      ["indeterminate", "Code-Review", "review"],
      ["indeterminate", "QA Testing", "review"],
      ["indeterminate", "Kiểm thử", "review"],
      ["indeterminate", "Chờ duyệt", "review"],
      ["indeterminate", "On Hold", "hold"],
      ["indeterminate", "Pending", "hold"],
      ["indeterminate", "Waiting for customer", "hold"],
      ["indeterminate", "Tạm dừng", "hold"],
      ["indeterminate", "Chờ khách", "hold"],
      ["indeterminate", "Reopened", "reopened"],
      ["new", "Re-open", "reopened"],
      ["new", "Mở lại", "reopened"],
      ["new", "Ready for Dev", "ready"],
      ["new", "Sẵn sàng", "ready"],
      ["new", "Backlog", "backlog"],
      ["new", "Tồn đọng", "backlog"],
    ];
    for (const [cat, name, want] of cases) assert.equal(statusKind(cat, name), want, name);
  });

  it("a closed status is only done or dropped, whatever its name", () => {
    assert.equal(statusKind("done", "Cancelled"), "dropped");
    assert.equal(statusKind("done", "Đã hủy"), "dropped");
    assert.equal(statusKind("done", "Reviewed and closed"), "done");
    assert.equal(statusKind("done", "Blocked"), "done");
  });

  it("'ready' and 'backlog' do not apply to work already under way", () => {
    assert.equal(statusKind("indeterminate", "Ready to deploy"), "doing");
    assert.equal(statusKind("indeterminate", "Backlog grooming"), "doing");
  });

  it("matches whole words only", () => {
    assert.equal(statusKind("indeterminate", "Contest"), "doing");
    assert.equal(statusKind("indeterminate", "Unblocked"), "doing");
  });
});
