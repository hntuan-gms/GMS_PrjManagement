import assert from "node:assert/strict";
import { test } from "node:test";
import { createKeyedMutex } from "../src/keyedMutex.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("work for one key never overlaps and keeps the order it arrived in", async () => {
  const run = createKeyedMutex();
  const trace: string[] = [];
  const job = (name: string, ms: number) => async () => {
    trace.push(`start ${name}`);
    await sleep(ms);
    trace.push(`end ${name}`);
    return name;
  };
  const out = await Promise.all([run("GPM", job("a", 30)), run("GPM", job("b", 5)), run("GPM", job("c", 1))]);
  assert.deepEqual(out, ["a", "b", "c"]);
  assert.deepEqual(trace, ["start a", "end a", "start b", "end b", "start c", "end c"]);
});

test("different keys do not wait for each other", async () => {
  const run = createKeyedMutex();
  const trace: string[] = [];
  await Promise.all([
    run("GPM", async () => {
      trace.push("GPM start");
      await sleep(30);
      trace.push("GPM end");
    }),
    run("ADT", async () => {
      trace.push("ADT start");
      await sleep(1);
      trace.push("ADT end");
    }),
  ]);
  assert.deepEqual(trace.slice(0, 2), ["GPM start", "ADT start"]);
  assert.ok(trace.indexOf("ADT end") < trace.indexOf("GPM end"));
});

test("a failed job does not block the one behind it, and its error still reaches its caller", async () => {
  const run = createKeyedMutex();
  const failing = run("GPM", async () => {
    await sleep(5);
    throw new Error("Jira said no");
  });
  const next = run("GPM", async () => "ok");
  await assert.rejects(failing, /Jira said no/);
  assert.equal(await next, "ok");
});

test("nothing is kept once the queue is empty", async () => {
  const run = createKeyedMutex();
  await run("GPM", async () => 1);
  await run("GPM", async () => 2);
  // A new job starts at once (no stale tail to wait on).
  const t0 = Date.now();
  await run("GPM", async () => 3);
  assert.ok(Date.now() - t0 < 50);
});
