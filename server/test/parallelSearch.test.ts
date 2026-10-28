import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chunks,
  COUNT_CONCURRENCY,
  createdDay,
  FIRST_PAGE,
  ID_CHUNK,
  limiter,
  named,
  READ_CONCURRENCY,
  searchProjectIssues,
  shareInflight,
  SLICE_SIZE,
  waysFor,
  type ProjectSearcher,
} from "../src/parallelSearch.js";

const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);

interface FakeOptions {
  dayOf?: (i: number) => number;
  /** Jira's count; undefined = the true number of issues. */
  count?: number | null;
  /** What a page of ids-only really holds (Jira clamps the 5000 asked for); 100 makes listing the ids a chain. */
  idPage?: number;
  /** Issues `id in (…)` does not find (named by key here for readability). */
  hiddenFromIdQuery?: Set<string>;
  /** Makes every `id in (…)` query fail. */
  idQueryFails?: boolean;
  /** Makes the first page of full issues fail. */
  firstPageFails?: boolean;
  /** Issues the time slices do not return. */
  hiddenFromSlices?: number;
  /** Every request is refused for rate, as Jira does when the hourly quota is spent. */
  rateLimited?: boolean;
}

/**
 * A project of `n` issues, the i-th created on `dayOf(i)`. Understands exactly the JQL shapes the
 * module sends. Keys are deliberately NOT in creation order and some are foreign ("OLD-n"), because
 * production issues were: nothing may depend on them.
 */
function fakeJira(n: number, opts: FakeOptions = {}) {
  const dayOf = opts.dayOf ?? ((i: number) => Math.floor(i / 10));
  const all = Array.from({ length: n }, (_, i) => ({
    key: i % 7 === 0 ? `OLD-${i}` : `P-${i}`,
    id: String(10000 + i),
    fields: { created: `${day(dayOf(i))}T${String(8 + (i % 10)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000+0700` },
  })).sort((a, b) => a.fields.created.localeCompare(b.fields.created));
  const log: string[] = [];
  let active = 0;
  let peak = 0;
  const at = (x: { fields: { created: string } }) => x.fields.created.slice(0, 16).replace("T", " ");
  const filter = (jql: string) => {
    const from = jql.match(/created >= "([^"]+)"/)?.[1];
    const to = jql.match(/created < "([^"]+)"/)?.[1];
    return all.filter((x) => (!from || at(x) >= from) && (!to || at(x) < to));
  };
  const jira: ProjectSearcher = {
    async searchIssues(jql, fields, limit, o) {
      log.push(jql);
      if (opts.rateLimited) throw Object.assign(new Error("Jira API error 429"), { status: 429, retryAfter: "2439" });
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 3));
      active--;

      const idList = jql.match(/id in \(([^)]*)\)/)?.[1];
      if (idList !== undefined) {
        if (opts.idQueryFails) throw Object.assign(new Error("Jira API error 400"), { status: 400, body: "bad jql" });
        const wanted = new Set(idList.split(",").map((x) => x.trim()));
        // Deliberately shuffled: `id in` makes no promise about order.
        return all.filter((x) => wanted.has(x.id) && !opts.hiddenFromIdQuery?.has(x.key)).reverse();
      }

      const idsOnly = fields.length === 1 && fields[0] === "id";
      if (opts.firstPageFails && !idsOnly && limit === FIRST_PAGE && !jql.includes("created >=")) {
        throw Object.assign(new Error("Jira API error 400"), { status: 400, body: "bad page" });
      }

      let out = filter(jql);
      if (jql.includes("ORDER BY created DESC")) out = [...out].reverse();
      if (opts.hiddenFromSlices && jql.includes("created >=")) out = out.slice(0, Math.max(0, out.length - opts.hiddenFromSlices));

      // Paging as Jira does it: pages of what the server allows (ids-only gets more), each reported.
      const server = idsOnly ? (opts.idPage ?? 5000) : 100;
      const page = Math.min(o?.pageSize ?? 100, server, limit ?? Infinity);
      const got: any[] = [];
      for (let i = 0; i < out.length; i += page) {
        // Asking for the id alone gets the id alone — no key — as Jira answers it.
        const slice: any[] = out.slice(i, i + page).map((x) => (idsOnly ? { id: x.id } : x));
        got.push(...slice);
        if (o?.onPage?.(slice.length, i + page < out.length) === false) break;
        if (limit !== undefined && got.length >= limit) break;
      }
      return limit === undefined ? got : got.slice(0, limit);
    },
    async countIssues(jql) {
      log.push("COUNT " + jql);
      if (opts.rateLimited) throw Object.assign(new Error("Jira API error 429"), { status: 429, retryAfter: "2439" });
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

describe("chunks", () => {
  it("cuts a list into consecutive groups, the last one short", () => {
    assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunks([], 3), []);
  });
});

describe("waysFor", () => {
  it("cuts a slice so each piece should land under the limit, never fewer than two nor more than the cap", () => {
    assert.equal(waysFor(4044, 200), 29);
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

  it("passes a 429 on untouched and unretried, so the caller can tell it was a rate limit", async () => {
    let calls = 0;
    const original = status(429, "slow down");
    await assert.rejects(
      named("count", async () => {
        calls++;
        throw original;
      }),
      (err) => err === original
    );
    assert.equal(calls, 1);
  });

  it("does not retry a 4xx (a query Jira will not take will be refused again)", async () => {
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

describe("searchProjectIssues — a small project is one request, with no count", () => {
  for (const n of [15, 100]) {
    it(`${n} issues: the first page is everything`, async () => {
      const { jira, all, log } = fakeJira(n);
      const res = await searchProjectIssues(jira, "P", ["summary"]);
      assert.equal(res.mode, "single");
      assert.equal(res.requests, 1);
      assert.deepEqual(res.issues.map((i) => i.key), all.map((i) => i.key));
      assert.match(res.detail ?? "", new RegExp(`^by id: ${n} ids in \\d+ms, one page by \\d+ms$`));
      assert.ok(!log.some((q) => q.startsWith("COUNT")), "a small project needs no count");
      assert.ok(!log.some((q) => q.includes(" id in (")), "nor a second round of reads");
    });
  }

  it("an empty project is read without trouble", async () => {
    const { jira } = fakeJira(0);
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "single");
    assert.equal(res.issues.length, 0);
  });
});

describe("searchProjectIssues — by id", () => {
  it("one page more than a page: the first page plus one group, no count", async () => {
    const { jira, all, log } = fakeJira(FIRST_PAGE + 50);
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.equal(res.requests, 2);
    assert.deepEqual(res.issues.map((i) => i.key), all.map((i) => i.key));
    assert.ok(!log.some((q) => q.startsWith("COUNT")));
  });

  it("lists the ids, then reads the rest in groups at once: every issue once, oldest first, bounded concurrency", async () => {
    const { jira, all, peak, log } = fakeJira(4044);
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.match(res.detail ?? "", /^by id: 4044 ids in \d+ms \(page 4044\), first page \+ 40 groups/);
    assert.equal(res.issues.length, 4044);
    assert.equal(new Set(res.issues.map((i) => i.key)).size, 4044, "an issue twice");
    assert.deepEqual(res.issues.map((i) => i.key), all.map((i) => i.key), "not oldest first");
    assert.equal(res.requests, 1 + Math.ceil((4044 - FIRST_PAGE) / ID_CHUNK));
    assert.ok(peak() <= READ_CONCURRENCY + 2, `peak ${peak()}`);
    assert.ok(!log.some((q) => q.startsWith("COUNT")), "no counting needed");
  });

  it("does not depend on what the keys look like (the ids are all it uses)", async () => {
    const { jira, all } = fakeJira(900);
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.equal(res.issues.length, 900);
    assert.ok(all.some((i) => i.key.startsWith("OLD-")));
  });

  it("when the first page fails, the ids it would have covered are asked for again — the read still succeeds", async () => {
    const { jira, all } = fakeJira(1000, { firstPageFails: true });
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.deepEqual(res.issues.map((i) => i.key), all.map((i) => i.key));
    assert.match(res.detail ?? "", /\(100 asked for again\)/);
  });
});

describe("searchProjectIssues — by creation time (when the id way cannot be used)", () => {
  const clamped = { idPage: 100 };

  it("falls back to creation-time slices, saying why, and still returns everything oldest first", async () => {
    const { jira, all, peak } = fakeJira(4000, clamped);
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.match(res.detail ?? "", /^by time: \d+ slices, \d+ counts planned in \d+ms, all read by \d+ms \[after: readByIds: id list pages at 100/);
    assert.equal(res.issues.length, 4000);
    assert.equal(new Set(res.issues.map((i) => i.key)).size, 4000, "an issue twice");
    assert.deepEqual(res.issues.map((i) => i.key), all.map((i) => i.key), "not oldest first");
    assert.ok(res.requests >= 4000 / SLICE_SIZE, `only ${res.requests} slices`);
    assert.ok(peak() <= COUNT_CONCURRENCY + READ_CONCURRENCY + 3, `peak ${peak()}`);
  });

  it("cuts a single busy day into minutes: a day holding a thousand issues is not one long chain of pages", async () => {
    const { jira } = fakeJira(1000, { ...clamped, dayOf: () => 5 });
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.equal(res.issues.length, 1000);
    assert.ok(res.requests >= 1000 / SLICE_SIZE, `only ${res.requests} slices for one day`);
  });

  it("everything created in the same minute cannot be cut further: that slice is read whole", async () => {
    const real = fakeJira(600, { ...clamped, dayOf: () => 5 });
    const same = real.all.map((x) => ({ ...x, fields: { created: "2026-01-06T09:00:00.000+0700" } }));
    real.all.splice(0, real.all.length, ...same);
    const res = await searchProjectIssues(real.jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.equal(res.issues.length, 600);
  });

  it("copes with a burst: most issues on a few days, a few spread out", async () => {
    const { jira } = fakeJira(2000, { ...clamped, dayOf: (i) => (i < 1800 ? 40 + (i % 3) : i % 120) });
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.equal(res.issues.length, 2000);
  });

  it("is used when Jira does not find some issues by id (named in the id list, missing from `id in`)", async () => {
    // Late in the creation order, so the first page (the oldest 100) does not cover them.
    const hidden = new Set(["P-500", "P-501", "OLD-497", "OLD-504"]);
    const { jira } = fakeJira(1000, { hiddenFromIdQuery: hidden });
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.equal(res.issues.length, 1000);
    assert.match(res.detail ?? "", /^by time:.*\[after: readByIds: id list named 1000, 4 not found by id/);
  });

  it("is used when the `id in` query is refused", async () => {
    const { jira } = fakeJira(1000, { idQueryFails: true });
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.equal(res.issues.length, 1000);
    assert.match(res.detail ?? "", /readByIds failed: (ids|missing) \d+: Jira API error 400/);
  });
});

describe("searchProjectIssues — the ordinary read, as the last resort", () => {
  it("is used, with every reason, when both fast ways come up short of Jira's count", async () => {
    const { jira } = fakeJira(1000, { hiddenFromSlices: 40, idPage: 100 });
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "sequential");
    assert.equal(res.issues.length, 1000);
    assert.match(res.reason ?? "", /readByIds: id list pages at 100/);
    assert.match(res.reason ?? "", /readByTime found \d+ of 1000 counted/);
  });

  it("is used when the id way cannot be and there is no count to size slices with", async () => {
    const { jira } = fakeJira(1000, { count: null, idPage: 100 });
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "sequential");
    assert.match(res.reason ?? "", /no count/);
    assert.match(res.reason ?? "", /id list pages at 100/);
  });

  it("is used for a project too small to be worth slicing by time, when the id way cannot be used", async () => {
    const { jira } = fakeJira(250, { idPage: 100 });
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "sequential");
    assert.equal(res.issues.length, 250);
    assert.match(res.reason ?? "", /^small project \(250 issues\)/);
  });
});

describe("searchProjectIssues — rate limited", () => {
  it("stops at once with Jira's own refusal: no slicing, no second way, no ordinary read on top", async () => {
    const { jira, log } = fakeJira(4044, { rateLimited: true });
    await assert.rejects(searchProjectIssues(jira, "P", ["summary"]), (err: any) => err.status === 429 && err.retryAfter === "2439");
    // The two requests started together (first page, id list); nothing after the refusal.
    assert.ok(log.length <= 3, `${log.length} requests after being refused: ${log.join(" | ")}`);
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
