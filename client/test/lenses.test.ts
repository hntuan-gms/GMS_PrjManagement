import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseView, viewParam, withViewParam } from "../src/lenses";

describe("parseView", () => {
  it("knows the current views", () => {
    assert.deepEqual(parseView("gantt"), { view: "gantt" });
    assert.deepEqual(parseView("settings"), { view: "settings" });
  });
  it("keeps the old names working", () => {
    assert.deepEqual(parseView("plan"), { view: "gantt" });
    assert.deepEqual(parseView("timesheet"), { view: "resource", resourceMode: "ts" });
  });
  it("refuses anything else", () => {
    assert.equal(parseView("nope"), null);
    assert.equal(parseView(null), null);
    assert.equal(parseView(""), null);
  });
});

describe("view in the address", () => {
  it("writes the place and keeps other parameters", () => {
    assert.equal(withViewParam("", "board"), "?view=board");
    assert.equal(withViewParam("?view=today&x=1", "report"), "?view=report&x=1");
  });
  it("Nhân lực in Giờ đã ghi is written timesheet, and reads back to the same place", () => {
    assert.equal(viewParam("resource", "ts"), "timesheet");
    assert.equal(viewParam("resource", "load"), "resource");
    assert.deepEqual(parseView(viewParam("resource", "ts")), { view: "resource", resourceMode: "ts" });
    for (const v of ["today", "gantt", "board", "resource", "report", "settings"] as const) assert.deepEqual(parseView(viewParam(v)), { view: v });
  });
});
