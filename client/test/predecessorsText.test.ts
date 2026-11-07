import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPredecessors, parsePredecessors } from "../src/predecessorsText";

const ok = (text: string) => {
  const r = parsePredecessors(text, "DEMO");
  assert.equal(r.ok, true, text);
  return r.ok ? r.predecessors : [];
};

describe("parsePredecessors", () => {
  it("a bare number is a key of this project, finish-to-start, no lag", () => {
    assert.deepEqual(ok("5"), [{ taskId: "DEMO-5", type: "FS", lagDays: 0 }]);
    assert.deepEqual(ok("DEMO-5"), [{ taskId: "DEMO-5", type: "FS", lagDays: 0 }]);
    assert.deepEqual(ok("demo-5"), [{ taskId: "DEMO-5", type: "FS", lagDays: 0 }]);
  });

  it("reads type and lag, either case, spaces allowed", () => {
    assert.deepEqual(ok("5FS+2"), [{ taskId: "DEMO-5", type: "FS", lagDays: 2 }]);
    assert.deepEqual(ok("5ss-1"), [{ taskId: "DEMO-5", type: "SS", lagDays: -1 }]);
    assert.deepEqual(ok("5 ff + 3"), [{ taskId: "DEMO-5", type: "FF", lagDays: 3 }]);
    assert.deepEqual(ok("5+2"), [{ taskId: "DEMO-5", type: "FS", lagDays: 2 }]);
    assert.deepEqual(ok("5SF+2d"), [{ taskId: "DEMO-5", type: "SF", lagDays: 2 }]);
  });

  it("takes several, comma separated", () => {
    assert.deepEqual(ok("5FS+2, 7SS , DEMO-9"), [
      { taskId: "DEMO-5", type: "FS", lagDays: 2 },
      { taskId: "DEMO-7", type: "SS", lagDays: 0 },
      { taskId: "DEMO-9", type: "FS", lagDays: 0 },
    ]);
  });

  it("empty text is an empty list", () => {
    assert.deepEqual(ok(""), []);
    assert.deepEqual(ok(" , "), []);
  });

  it("the prefix may carry its dash", () => {
    const r = parsePredecessors("5", "DEMO-");
    assert.deepEqual(r.ok && r.predecessors, [{ taskId: "DEMO-5", type: "FS", lagDays: 0 }]);
  });

  it("names the piece it cannot read", () => {
    const r = parsePredecessors("5, abc, 7", "DEMO");
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : "", /abc/);
    assert.equal(parsePredecessors("5XX", "DEMO").ok, false);
    assert.equal(parsePredecessors("5FS+", "DEMO").ok, false);
  });

  it("refuses another project and a repeated task", () => {
    const other = parsePredecessors("OTHER-5", "DEMO");
    assert.equal(other.ok, false);
    assert.match(!other.ok ? other.error : "", /OTHER-5/);
    const dup = parsePredecessors("5, DEMO-5SS", "DEMO");
    assert.equal(dup.ok, false);
  });
});

describe("formatPredecessors", () => {
  it("drops the prefix and writes the lag only when set", () => {
    assert.equal(
      formatPredecessors([
        { taskId: "DEMO-5", type: "FS", lagDays: 2 },
        { taskId: "DEMO-7", type: "SS", lagDays: 0 },
        { taskId: "DEMO-9", type: "FF", lagDays: -1 },
      ]),
      "5FS+2, 7SS, 9FF-1"
    );
    assert.equal(formatPredecessors([]), "");
  });

  it("round trips", () => {
    const list = [
      { taskId: "DEMO-5", type: "FS" as const, lagDays: 2 },
      { taskId: "DEMO-7", type: "SF" as const, lagDays: 0 },
    ];
    const back = parsePredecessors(formatPredecessors(list), "DEMO");
    assert.deepEqual(back.ok && back.predecessors, list);
  });
});
