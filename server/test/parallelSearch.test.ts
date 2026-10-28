import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COUNT_CONCURRENCY,
  createdDay,
  limiter,
  named,
  PARALLEL_MIN_ISSUES,
  READ_CONCURRENCY,
  searchProjectIssues,
  shareInflight,
  SLICE_SIZE_BIG_PAGES,
  waysFor,
  SLICE_SIZE,
  type ProjectSearcher,
} from "../src/parallelSearch.js";

const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * A project of `n` issues, the i-th created on `dayOf(i)`. Understands exactly the JQL shapes the
 * module sends. Keys are deliberately NOT in creation order and some are foreign ("OLD-n"), because
 * production issues were: slicing must not depend on them.
 */
function fakeJira(n: number, opts: { dayOf?: (i: number) => number; count?: number | null; hide?: number; serverPage?: number } = {}) {
  const dayOf = opts.dayOf ?? ((i: number) => Math.floor(i / 10));
  const all = Array.from({ length: n }, (_, i) => ({
    key: i % 7 === 0 ? `OLD-${i}` : `P-${i}`,
    fields: { created: `${day(dayOf(i))}T${String(8 + (i % 10)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000+0700` },
  })).sort((a, b) => a.fields.created.localeCompare(b.fields.created));
  const log: string[] = [];
  let active = 0;
  let peak = 0;
  const filter = (jql: string) => {
    // Boundaries are "yyyy-MM-dd HH:mm"; compared as text against the issue's own "yyyy-MM-dd HH:mm".
    const from = jql.match(/created >= "([^"]+)"/)?.[1];
    const to = jql.match(/created < "([^"]+)"/)?.[1];
    const at = (x: { fields: { created: string } }) => x.fields.created.slice(0, 16).replace("T", " ");
    return all.filter((x) => (!from || at(x) >= from) && (!to || at(x) < to));
  };
  const jira: ProjectSearcher = {
    async searchIssues(jql, _fields, limit, o) {
      log.push(jql);
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 3));
      active--;
      let out = filter(jql);
      if (jql.includes("ORDER BY created DESC")) out = [...out].reverse();
      if (opts.hide && !limit && jql.includes("created >=")) out = out.slice(0, Math.max(0, out.length - opts.hide));
      // What a page really holds: what was asked for, clamped by the server.
      const page = Math.min(o?.pageSize ?? 100, opts.serverPage ?? 100, limit ?? Infinity);
      o?.onPage?.(Math.min(out.length, page));
      if (o?.maxPages === 1) return out.slice(0, page);
      return limit === undefined ? out : out.slice(0, limit);
    },
    async countIssues(jql) {
      log.push("COUNT " + jql);
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return opts.count === undefined ? filter(jql).length : opts.count;
    },
  };
  return { jira, all, log, peak: () => peak };
}

describe("createdDay", () => {
  it("reads the day part of a Jira timestamp", () => {
    assert.equal(createdDay({ fields: { created: "2026-03-01T23:30:00.000+0700" } }), "2026-03-01");
    assert.equal(createdDay({ fields: {} }), null);
    assert.equal(createdDay(undefined), null);
  });
});

describe("waysFor", () => {
  it("cuts a slice so each piece should land under the limit, never fewer than two nor more than the cap", () => {
    assert.equal(waysFor(4044, 200), 29);
    assert.equal(waysFor(4044, 500), 12);
    assert.equal(waysFor(250, 200), 2);
    assert.equal(waysFor(100000, 100), 32);
    assert.ok(waysFor(4044, 200) * 200 * 0.7 >= 4044 - 200, "pieces would not average under the limit");
  });
});

describe("limiter", () => {
  it("never runs more than the limit at once, and returns each caller its own result", async () => {
    const limited = limiter(3);
    let active = 0;
    let peak = 0;
    const out = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        limited(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 4));
          active--;
          return i;
        })
      )
    );
    assert.deepEqual(out, Array.from({ length: 12 }, (_, i) => i));
    assert.equal(peak, 3);
  });
});

describe("named", () => {
  const status = (n: number, body = "") => Object.assign(new Error(`Jira API error ${n}`), { status: n, body });

  it("retries a 5xx and returns the later success", async () => {
    let calls = 0;
    const out = await named("x", async () => {
      if (++calls < 3) throw status(502);
      return "ok";
    });
    assert.equal(out, "ok");
    assert.equal(calls, 3);
  });

  it("gives up after the retries, naming the call and what Jira said", async () => {
    let calls = 0;
    await assert.rejects(
      named("slice 2026-01-01..2026-01-09", async () => {
        calls++;
        throw status(502, "<html>Bad   Gateway</html>");
      }),
      /slice 2026-01-01\.\.2026-01-09: Jira API error 502 \(<html>Bad Gateway<\/html>\)/
    );
    assert.equal(calls, 3);
  });

  it("does not retry a 4xx (a query Jira refuses will be refused again)", async () => {
    let calls = 0;
    await assert.rejects(
      named("count", async () => {
        calls++;
        throw status(400, "bad jql");
      }),
      /count: Jira API error 400/
    );
    assert.equal(calls, 1);
  });
});

describe("searchProjectIssues", () => {
  it("reads a big project in creation-day slices: every issue once, oldest first, bounded concurrency", async () => {
    const { jira, all, peak } = fakeJira(4000);
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.equal(res.issues.length, 4000);
    assert.equal(new Set(res.issues.map((i) => i.key)).size, 4000, "an issue twice");
    assert.deepEqual(res.issues.map((i) => i.key), all.map((i) => i.key), "not oldest first");
    assert.ok(res.requests >= 4000 / SLICE_SIZE, `only ${res.requests} slices`);
    assert.match(res.detail ?? "", /^page \d+, \d+ counts planned in \d+ms, all read at \d+ms, biggest slice \d+$/);
    assert.ok(peak() <= COUNT_CONCURRENCY + READ_CONCURRENCY + 2, `peak ${peak()}`);
  });

  it("asks for bigger pages and, when Jira hands them out, cuts the project into far fewer slices", async () => {
    const small = fakeJira(4000);
    const smallRes = await searchProjectIssues(small.jira, "P", ["summary"]);
    const big = fakeJira(4000, { serverPage: 1000 });
    const bigRes = await searchProjectIssues(big.jira, "P", ["summary"]);
    assert.equal(bigRes.mode, "parallel");
    assert.equal(bigRes.issues.length, 4000);
    assert.match(bigRes.detail ?? "", /^page 1000,/);
    assert.match(smallRes.detail ?? "", /^page 100,/);
    assert.ok(bigRes.requests < smallRes.requests / 2, `${bigRes.requests} vs ${smallRes.requests} slices`);
    assert.ok(bigRes.requests >= 4000 / SLICE_SIZE_BIG_PAGES);
  });

  it("does not depend on issue keys at all (foreign prefixes, gaps)", async () => {
    const { jira, all } = fakeJira(900);
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.equal(res.issues.length, 900);
    assert.ok(all.some((i) => i.key.startsWith("OLD-")));
  });

  it("cuts a single busy day into minutes: a day holding a thousand issues is not one long chain of pages", async () => {
    const { jira } = fakeJira(1000, { dayOf: () => 5 });
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.equal(res.issues.length, 1000);
    assert.ok(res.requests >= 1000 / SLICE_SIZE, `only ${res.requests} slices for one day`);
  });

  it("everything created in the same minute cannot be cut further: that slice is read whole", async () => {
    const real = fakeJira(600, { dayOf: () => 5 });
    const same = real.all.map((x) => ({ ...x, fields: { created: "2026-01-06T09:00:00.000+0700" } }));
    real.all.splice(0, real.all.length, ...same);
    const res = await searchProjectIssues(real.jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.equal(res.issues.length, 600);
  });

  it("copes with a burst: most issues on a few days, a few spread out", async () => {
    const { jira } = fakeJira(2000, { dayOf: (i) => (i < 1800 ? 40 + (i % 3) : i % 120) });
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.equal(res.issues.length, 2000);
  });

  it("reads a small project in one ordinary query", async () => {
    const { jira, log } = fakeJira(PARALLEL_MIN_ISSUES - 1);
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "sequential");
    assert.equal(res.issues.length, PARALLEL_MIN_ISSUES - 1);
    assert.ok(log.some((q) => q.endsWith("ORDER BY created ASC")));
  });

  it("falls back to the full read, saying why, when the slices come up short of Jira's count", async () => {
    const { jira } = fakeJira(1000, { hide: 40 });
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "sequential");
    assert.equal(res.issues.length, 1000);
    assert.match(res.reason ?? "", /slices found \d+ of 1000 counted/);
  });

  it("falls back when the count is unavailable", async () => {
    const { jira } = fakeJira(1000, { count: null });
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "sequential");
    assert.match(res.reason ?? "", /no count/);
  });

  it("falls back to the full read when a slice query fails", async () => {
    const real = fakeJira(1000);
    const jira: ProjectSearcher = {
      countIssues: real.jira.countIssues,
      searchIssues(jql, fields, limit) {
        if (jql.includes("created >=") && !limit) return Promise.reject(new Error("Jira said no"));
        return real.jira.searchIssues(jql, fields, limit);
      },
    };
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "sequential");
    assert.equal(res.issues.length, 1000);
    assert.match(res.reason ?? "", /Jira said no/);
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
