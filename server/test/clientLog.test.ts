import assert from "node:assert/strict";
import { test } from "node:test";
import { clientLogLines, MAX_EVENTS_PER_BATCH, plainValue } from "../src/auth/clientLog.js";

const me = { accountId: "712020:abc", displayName: "Võ Đình Quang" };

test("one event is one JSON line carrying who, which tab and the browser's clock", () => {
  const lines = clientLogLines(me, { sid: "abc123", events: [{ n: 1, t: 1_700_000_000_000, e: "drag", d: { id: "GPM-312", days: 3 } }] }, "GPM");
  assert.equal(lines.length, 1);
  const o = JSON.parse(lines[0]);
  assert.equal(o.kind, "client");
  assert.equal(o.accountId, "712020:abc");
  assert.equal(o.sid, "abc123");
  assert.equal(o.event, "drag");
  assert.equal(o.projectKey, "GPM");
  assert.equal(o.clientAt, "2023-11-14T22:13:20.000Z");
  assert.deepEqual(o.data, { id: "GPM-312", days: 3 });
});

test("a line can never be split by what the browser sent", () => {
  const evil = "a\nb\r\nc d";
  const lines = clientLogLines({ accountId: "x", displayName: evil }, { sid: "s", events: [{ n: 1, t: 1, e: "drag", d: { id: evil, list: [evil] } }] }, evil);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes("\n"), false);
  assert.equal(lines[0].includes(" "), false);
  assert.equal(JSON.parse(lines[0]).data.id, "a b c d");
});

test("malformed input writes nothing and never throws", () => {
  for (const body of [null, undefined, "x", 5, {}, { events: "no" }, { events: [null, 1, "x", {}, { e: 5 }, { e: "Bad Name" }, { e: "" }] }]) {
    assert.deepEqual(clientLogLines(me, body, null), []);
  }
});

test("a batch is capped and so is each value", () => {
  const many = Array.from({ length: MAX_EVENTS_PER_BATCH + 25 }, (_, i) => ({ n: i, t: i, e: "tick", d: {} }));
  assert.equal(clientLogLines(me, { sid: "s", events: many }, null).length, MAX_EVENTS_PER_BATCH);
  const v = plainValue({ s: "x".repeat(1000), a: Array.from({ length: 500 }, (_, i) => i) }) as { s: string; a: number[] };
  assert.ok(v.s.length <= 160);
  assert.equal(v.a.length, 40);
});

test("only plain values survive: no functions, no NaN, no deep nesting", () => {
  assert.equal(plainValue(() => 1), undefined);
  assert.equal(plainValue(Number.NaN), null);
  assert.deepEqual(plainValue({ f: () => 1, ok: 1 }), { ok: 1 });
  const deep = plainValue({ a: { b: { c: { d: 1 } } } }) as Record<string, unknown>;
  assert.deepEqual(deep, { a: { b: {} } });
});

test("a bad session id is replaced, not trusted", () => {
  const o = JSON.parse(clientLogLines(me, { sid: "bad id\n", events: [{ n: 1, t: 1, e: "x", d: null }] }, null)[0]);
  assert.equal(o.sid, "?");
});
