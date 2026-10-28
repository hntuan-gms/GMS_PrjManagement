import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chunks,
  COUNT_CONCURRENCY,
  createdDay,
  ID_CHUNK,
  limiter,
  named,
  PARALLEL_MIN_ISSUES,
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
  /** Issues `id in (…)` does not find (kept by key name here for readability). */
  hiddenFromIdQuery?: Set<string>;
  /** Makes every `id in (…)` query fail. */
  idQueryFails?: boolean;
  /** Issues the time slices do not return. */
  hiddenFromSlices?: number;
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

      let out = filter(jql);
      if (jql.includes("ORDER BY created DESC")) out = [...out].reverse();
      if (opts.hiddenFromSlices && jql.includes("created >=")) out = out.slice(0, Math.max(0, out.length - opts.hiddenFromSlices));

      // Paging as Jira does it: pages of what the server allows (keys-only gets more), each reported.
      const server = fields.length === 1 && fields[0] === "id" ? (opts.idPage ?? 5000) : 100;
      const page = Math.min(o?.pageSize ?? 100, server, limit ?? Infinity);
      // Asking for the id alone gets the id alone — no key — as Jira answers it.
      const idsOnly = fields.length === 1 && fields[0] === "id";
      const got: any[] = [];
      for (let i = 0; i < out.length; i += page) {
        const slice: any[] = out.slice(i, i + page).map((x) => (idsOnly ? { id: x.id } : x));
        got.push(...slice);
        if (o?.onPage?.(slice.length) === false) break;
        if (limit !== undefined && got.length >= limit) break;
      }
      return limit === undefined ? got : got.slice(0, limit);
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

describe("searchProjectIssues — by id", () => {
  it("lists the ids, then reads them in groups at once: every issue once, oldest first, bounded concurrency", async () => {
    const { jira, all, peak, log } = fakeJira(4044);
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.match(res.detail ?? "", /^by id: 4044 ids in \d+ms \(page 4044\), 41 groups/);
    assert.equal(res.issues.length, 4044);
    assert.equal(new Set(res.issues.map((i) => i.key)).size, 4044, "an issue twice");
    assert.deepEqual(res.issues.map((i) => i.key), all.map((i) => i.key), "not oldest first");
    assert.equal(res.requests, Math.ceil(4044 / ID_CHUNK));
    assert.ok(peak() <= READ_CONCURRENCY + 1, `peak ${peak()}`);
    assert.ok(!log.some((q) => q.startsWith("COUNT") && q.includes("created")), "no time slicing needed");
  });

  it("does not depend on what the keys look like (foreign prefixes, gaps)", async () => {
    const { jira, all } = fakeJira(900);
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.equal(res.issues.length, 900);
    assert.ok(all.some((i) => i.key.startsWith("OLD-")));
  });
});

describe("searchProjectIssues — by creation time (when listing the ids would itself be a chain)", () => {
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
    assert.ok(peak() <= COUNT_CONCURRENCY + READ_CONCURRENCY + 2, `peak ${peak()}`);
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

  it("is used when Jira does not find some issues by id (they are in the id list but not in `id in`)", async () => {
    const hidden = new Set(["P-1", "P-2", "OLD-14", "OLD-21"]);
    const { jira } = fakeJira(1000, { hiddenFromIdQuery: hidden });
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.equal(res.issues.length, 1000);
    assert.match(res.detail ?? "", /^by time:.*\[after: readByIds found 99\d of 1000 counted/);
  });

  it("is used when the `id in` query is refused", async () => {
    const { jira } = fakeJira(1000, { idQueryFails: true });
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "parallel");
    assert.equal(res.issues.length, 1000);
    assert.match(res.detail ?? "", /readByIds failed: ids 0: Jira API error 400/);
  });
});

describe("searchProjectIssues — the ordinary read", () => {
  it("reads a small project in one ordinary query", async () => {
    const { jira, log } = fakeJira(PARALLEL_MIN_ISSUES - 1);
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "sequential");
    assert.equal(res.issues.length, PARALLEL_MIN_ISSUES - 1);
    assert.ok(log.some((q) => q.endsWith("ORDER BY created ASC")));
  });

  it("is the last resort, with every reason, when both fast ways come up short of Jira's count", async () => {
    const { jira } = fakeJira(1000, { hiddenFromSlices: 40, idQueryFails: true, idPage: 100 });
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "sequential");
    assert.equal(res.issues.length, 1000);
    assert.match(res.reason ?? "", /readByIds: id list pages at 100/);
    assert.match(res.reason ?? "", /readByTime found \d+ of 1000 counted/);
  });

  it("is used when the count is unavailable", async () => {
    const { jira } = fakeJira(1000, { count: null });
    const res = await searchProjectIssues(jira, "P", ["summary"]);
    assert.equal(res.mode, "sequential");
    assert.match(res.reason ?? "", /no count/);
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
