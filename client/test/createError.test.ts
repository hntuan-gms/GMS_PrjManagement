import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createErrorMessage } from "../src/createError";

describe("createErrorMessage", () => {
  it("a required Due date says which box to fill, in Vietnamese, once", () => {
    assert.equal(
      createErrorMessage("Due date: Due date is required. Due date is required."),
      "Dự án này bắt buộc điền «Kết thúc». Điền xong rồi tạo lại."
    );
  });

  it("an unknown required field keeps Jira's own name", () => {
    assert.equal(createErrorMessage("RootCause: RootCause is required."), "Dự án này bắt buộc điền «RootCause». Điền xong rồi tạo lại.");
  });

  it("several required fields are listed together", () => {
    const out = createErrorMessage("Due date: Due date is required. Assignee: Assignee is required.");
    assert.match(out, /«Kết thúc», «Người»/);
  });

  it("any other refusal is kept, with a sentence repeated back to back said once", () => {
    assert.equal(createErrorMessage("Issue type is not valid. Issue type is not valid."), "Issue type is not valid.");
    assert.equal(createErrorMessage("Không có quyền tạo việc."), "Không có quyền tạo việc.");
  });
});
