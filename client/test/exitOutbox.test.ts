import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOps, clearOutbox, loadOutbox, OUTBOX_MAX_AGE_MS, outboxKey, saveOutbox } from "../src/exitOutbox";
import { clearTasksCache, tasksCacheKey } from "../src/tasksCache";
import type { SyncOp } from "../src/scheduleSync";
import type { Task } from "../src/types";

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  };
}
const ops: SyncOp[] = [{ id: "GPM-1", patch: { startDate: "2026-12-08", durationDays: 2 } }, { id: "GPM-2", patch: { percentComplete: 40 } }];
const task = (id: string, startDate: string | null, durationDays: number, percentComplete = 0, dueDate: string | null = null) =>
  ({ id, startDate, durationDays, percentComplete, dueDate }) as unknown as Task;

test("what was saved at the exit comes back to the next page", () => {
  const s = memory();
  const key = outboxKey("tasks.cloud.acc.GPM");
  saveOutbox(key, ops, 1_000, s);
  assert.deepEqual(loadOutbox(key, 2_000, s), ops);
});

test("it is dropped once it is too old to be what the person last saw", () => {
  const s = memory();
  const key = outboxKey("k");
  saveOutbox(key, ops, 0, s);
  assert.equal(loadOutbox(key, OUTBOX_MAX_AGE_MS - 1, s)?.length, 2);
  assert.equal(loadOutbox(key, OUTBOX_MAX_AGE_MS + 1, s), null);
});

test("another account or project has another key, so nothing leaks between them", () => {
  assert.notEqual(outboxKey("gms.tasksCache.v1.cloud.alice.GPM"), outboxKey("gms.tasksCache.v1.cloud.bob.GPM"));
  assert.notEqual(outboxKey("gms.tasksCache.v1.cloud.alice.GPM"), outboxKey("gms.tasksCache.v1.cloud.alice.ADT"));
});

test("an empty list clears the entry; clearing removes it", () => {
  const s = memory();
  const key = outboxKey("k");
  saveOutbox(key, ops, 0, s);
  saveOutbox(key, [], 1, s);
  assert.equal(s.raw.size, 0);
  saveOutbox(key, ops, 2, s);
  clearOutbox(key, s);
  assert.equal(loadOutbox(key, 3, s), null);
});

test("garbage in storage is ignored, never thrown", () => {
  const s = memory();
  const key = outboxKey("k");
  for (const raw of ["", "not json", "null", "{}", '{"at":"x","ops":[]}', '{"at":1,"ops":"x"}', '{"at":1,"ops":[null,5,{"id":3}]}']) {
    s.raw.set(key, raw);
    assert.equal(loadOutbox(key, 2, s), null, raw);
  }
});

test("a broken or missing storage never throws", () => {
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("full");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  assert.doesNotThrow(() => saveOutbox("k", ops, 0, broken));
  assert.doesNotThrow(() => clearOutbox("k", broken));
  assert.equal(loadOutbox("k", 0, broken), null);
  assert.equal(loadOutbox("k", 0, null), null);
});

test("the ops are drawn on the tasks: dates, duration, percentage and the due date that follows", () => {
  const tasks = [task("GPM-1", "2026-11-26", 3, 0, "2026-11-28"), task("GPM-2", "2026-11-01", 2, 0, "2026-11-02"), task("GPM-3", "2026-11-05", 1)];
  const out = applyOps(tasks, ops);
  assert.equal(out[0].startDate, "2026-12-08");
  assert.equal(out[0].durationDays, 2);
  assert.equal(out[0].dueDate, "2026-12-09");
  assert.equal(out[1].percentComplete, 40);
  assert.equal(out[1].startDate, "2026-11-01");
  assert.equal(out[1].dueDate, "2026-11-02", "a percentage alone leaves the dates");
  assert.equal(out[2], tasks[2], "a task no op names is the same object");
});

test("a task put back to no start date keeps no start date", () => {
  const out = applyOps([task("GPM-1", "2026-11-26", 3, 0, "2026-11-28")], [{ id: "GPM-1", patch: { startDate: null, durationDays: 3 } }]);
  assert.equal(out[0].startDate, null);
});

test("no ops: the same array comes back", () => {
  const tasks = [task("GPM-1", "2026-11-26", 3)];
  assert.equal(applyOps(tasks, []), tasks);
});

test("logging out clears the unwritten changes with the rest of the account's cached data", () => {
  const m = new Map<string, string>();
  const storage = {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
  const key = outboxKey(tasksCacheKey("cloud", "acc", "GPM"));
  saveOutbox(key, ops, 0, storage);
  m.set("gms.theme", "dark");
  clearTasksCache(storage, { clear: async () => undefined } as never);
  assert.equal(loadOutbox(key, 1, storage), null);
  assert.equal(m.get("gms.theme"), "dark", "other settings stay");
});
