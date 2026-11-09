import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_REPORT_SCOPE, scopeFromTaskFilter } from "../src/reportScope";
import { EMPTY_TASK_FILTER, type TaskFilter } from "../src/taskFilter";

const f = (o: Partial<TaskFilter>): TaskFilter => ({ ...EMPTY_TASK_FILTER, ...o });

describe("scopeFromTaskFilter", () => {
  it("no filter, no scope, no note", () => {
    assert.deepEqual(scopeFromTaskFilter(f({})), EMPTY_REPORT_SCOPE);
    assert.deepEqual(scopeFromTaskFilter(undefined), EMPTY_REPORT_SCOPE);
  });

  it("exactly one person, one Epic and the types carry over", () => {
    const r = scopeFromTaskFilter(f({ people: new Set(["anh"]), epics: new Set(["DEMO-1"]), types: new Set(["Bug"]) }));
    assert.deepEqual(r, { assignee: "anh", epic: "DEMO-1", types: ["Bug"], note: null });
    assert.equal(scopeFromTaskFilter(f({ people: new Set(["none"]) })).assignee, "none");
  });

  it("several people or Epics cannot be one scope: everything, with a note", () => {
    const r = scopeFromTaskFilter(f({ people: new Set(["anh", "chi"]), epics: new Set(["A-1", "A-2"]) }));
    assert.equal(r.assignee, "");
    assert.equal(r.epic, "");
    assert.match(r.note ?? "", /nhiều người, nhiều giai đoạn/);
  });

  it("what the report has no control for is named, the rest still applies", () => {
    const r = scopeFromTaskFilter(f({ people: new Set(["anh"]), statuses: new Set(["Done"]), jql: " assignee = x ", onlyOverdue: true }));
    assert.equal(r.assignee, "anh");
    assert.equal(r.note, "List đang lọc thêm theo trạng thái, quá hạn, JQL. Report không áp dụng.");
  });
});
