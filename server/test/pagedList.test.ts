import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readAllPages, type StartAtPage } from "../src/pagedList.js";

/** A startAt-paged endpoint over `n` items, `size` per page, counting overlap. */
function endpoint(n: number, size: number, opts: { omitTotal?: boolean; shortPages?: boolean } = {}) {
  const asked: number[] = [];
  let active = 0;
  let peak = 0;
  const readPage = async (startAt: number): Promise<StartAtPage<number>> => {
    asked.push(startAt);
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    const values = Array.from({ length: Math.max(0, Math.min(size, n - startAt)) }, (_, i) => startAt + i);
    return { values, isLast: startAt + size >= n, ...(opts.omitTotal ? {} : { total: n }) };
  };
  return { readPage, asked, peak: () => peak };
}

describe("readAllPages", () => {
  it("reads the pages after the first together, in order", async () => {
    const e = endpoint(230, 50);
    const all = await readAllPages(e.readPage);
    assert.deepEqual(all, Array.from({ length: 230 }, (_, i) => i));
    assert.deepEqual(e.asked.sort((a, b) => a - b), [0, 50, 100, 150, 200]);
    assert.equal(e.peak(), 4, "the four later pages were asked at once");
  });

  it("one request when everything fits the first page", async () => {
    const e = endpoint(12, 50);
    assert.equal((await readAllPages(e.readPage)).length, 12);
    assert.deepEqual(e.asked, [0]);
  });

  it("without a total it pages one after another, as before", async () => {
    const e = endpoint(120, 50, { omitTotal: true });
    assert.equal((await readAllPages(e.readPage)).length, 120);
    assert.equal(e.peak(), 1);
  });

  it("a total that overstates what exists ends at the last real item, no loop", async () => {
    const e = endpoint(120, 50);
    const lying = async (startAt: number) => ({ ...(await e.readPage(startAt)), isLast: false, total: 200 });
    const all = await readAllPages(lying);
    assert.deepEqual(all, Array.from({ length: 120 }, (_, i) => i));
  });

  it("an empty list is empty", async () => {
    assert.deepEqual(await readAllPages(endpoint(0, 50).readPage), []);
  });
});
