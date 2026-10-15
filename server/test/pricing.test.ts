import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { costOf, costOfRows, parsePricing, priceFor } from "../src/ai/pricing.js";

const table = parsePricing("gemini-x-flash=0.30/2.50/0.075; gemini-x-pro=1.25/10", "usd");
const zero = { promptTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0 };

describe("parsePricing", () => {
  it("reads model=input/output[/cached] entries separated by semicolons", () => {
    assert.deepEqual(table.prices.get("gemini-x-flash"), { input: 0.3, output: 2.5, cached: 0.075 });
    // No third number: cached input is billed like ordinary input.
    assert.deepEqual(table.prices.get("gemini-x-pro"), { input: 1.25, output: 10, cached: 1.25 });
    assert.equal(table.currency, "USD");
  });

  it("skips malformed entries instead of guessing", () => {
    const t = parsePricing("a=1; b=x/2; c=1/2/3/4; =1/2; d; e=-1/2", undefined);
    assert.equal(t.prices.size, 0);
    assert.equal(t.currency, "USD");
  });

  it("empty or missing config is an empty table", () => {
    assert.equal(parsePricing("", "").prices.size, 0);
    assert.equal(parsePricing(undefined, undefined).prices.size, 0);
  });
});

describe("priceFor", () => {
  it("exact name, else the longest entry that prefixes it, else nothing", () => {
    assert.equal(priceFor(table, "gemini-x-flash")?.input, 0.3);
    assert.equal(priceFor(table, "gemini-x-flash-001")?.input, 0.3);
    assert.equal(priceFor(table, "gemini-y"), null);
    assert.equal(priceFor(table, null), null);
  });
});

describe("costOf", () => {
  const flash = table.prices.get("gemini-x-flash")!;

  it("prices uncached input, cached input, and output+thinking separately", () => {
    // prompt 1,000,000 of which 400,000 cached → 600k * 0.30 + 400k * 0.075 = 0.18 + 0.03
    // output 100,000 + thought 50,000 at 2.50 → 0.375
    const c = costOf(flash, { promptTokens: 1_000_000, cachedTokens: 400_000, outputTokens: 100_000, thoughtTokens: 50_000 });
    assert.ok(Math.abs(c - 0.585) < 1e-9, String(c));
  });

  it("never goes negative if cached exceeds prompt", () => {
    assert.ok(costOf(flash, { ...zero, promptTokens: 10, cachedTokens: 50 }) >= 0);
  });

  it("no tokens, no cost", () => {
    assert.equal(costOf(flash, zero), 0);
  });
});

describe("costOfRows", () => {
  it("sums per model, each at its own price", () => {
    const m = costOfRows(table, [
      { model: "gemini-x-flash", ...zero, promptTokens: 1_000_000 },
      { model: "gemini-x-pro", ...zero, promptTokens: 1_000_000 },
    ]);
    assert.ok(m && Math.abs(m.amount - 1.55) < 1e-9);
    assert.equal(m.partial, false);
  });

  it("marks the total partial when some tokens belong to an unpriced model", () => {
    const m = costOfRows(table, [
      { model: "gemini-x-flash", ...zero, promptTokens: 1_000_000 },
      { model: "mystery", ...zero, promptTokens: 5_000 },
    ]);
    assert.equal(m?.partial, true);
  });

  it("is null — not zero — when nothing could be priced", () => {
    assert.equal(costOfRows(table, [{ model: "mystery", ...zero, promptTokens: 5_000 }]), null);
    assert.equal(costOfRows(parsePricing("", ""), [{ model: "gemini-x-flash", ...zero, promptTokens: 5_000 }]), null);
  });
});
