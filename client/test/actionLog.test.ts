import assert from "node:assert/strict";
import { test } from "node:test";
import { createActionLog, type LogEvent } from "../src/actionLogCore";

function harness(extra: Partial<Parameters<typeof createActionLog>[0]> = {}) {
  const sent: { sid: string; events: LogEvent[] }[] = [];
  const timers: Array<() => void> = [];
  let clock = 1000;
  const log = createActionLog({
    send: (b) => sent.push(b),
    now: () => clock++,
    setTimer: (fn) => (timers.push(fn), timers.length),
    sid: "tab1",
    ...extra,
  });
  return { log, sent, timers };
}

test("events are numbered, timed and held until the timer fires, then sent together", () => {
  const { log, sent, timers } = harness();
  log.log("drag", { id: "GPM-1" });
  log.log("undo", {});
  assert.equal(sent.length, 0);
  assert.equal(timers.length, 1, "one timer for the whole burst");
  timers[0]();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].sid, "tab1");
  assert.deepEqual(sent[0].events.map((e) => [e.n, e.t, e.e]), [[1, 1000, "drag"], [2, 1001, "undo"]]);
});

test("a long burst goes out in batches no bigger than the server takes", () => {
  const { log, sent } = harness({ batchSize: 3 });
  for (let i = 0; i < 7; i++) log.log("tick");
  log.flush();
  assert.deepEqual(sent.map((b) => b.events.length), [3, 3, 1]);
});

test("when too many wait, the oldest are dropped, never the newest", () => {
  const { log, sent } = harness({ maxWaiting: 5 });
  for (let i = 0; i < 9; i++) log.log("tick");
  log.flush();
  assert.deepEqual(sent.flatMap((b) => b.events.map((e) => e.n)), [5, 6, 7, 8, 9]);
});

test("a failing send is swallowed", () => {
  const log = createActionLog({ send: () => { throw new Error("offline"); }, setTimer: () => 1 });
  log.log("drag");
  assert.doesNotThrow(() => log.flush());
});
