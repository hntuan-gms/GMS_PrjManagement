import test from "node:test";
import assert from "node:assert/strict";
import { isStale, VIEW_MEMORY_MS } from "../src/startView.ts";

const NOW = 1_700_000_000_000;

test("không có dấu thời gian: chưa lưu gì nên không coi là cũ", () => {
  assert.equal(isStale(null, NOW), false);
  assert.equal(isStale(Number.NaN, NOW), false);
});

test("quay lại trong thời hạn thì giữ view đã lưu", () => {
  assert.equal(isStale(NOW - 60_000, NOW), false);
  assert.equal(isStale(NOW - VIEW_MEMORY_MS, NOW), false);
});

test("nghỉ lâu hơn thời hạn thì về Hôm nay", () => {
  assert.equal(isStale(NOW - VIEW_MEMORY_MS - 1, NOW), true);
  assert.equal(isStale(NOW - 5 * 3_600_000, NOW), true);
});
