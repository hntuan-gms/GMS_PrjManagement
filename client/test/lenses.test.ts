import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseView } from "../src/lenses";

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
