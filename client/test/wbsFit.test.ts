import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitColumns } from "../src/wbsFit";

const cols = [
  { id: "status", width: 112 },
  { id: "assignee", width: 120 },
  { id: "start", width: 76 },
  { id: "pct", width: 48 },
];

describe("fitColumns", () => {
  it("keeps everything when there is room", () => {
    const r = fitColumns(cols, 400);
    assert.deepEqual(r.columns.map((c) => c.id), ["status", "assignee", "start", "pct"]);
    assert.equal(r.columns.some((c) => c.compact), false);
    assert.equal(r.width, 356);
  });
  it("drops from the right first", () => {
    assert.deepEqual(fitColumns(cols, 320).columns.map((c) => c.id), ["status", "assignee", "start"]);
    assert.deepEqual(fitColumns(cols, 250).columns.map((c) => c.id), ["status", "assignee"]);
  });
  it("then the person is an avatar, then the status a glyph", () => {
    const a = fitColumns(cols, 200);
    assert.deepEqual(a.columns.map((c) => [c.id, c.compact]), [["status", false], ["assignee", true]]);
    const b = fitColumns(cols, 60);
    assert.deepEqual(b.columns.map((c) => [c.id, c.compact]), [["status", true], ["assignee", true]]);
    assert.equal(b.width, 66);
  });
  it("never removes status or assignee, whatever the room", () => {
    assert.deepEqual(fitColumns(cols, 0).columns.map((c) => c.id), ["status", "assignee"]);
  });
  it("a table without them just loses columns", () => {
    assert.deepEqual(fitColumns([{ id: "start", width: 76 }, { id: "pct", width: 48 }], 80).columns.map((c) => c.id), ["start"]);
  });
});
