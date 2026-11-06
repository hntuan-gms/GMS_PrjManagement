import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDateInput, parseDateInput } from "../src/dateInput";

// 2026-11-06 is a Friday (T6).
const TODAY = "2026-11-06";

test("day-first dates, with and without a year", () => {
  assert.equal(parseDateInput("15/11", TODAY), "2026-11-15");
  assert.equal(parseDateInput("15/11/2026", TODAY), "2026-11-15");
  assert.equal(parseDateInput("5-1-27", TODAY), "2027-01-05");
  assert.equal(parseDateInput("1.12", TODAY), "2026-12-01");
  // Never month-first: 11/08 is 11 August, not 8 November.
  assert.equal(parseDateInput("11/08/2026", TODAY), "2026-08-11");
});

test("words: hôm nay, mai, ngày kia, weekdays", () => {
  assert.equal(parseDateInput("hôm nay", TODAY), TODAY);
  assert.equal(parseDateInput("Mai", TODAY), "2026-11-07");
  assert.equal(parseDateInput("ngày kia", TODAY), "2026-11-08");
  assert.equal(parseDateInput("t6", TODAY), TODAY);
  assert.equal(parseDateInput("t2", TODAY), "2026-11-09");
  assert.equal(parseDateInput("cn", TODAY), "2026-11-08");
  assert.equal(parseDateInput("t2 tuần sau", TODAY), "2026-11-09");
});

test("relative days count from the base when given", () => {
  assert.equal(parseDateInput("+3", TODAY), "2026-11-09");
  assert.equal(parseDateInput("+3n", TODAY, "2026-11-20"), "2026-11-23");
  assert.equal(parseDateInput("-2", TODAY), "2026-11-04");
});

test("empty is a cleared field; nonsense and impossible dates are refused", () => {
  assert.equal(parseDateInput("  ", TODAY), "");
  assert.equal(parseDateInput("đăng nhập", TODAY), null);
  assert.equal(parseDateInput("31/02", TODAY), null);
  assert.equal(parseDateInput("13/13", TODAY), null);
});

test("ISO passes through and formats day-first", () => {
  assert.equal(parseDateInput("2026-12-24", TODAY), "2026-12-24");
  assert.equal(formatDateInput("2026-12-24"), "24/12/2026");
  assert.equal(formatDateInput(""), "");
});
