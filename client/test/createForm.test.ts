import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeLine, mergeFormFields } from "../src/createForm";
import type { QuickAddContext } from "../src/quickAdd";
import type { JiraUser } from "../src/types";
import { task } from "./fixtures";

const users: JiraUser[] = [
  { accountId: "chi", displayName: "Lê Chi", avatarUrl: null },
  { accountId: "q1", displayName: "Nguyễn Quang", avatarUrl: null },
  { accountId: "q2", displayName: "Trần Quang", avatarUrl: null },
];

// 2026-11-06 is a Friday.
const ctx: QuickAddContext = {
  today: "2026-11-06",
  users,
  meAccountId: "chi",
  tasks: [task({ id: "DEMO-5", summary: "Nền tảng", startDate: "2026-11-02", dueDate: "2026-11-04", durationDays: 3 })],
  issueTypes: [],
  priorities: ["Highest", "High", "Medium", "Low", "Lowest"],
  projectKey: "DEMO",
};

describe("analyzeLine: the create form speaks Ctrl K's words", () => {
  it("'Dựng API @Chi t2 3n' is a title and three fields", () => {
    const r = analyzeLine("Dựng API @Chi t2 3n", ctx);
    assert.equal(r.title, "Dựng API");
    assert.deepEqual(r.fields, { assigneeAccountId: "chi", startDate: "2026-11-09", durationDays: 3 });
    assert.deepEqual(r.chips.map((c) => [c.kind, c.warn]), [["assignee", false], ["date", false], ["duration", false]]);
  });

  it("estimate, priority, label and type fill their own fields", () => {
    const r = analyzeLine("Sửa lỗi đăng nhập 4h !cao #backend /bug", ctx);
    assert.equal(r.title, "Sửa lỗi đăng nhập");
    assert.equal(r.fields.estimateHours, 4);
    assert.equal(r.fields.priority, "High");
    assert.deepEqual(r.fields.labels, ["backend"]);
    assert.equal(r.fields.issueType, "Bug");
  });

  it("a dependency has no field here: its words stay in the title and set nothing, not even a date", () => {
    const r = analyzeLine("Kiểm thử sau DEMO-5", ctx);
    assert.equal(r.title, "Kiểm thử sau DEMO-5");
    assert.deepEqual(r.fields, {});
    assert.equal(r.chips.length, 0);
  });

  it("a person nobody matches, or several match, stays in the title with a warning chip", () => {
    const none = analyzeLine("Việc @nobody", ctx);
    assert.equal(none.title, "Việc @nobody");
    assert.equal(none.fields.assigneeAccountId, undefined);
    assert.deepEqual(none.chips.map((c) => c.warn), [true]);
    const two = analyzeLine("Việc @Quang", ctx);
    assert.equal(two.title, "Việc @Quang");
    assert.equal(two.fields.assigneeAccountId, undefined);
    assert.equal(two.chips[0].warn, true);
  });

  it("plain text is untouched, an empty box is empty", () => {
    assert.deepEqual(analyzeLine("Thiết kế màn hình đăng nhập", ctx), { title: "Thiết kế màn hình đăng nhập", chips: [], fields: {} });
    assert.deepEqual(analyzeLine("   ", ctx), { title: "", chips: [], fields: {} });
  });

  it("'@tôi' is the signed-in person", () => {
    assert.equal(analyzeLine("Việc @tôi", ctx).fields.assigneeAccountId, "chi");
  });
});

describe("mergeFormFields", () => {
  it("the last line that names a field wins; labels add up", () => {
    const a = analyzeLine("Một @Chi 2n #a", ctx).fields;
    const b = analyzeLine("Hai 5n #b", ctx).fields;
    assert.deepEqual(mergeFormFields([a, b]), { assigneeAccountId: "chi", durationDays: 5, labels: ["a", "b"] });
  });
});
