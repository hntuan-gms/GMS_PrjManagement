import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { clearViewCache, dropViewCache, readViewCache, viewCacheScope, writeViewCache } from "../src/viewCache";

/** A Storage that lives in a Map, the way sessionStorage lives in a tab. */
function fakeStorage() {
  const m = new Map<string, string>();
  return {
    m,
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("view cache survives a reload", () => {
  const scope = viewCacheScope("site", "acc", "GPM");
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    clearViewCache(storage);
  });

  it("reads what was written, from memory", () => {
    writeViewCache(scope, "board", "7", { cards: 3 }, storage);
    assert.deepEqual(readViewCache(scope, "board", "7", storage), { cards: 3 });
  });

  it("after the page reloads (memory gone, storage kept) the answer is still there", () => {
    writeViewCache(scope, "progress", "x", { pct: 42 }, storage);
    // A reload wipes module memory but not sessionStorage; clearViewCache(null) is "memory only".
    clearViewCache(null);
    assert.deepEqual(readViewCache(scope, "progress", "x", storage), { pct: 42 });
  });

  it("is keyed by site, account and project: another account never reads it", () => {
    writeViewCache(scope, "board", "7", { cards: 3 }, storage);
    clearViewCache(null);
    assert.equal(readViewCache(viewCacheScope("site", "someone-else", "GPM"), "board", "7", storage), undefined);
  });

  it("an entry that is dropped, or cleared on logout, does not come back", () => {
    writeViewCache(scope, "resource", "", { ok: true }, storage);
    writeViewCache(scope, "board", "7", { cards: 3 }, storage);
    dropViewCache(scope, "resource", "", storage);
    clearViewCache(null);
    assert.equal(readViewCache(scope, "resource", "", storage), undefined);
    assert.deepEqual(readViewCache(scope, "board", "7", storage), { cards: 3 });
    clearViewCache(storage);
    assert.equal(storage.m.size, 0);
    assert.equal(readViewCache(scope, "board", "7", storage), undefined);
  });

  it("a storage that refuses writes still works from memory; a corrupt entry reads as missing", () => {
    const broken = { ...storage, setItem: () => { throw new Error("quota"); } };
    writeViewCache(scope, "board", "7", { cards: 3 }, broken);
    assert.deepEqual(readViewCache(scope, "board", "7", broken), { cards: 3 });
    clearViewCache(null);
    storage.m.set("gms.viewCache.v1." + scope + "|board|9", "{not json");
    assert.equal(readViewCache(scope, "board", "9", storage), undefined);
  });
});
