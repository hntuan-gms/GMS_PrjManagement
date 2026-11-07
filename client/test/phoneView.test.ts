import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { phoneView } from "../src/usePhone";

describe("phoneView", () => {
  it("leaves every view alone on a wide screen", () => {
    for (const v of ["today", "gantt", "board", "resource", "report", "settings"]) assert.equal(phoneView(v, false), v);
  });
  it("on a phone keeps Hôm nay, the board and settings, and sends the rest to Hôm nay", () => {
    assert.equal(phoneView("board", true), "board");
    assert.equal(phoneView("settings", true), "settings");
    assert.equal(phoneView("gantt", true), "today");
    assert.equal(phoneView("resource", true), "today");
    assert.equal(phoneView("report", true), "today");
  });
});
