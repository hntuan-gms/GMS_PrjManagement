import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NO_REQUIREMENTS, missingMessage, missingRequired } from "../src/createRequirements";

describe("missingRequired", () => {
  it("nothing mandatory, nothing missing", () => {
    assert.deepEqual(missingRequired({}, NO_REQUIREMENTS), []);
  });

  it("a mandatory due date is met by any start date (the app gives it one day)", () => {
    const req = { ...NO_REQUIREMENTS, dueDate: true };
    assert.deepEqual(missingRequired({}, req), ["Kết thúc"]);
    assert.deepEqual(missingRequired({ startDate: "2026-11-20" }, req), []);
  });

  it("several boxes are all named", () => {
    const req = { ...NO_REQUIREMENTS, dueDate: true, assignee: true };
    assert.deepEqual(missingRequired({}, req), ["Kết thúc", "Người"]);
    assert.deepEqual(missingRequired({ assigneeAccountId: "a" }, req), ["Kết thúc"]);
  });

  it("says which boxes in the app's words", () => {
    assert.equal(missingMessage(["Kết thúc", "Người"]), "Dự án này bắt buộc điền «Kết thúc», «Người».");
  });
});
