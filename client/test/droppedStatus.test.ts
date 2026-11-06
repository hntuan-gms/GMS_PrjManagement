import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDroppedStatus } from "../src/droppedStatus";

describe("isDroppedStatus", () => {
  it("recognises dropped work in English and Vietnamese, with or without diacritics", () => {
    for (const n of ["Cancel", "Cancelled", "Rejected", "Won't Do", "Duplicate", "Huỷ", "Đã hủy", "Từ chối", "Bỏ qua"]) {
      assert.equal(isDroppedStatus(n), true, n);
    }
  });

  it("leaves finished statuses alone, and does not match inside another word", () => {
    for (const n of ["Done", "Resolved", "Closed", "Xong", "Chuyển QA", "Hoàn thành", undefined, ""]) {
      assert.equal(isDroppedStatus(n), false, String(n));
    }
  });
});
