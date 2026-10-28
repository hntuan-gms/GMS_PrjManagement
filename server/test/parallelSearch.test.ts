import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  issueNumber,
  keyRanges,
  PARALLEL_MIN_ISSUES,
  RANGE_CONCURRENCY,
  searchProjectIssues,
  shareInflight,
  type ProjectSearcher,
} from "../src/parallelSearch.js";

/** A project of issues P-1..P-n; understands exactly the JQL shapes the module sends. */
function fakeJira(n: number, opts: { count?: number | null; missing?: Set<number>; legacy?: number; legacyInComplement?: boolean } = {}) {
  const log: string[] = [];
  let active = 0;
  let peak = 0;
  const jira: ProjectSearcher = {
    async searchIssues(jql, _fields, limit) {
      log.push(jql);
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      let from = 1;
      let to = n;
      const range = jql.includes("AND NOT (") ? null : jql.match(/key >= P-(\d+) AND key <= P-(\d+)/);
      if (range) [from, to] = [Number(range[1]), Number(range[2])];
      const desc = jql.includes("ORDER BY key DESC");
      const complement = jql.includes("AND NOT (key >=");
      const keys: number[] = [];
      for (let i = from; i <= to; i++) if (!opts.missing?.has(i)) keys.push(i);
      if (complement) keys.length = 0; // every P-n is inside the range the complement excludes
      if (desc) keys.reverse();
      const out = keys.map((i) => ({ key: `P-${i}` }));
      // Issues no key range can reach (an older key): only the whole-project and complement queries see them.
      const reachable = !range && !desc && (!complement || opts.legacyInComplement !== false);
      if (reachable) for (let i = 1; i <= (opts.legacy ?? 0); i++) out.push({ key: `OLD-${i}` });
      return limit === undefined ? out : out.slice(0, limit);
    },
    async countIssues() {
      return opts.count === undefined ? n - (opts.missing?.size ?? 0) + (opts.legacy ?? 0) : opts.count;
    },
  };
  return { jira, log, peak: () => peak };
}

describe("keyRanges", () => {
  it("covers 1..max exactly, with a short last range", () => {
    assert.deepEqual(keyRanges(7, 3), [
      { from: 1, to: 3 },
      { from: 4, to: 6 },
      { from: 7, to: 7 },
    ]);
    assert.deepEqual(keyRanges(6, 3), [
      { from: 1, to: 3 },
      { from: 4, to: 6 },
    ]);
    assert.deepEqual(keyRanges(0), []);
  });
});

describe("issueNumber", () => {
  it("reads the trailing number of a key", () => {
    assert.equal(issueNumber("AI-4044"), 4044);
    assert.equal(issueNumber("AI"), null);
    assert.equal(issueNumber(undefined), null);
  });
});

describe("searchProjectIssues", () => {
  it("reads a big project in key ranges, in key order, with bounded concurrency", async () => {
    const { jira, log, peak } = fakeJira(2000);
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.equal(res.issues.length, 2000);
    assert.deepEqual(
      res.issues.map((i) => i.key),
      Array.from({ length: 2000 }, (_, i) => `P-${i + 1}`)
    );
    assert.equal(res.requests, 7); // ceil(2000 / 300)
    assert.ok(peak() <= RANGE_CONCURRENCY + 1, `peak ${peak()}`);
    assert.ok(log.some((q) => q.includes("key >= P-1 AND key <= P-300")));
  });

  it("reads a small project in one ordinary query", async () => {
    const { jira, log } = fakeJira(PARALLEL_MIN_ISSUES - 1);
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "sequential");
    assert.equal(res.issues.length, PARALLEL_MIN_ISSUES - 1);
    assert.ok(log.some((q) => q.endsWith("ORDER BY created ASC")));
  });

  it("asks for what the ranges cannot reach as a complement, instead of re-reading everything", async () => {
    const { jira, log } = fakeJira(1000, { legacy: 120 });
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.equal(res.issues.length, 1120);
    assert.equal(new Set(res.issues.map((i) => i.key)).size, 1120, "no issue twice");
    assert.ok(log.some((q) => q.includes("AND NOT (key >= P-1 AND key <= P-1000)")));
    assert.ok(!log.some((q) => q.endsWith("ORDER BY created ASC") && !q.includes("NOT")), "the slow full read must not run");
  });

  it("falls back to the full read when even the complement leaves it short", async () => {
    const { jira } = fakeJira(1000, { legacy: 120, legacyInComplement: false });
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "sequential");
    assert.equal(res.issues.length, 1120);
    assert.match(res.reason ?? "", /ranges \+ rest found 1000 of 1120/);
  });

  it("falls back to the full read when the ranges came up short of Jira's count", async () => {
    // Say Jira counts 1000 issues but only 900 have a number the ranges can find.
    const { jira } = fakeJira(1000, { count: 1100 });
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "sequential");
  });

  it("falls back when the count is unavailable", async () => {
    const { jira } = fakeJira(1000, { count: null });
    assert.equal((await searchProjectIssues(jira, "P", ["summary"])).mode, "sequential");
  });

  it("falls back to the full read when a range query fails", async () => {
    const real = fakeJira(1000);
    const jira: ProjectSearcher = {
      countIssues: real.jira.countIssues,
      searchIssues(jql, fields, limit) {
        if (jql.includes("key >= P-")) return Promise.reject(new Error("Jira said no"));
        return real.jira.searchIssues(jql, fields, limit);
      },
    };
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "sequential");
    assert.equal(res.issues.length, 1000);
  });

  it("tolerates gaps in the numbering (deleted or moved issues)", async () => {
    const missing = new Set([5, 17, 400, 401]);
    const { jira } = fakeJira(1000, { missing });
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.equal(res.issues.length, 1000 - missing.size);
  });
});

describe("shareInflight", () => {
  it("runs once for concurrent callers with the same key, and again after it settles", async () => {
    let runs = 0;
    const run = async () => {
      runs++;
      await new Promise((r) => setTimeout(r, 10));
      return runs;
    };
    const [a, b] = await Promise.all([shareInflight("k", run), shareInflight("k", run)]);
    assert.equal(a, 1);
    assert.equal(b, 1);
    assert.equal(runs, 1);
    assert.equal(await shareInflight("k", run), 2);
  });

  it("does not share between different keys, and lets a failure be retried", async () => {
    let runs = 0;
    await Promise.all([shareInflight("a", async () => ++runs), shareInflight("b", async () => ++runs)]);
    assert.equal(runs, 2);
    await assert.rejects(shareInflight("x", async () => Promise.reject(new Error("boom"))));
    assert.equal(await shareInflight("x", async () => "ok"), "ok");
  });
});
