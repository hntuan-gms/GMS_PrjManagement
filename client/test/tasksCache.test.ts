import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clearTasksCache, loadBigTasksCache, loadTasksCache, saveTasksCache, tasksCacheKey } from "../src/tasksCache";
import { task } from "./fixtures";

/** A Storage that lives in a map, with the same surface the cache module uses. */
function fakeStorage(limit = Infinity) {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (v.length > limit) throw new Error("QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
  };
}

const users = [{ accountId: "a", displayName: "An", avatarUrl: null }];

describe("tasks cache", () => {
  it("is keyed by site, account and project — another account never gets it", () => {
    const s = fakeStorage();
    const mine = tasksCacheKey("c1", "me", "DEMO");
    saveTasksCache(mine, [task({ id: "DEMO-1", summary: "x" })], users, s);
    assert.equal(loadTasksCache(tasksCacheKey("c1", "someone-else", "DEMO"), s), null);
    assert.equal(loadTasksCache(tasksCacheKey("c1", "me", "OTHER"), s), null);
    assert.equal(loadTasksCache(mine, s)?.tasks[0].id, "DEMO-1");
  });

  it("a damaged or foreign value reads as no cache rather than throwing", () => {
    const s = fakeStorage();
    const k = tasksCacheKey("c1", "me", "DEMO");
    for (const bad of ["not json", "{}", '{"tasks":1,"users":[],"savedAt":"x"}', "null"]) {
      s.map.set(k, bad);
      assert.equal(loadTasksCache(k, s), null, bad);
    }
  });

  it("a full storage just means no cache — saving never throws", () => {
    const s = fakeStorage(10);
    assert.doesNotThrow(() => saveTasksCache(tasksCacheKey("c1", "me", "DEMO"), [task({ id: "DEMO-1", summary: "x" })], users, s));
    assert.equal(s.map.size, 0);
  });

  it("logout clears every account's entries and leaves other keys alone", () => {
    const s = fakeStorage();
    saveTasksCache(tasksCacheKey("c1", "me", "DEMO"), [], users, s);
    saveTasksCache(tasksCacheKey("c1", "you", "DEMO"), [], users, s);
    s.setItem("gms.taskFilter.c1.DEMO", "{}");
    clearTasksCache(s);
    assert.deepEqual([...s.map.keys()], ["gms.taskFilter.c1.DEMO"]);
  });
});

describe("a project too big for localStorage goes to IndexedDB", () => {
  function fakeIdb() {
    const m = new Map<string, unknown>();
    return {
      m,
      get: async <T,>(k: string) => (m.get(k) as T | undefined) ?? null,
      put: async (k: string, v: unknown) => void m.set(k, v),
      del: async (k: string) => void m.delete(k),
      clear: async () => void m.clear(),
    };
  }
  const key = tasksCacheKey("c1", "me", "AI");
  const big = [task({ id: "AI-1", summary: "x".repeat(200) })];

  it("over the limit: not in localStorage (and no stale small copy), but in IndexedDB, and read back", async () => {
    const s = fakeStorage();
    const idb = fakeIdb();
    saveTasksCache(key, [task({ id: "AI-0", summary: "old" })], users, s, idb, 1_000_000);
    saveTasksCache(key, big, users, s, idb, 100);
    assert.equal(loadTasksCache(key, s), null, "the small copy must not outlive the new, bigger one");
    assert.equal((await loadBigTasksCache(key, idb))?.tasks[0].id, "AI-1");
  });

  it("under the limit: localStorage only, and an older big copy is dropped", async () => {
    const s = fakeStorage();
    const idb = fakeIdb();
    saveTasksCache(key, big, users, s, idb, 100);
    saveTasksCache(key, [task({ id: "AI-2", summary: "s" })], users, s, idb, 1_000_000);
    assert.equal(loadTasksCache(key, s)?.tasks[0].id, "AI-2");
    assert.equal(await loadBigTasksCache(key, idb), null);
  });

  it("logout clears IndexedDB too; nothing malformed is trusted", async () => {
    const s = fakeStorage();
    const idb = fakeIdb();
    saveTasksCache(key, big, users, s, idb, 100);
    clearTasksCache(s, idb);
    assert.equal(await loadBigTasksCache(key, idb), null);
    idb.m.set(key, { tasks: "nope" });
    assert.equal(await loadBigTasksCache(key, idb), null);
  });

  it("a failing IndexedDB is just no cache", async () => {
    const broken = { get: async () => null, put: async () => { throw new Error("x"); }, del: async () => {}, clear: async () => {} };
    assert.doesNotThrow(() => saveTasksCache(key, big, users, fakeStorage(), broken, 100));
  });
});
