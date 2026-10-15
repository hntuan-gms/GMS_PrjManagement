/**
 * Turning Gemini's token counters into money.
 *
 * The price table is configuration, never code: model names are added and retired
 * continuously and prices change, so a rate written into source is wrong within
 * weeks (the same reason GEMINI_MODEL is an env var). No entry for a model means
 * NO cost is shown for it — a made-up figure is worse than none.
 *
 *   GEMINI_PRICING="gemini-2.5-flash=0.30/2.50/0.075;gemini-2.5-pro=1.25/10"
 *   GEMINI_PRICING_CURRENCY=USD
 *
 * Each entry is `model=input/output[/cached]`, in `currency` per **1 million**
 * tokens. Semicolons rather than JSON: the deploy action's env_vars treat commas
 * as separators.
 */

export interface ModelPrice {
  /** Per 1M input tokens. */
  input: number;
  /** Per 1M output tokens — thinking tokens are billed at this rate too. */
  output: number;
  /** Per 1M cached input tokens; defaults to `input` when the entry has no third number. */
  cached: number;
}

export interface PriceTable {
  currency: string;
  prices: Map<string, ModelPrice>;
}

export interface Counters {
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  cachedTokens: number;
}

export interface Money {
  amount: number;
  currency: string;
  /** True when some of the tokens counted belong to a model with no price, so the amount is a lower bound. */
  partial: boolean;
}

export function parsePricing(spec: string | undefined, currency: string | undefined): PriceTable {
  const prices = new Map<string, ModelPrice>();
  for (const entry of (spec ?? "").split(";")) {
    const [rawModel, rawNums] = entry.split("=");
    const model = rawModel?.trim();
    if (!model || !rawNums) continue;
    const nums = rawNums.split("/").map((n) => Number(n.trim()));
    if (nums.length < 2 || nums.length > 3 || nums.some((n) => !Number.isFinite(n) || n < 0)) continue;
    prices.set(model, { input: nums[0], output: nums[1], cached: nums[2] ?? nums[0] });
  }
  return { currency: (currency ?? "").trim().toUpperCase() || "USD", prices };
}

/** The price for `model`: an exact entry, else the longest entry that prefixes it ("gemini-2.5-flash" covers "gemini-2.5-flash-001"). */
export function priceFor(table: PriceTable, model: string | null): ModelPrice | null {
  if (!model) return null;
  const exact = table.prices.get(model);
  if (exact) return exact;
  let best: string | null = null;
  for (const key of table.prices.keys()) {
    if (model.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  return best ? table.prices.get(best)! : null;
}

/**
 * Cost of one set of counters. Gemini's prompt count INCLUDES the cached part, so
 * the uncached share is the difference; thinking tokens are output-priced.
 */
export function costOf(price: ModelPrice, c: Counters): number {
  const uncached = Math.max(0, c.promptTokens - c.cachedTokens);
  return (uncached * price.input + c.cachedTokens * price.cached + (c.outputTokens + c.thoughtTokens) * price.output) / 1_000_000;
}

/** Sums rows that each carry their own model. Null when none of them has a price. */
export function costOfRows(table: PriceTable, rows: Array<Counters & { model: string | null }>): Money | null {
  let amount = 0;
  let priced = 0;
  let unpriced = 0;
  for (const r of rows) {
    const price = priceFor(table, r.model);
    const tokens = r.promptTokens + r.outputTokens + r.thoughtTokens;
    if (!price) {
      if (tokens > 0) unpriced += 1;
      continue;
    }
    amount += costOf(price, r);
    priced += 1;
  }
  if (priced === 0) return null;
  return { amount, currency: table.currency, partial: unpriced > 0 };
}

/** Read from the environment on each call: tests and dotenv both change it after import. */
export function priceTable(): PriceTable {
  return parsePricing(process.env.GEMINI_PRICING, process.env.GEMINI_PRICING_CURRENCY);
}
