import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  clearDetailCache,
  detailAge,
  dropTaskDetail,
  loadDetail,
  peekDetail,
  putDetail,
  setDetailScope,
  subscribeDetail,
} from "../src/detailCache";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("detailCache", () => {
  beforeEach(() => {
    clearDetailCache();
    setDetailScope("a.b.P");
  });

  it("holds an answer and serves it without asking again while it is young", async () => {
    let calls = 0;
    const read = async () => ++calls;
    assert.equal(await loadDetail("x", "1", read, 1000), 1);
    assert.equal(await loadDetail("x", "1", read, 1000), 1);
    assert.equal(calls, 1);
    assert.equal(peekDetail("x", "1"), 1);
  });

  it("shares one request between callers that ask at once", async () => {
    let calls = 0;
    const read = async () => {
      await tick();
      return ++calls;
    };
    const [a, b] = await Promise.all([loadDetail("x", "1", read, 0), loadDetail("x", "1", read, 0)]);
    assert.equal(calls, 1);
    assert.equal(a, b);
  });

  it("keeps showing the held answer while a fresh one is read, then swaps it in and tells subscribers", async () => {
    putDetail("x", "1", "old");
    let seen = 0;
    subscribeDetail("x", "1", () => seen++);
    const p = loadDetail("x", "1", async () => "new", 0);
    assert.equal(peekDetail("x", "1"), "old", "the old answer stays until the new one lands");
    await p;
    assert.equal(peekDetail("x", "1"), "new");
    assert.ok(seen >= 1);
  });

  it("a failed read leaves the held answer in place", async () => {
    putDetail("x", "1", "kept");
    await assert.rejects(loadDetail("x", "1", async () => Promise.reject(new Error("429")), 0));
    assert.equal(peekDetail("x", "1"), "kept");
    // and the next ask tries again rather than waiting on the dead request
    assert.equal(await loadDetail("x", "1", async () => "again", 0), "again");
  });

  it("null is an answer", async () => {
    await loadDetail("description", "1", async () => null, 1000);
    assert.equal(peekDetail("description", "1"), null);
    assert.ok(detailAge("description", "1") < 1000);
  });

  it("another scope starts empty", () => {
    putDetail("x", "1", "mine");
    setDetailScope("a.b.Q");
    assert.equal(peekDetail("x", "1"), undefined);
  });

  it("an answer that lands after the scope changed is not stored", async () => {
    const p = loadDetail("x", "1", async () => {
      await tick();
      return "late";
    }, 0);
    setDetailScope("a.b.Q");
    await p;
    assert.equal(peekDetail("x", "1"), undefined);
  });

  it("drops everything held about one task", () => {
    putDetail("comments", "T-1", [1]);
    putDetail("transitions", "T-1", [2]);
    putDetail("comments", "T-2", [3]);
    dropTaskDetail("T-1");
    assert.equal(peekDetail("comments", "T-1"), undefined);
    assert.equal(peekDetail("transitions", "T-1"), undefined);
    assert.deepEqual(peekDetail("comments", "T-2"), [3]);
  });
});
