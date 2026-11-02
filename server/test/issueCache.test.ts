import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BACKFILL_MAX,
  cacheFields,
  DELTA_INTERVAL_MS,
  jiraTimeMs,
  readCachedProject,
  shouldReplace,
  slimIssue,
  toCached,
  VISIBILITY_GRACE_MS,
  VISIBILITY_REUSE_MS,
  writeEffect,
  type CacheJira,
  type CachedIssue,
  type IssueCacheStore,
  type SyncState,
  type Visibility,
} from "../src/issueCache.js";

const FIELDS = cacheFields(["summary", "duedate"]);
const MIN = 60_000;

/** The store's contract in memory: same replace rule as the SQL (shouldReplace), same description split. */
function memoryStore() {
  const rows = new Map<string, CachedIssue & { project: string; description: unknown }>();
  const sync = new Map<string, SyncState>();
  const syncOf = (project: string) => sync.get(project) ?? { deltaFromMs: null, lastDeltaMs: null, extraFields: [], changedMs: null };
  const seen = new Map<string, Visibility>();
  let clock = 0;
  const store: IssueCacheStore = {
    async load(_c, project, withDescription) {
      const out = new Map<string, CachedIssue>();
      for (const [id, r] of rows) {
        if (r.project !== project) continue;
        const fields = { ...r.issue.fields };
        if (withDescription) fields.description = r.description ?? null;
        out.set(id, { ...r, issue: { ...r.issue, fields } });
      }
      return { rows: out, sync: syncOf(project) };
    },
    async loadVisibility(_c, project, account) {
      return seen.get(`${project}|${account}`) ?? null;
    },
    async saveVisibility(_c, project, account, ids) {
      seen.set(`${project}|${account}`, { ids, checkedAtMs: clock, reusable: true });
    },
    async upsert(_c, project, issues, sig, exactSinceMs) {
      for (const issue of issues) {
        const id = String(issue.id);
        const { description, ...fields } = issue.fields;
        const next = toCached({ ...issue, fields }, sig, clock);
        const held = rows.get(id);
        if (held && !shouldReplace(held, next, exactSinceMs)) continue;
        rows.set(id, { ...next, project: issue.key.split("-")[0] ?? project, description });
      }
    },
    async remove(_c, ids) {
      for (const id of ids) rows.delete(id);
    },
    async saveSync(_c, project, patch) {
      sync.set(project, { ...syncOf(project), ...patch });
    },
    async withFillLock(_c, _p, fn) {
      return fn();
    },
  };
  return {
    store,
    rows,
    seen,
    sync,
    setClock: (ms: number) => (clock = ms),
    /** What applyWriteToCache does for a plain field write. */
    markStale(key: string, fields: Record<string, unknown> = {}) {
      for (const r of rows.values()) {
        if (r.issue.key !== key) continue;
        r.issue = { ...r.issue, fields: { ...r.issue.fields, ...fields } };
        r.staleAtMs = clock;
      }
    },
  };
}

interface FakeIssue {
  id: string;
  key: string;
  fields: Record<string, any>;
}

/**
 * Jira for project P. `index` is what search answers from (it can lag); `truth` is what bulkfetch
 * and GET /issue answer from. `hiddenFrom` names issues a given user's token does not see.
 */
function fakeJira(n: number) {
  let now = Date.parse("2026-11-02T08:00:00Z");
  const stamp = (ms = now) => new Date(ms).toISOString().replace("Z", "+0000");
  // Existing issues were last touched yesterday: a "what changed" window of minutes finds none of them.
  const yesterday = now - 24 * 60 * MIN;
  const truth = new Map<string, FakeIssue>();
  for (let i = 0; i < n; i++) {
    const id = String(10000 + i);
    truth.set(id, { id, key: `P-${i + 1}`, fields: { summary: `task ${i + 1}`, duedate: "2026-11-10", description: { text: `d${i}` }, updated: stamp(yesterday), security: null } });
  }
  const index = new Map<string, FakeIssue>([...truth].map(([id, x]) => [id, structuredClone(x)]));
  const hiddenFrom = new Map<string, Set<string>>();
  const calls: string[] = [];
  let user = "me";
  let rateLimited = false;
  let failAfter = Infinity;

  const refuse = () => {
    if (rateLimited || calls.length > failAfter) throw Object.assign(new Error("Jira API error 429"), { status: 429, retryAfter: "2439" });
  };
  const visible = (x: FakeIssue) => !hiddenFrom.get(user)?.has(x.id);
  const pick = (x: FakeIssue, fields: string[]) => ({
    id: x.id,
    ...(fields.length === 1 && fields[0] === "id" ? {} : { key: x.key, fields: Object.fromEntries(fields.map((f) => [f, x.fields[f] ?? null])) }),
  });

  const jira: CacheJira = {
    async searchIssues(jql, fields, limit, opts) {
      calls.push(jql);
      refuse();
      let hits = [...index.values()].filter(visible);
      const idIn = jql.match(/id in \(([^)]*)\)/)?.[1];
      if (idIn) {
        const wanted = new Set(idIn.split(","));
        hits = hits.filter((x) => wanted.has(x.id));
      }
      const minutes = jql.match(/updated >= "-(\d+)m"/)?.[1];
      if (minutes) hits = hits.filter((x) => jiraTimeMs(x.fields.updated)! >= now - Number(minutes) * MIN);
      const out = hits.map((x) => pick(x, fields));
      const page = limit ?? out.length;
      opts?.onPage?.(Math.min(page, out.length), out.length > page);
      return out.slice(0, page);
    },
    async bulkFetchIssues(ids, fields) {
      calls.push(`bulkfetch ${ids.join(",")}`);
      refuse();
      return ids.map((id) => truth.get(id) ?? [...truth.values()].find((x) => x.key === id)).filter((x): x is FakeIssue => !!x && visible(x)).map((x) => pick(x, fields));
    },
    async getIssue(id, fields) {
      calls.push(`get ${id}`);
      refuse();
      const x = truth.get(id);
      if (!x) throw Object.assign(new Error("404"), { status: 404 });
      return pick(x, fields ?? []);
    },
  };

  return {
    jira,
    calls,
    get now() {
      return now;
    },
    advance(ms: number) {
      now += ms;
    },
    as(account: string) {
      user = account;
    },
    hide(account: string, ...ids: string[]) {
      hiddenFrom.set(account, new Set(ids));
    },
    rateLimit(on: boolean) {
      rateLimited = on;
    },
    failAfterCalls(k: number) {
      failAfter = k;
    },
    /** A change made in Jira; `indexed: false` = the search index has not caught up yet. */
    edit(id: string, fields: Record<string, unknown>, indexed = true) {
      const x = truth.get(id)!;
      Object.assign(x.fields, fields, { updated: stamp() });
      if (indexed) index.set(id, structuredClone(x));
    },
    create(id: string, key: string) {
      const x = { id, key, fields: { summary: key, duedate: null, description: null, updated: stamp(), security: null } };
      truth.set(id, x);
      index.set(id, structuredClone(x));
    },
    delete(id: string) {
      truth.delete(id);
      index.delete(id);
    },
  };
}

function setup(n: number) {
  const j = fakeJira(n);
  const m = memoryStore();
  const read = (
    opts: {
      account?: string;
      description?: boolean;
      extraFields?: string[];
      quota?: { deferBackground: boolean; limitedUntilMs: number | null };
      deltaIntervalMs?: number;
    } = {}
  ) => {
    m.setClock(j.now);
    j.as(opts.account ?? "me");
    j.calls.length = 0;
    return readCachedProject(
      j.jira,
      m.store,
      {
        cloudId: "c",
        projectKey: "P",
        accountId: opts.account ?? "me",
        fields: FIELDS,
        description: opts.description ?? false,
        extraFields: opts.extraFields,
        quota: opts.quota,
        deltaIntervalMs: opts.deltaIntervalMs,
      },
      () => j.now
    );
  };
  return { j, m, read };
}

describe("issue cache: reading", () => {
  it("fills a new project once, then a load is the id list and one 'what changed'", async () => {
    const { j, m, read } = setup(450);
    const first = await read();
    assert.equal(first.issues.length, 450);
    assert.equal(m.rows.size, 450);
    assert.deepEqual(first.issues.map((i) => i.key).slice(0, 3), ["P-1", "P-2", "P-3"]);
    // ids + 5 groups of 100
    assert.equal(first.requests, 6);

    j.advance(2 * MIN);
    const second = await read();
    assert.equal(second.issues.length, 450);
    assert.equal(second.requests, 2, j.calls.join("\n"));
    assert.ok(j.calls.some((c) => /updated >= "-\d+m"/.test(c)));
  });

  it("leaves descriptions out unless asked, and gives them when asked", async () => {
    const { j, read } = setup(5);
    const plain = await read();
    assert.equal(plain.issues[0].fields.description, undefined);
    j.advance(2 * MIN);
    const full = await read({ description: true });
    assert.deepEqual(full.issues[0].fields.description, { text: "d0" });
  });

  it("re-uses a fresh id list and does not ask 'what changed' twice within the interval", async () => {
    const { j, read } = setup(10);
    await read();
    j.advance(DELTA_INTERVAL_MS + 1000);
    await read();
    j.advance(5000);
    const third = await read();
    assert.equal(third.requests, 0, j.calls.join("\n"));
    assert.ok(VISIBILITY_REUSE_MS > 5000 + DELTA_INTERVAL_MS / 2);
  });

  it("picks up a change made directly in Jira", async () => {
    const { j, read } = setup(10);
    await read();
    j.advance(2 * MIN);
    j.edit("10003", { duedate: "2026-12-01" });
    const after = await read();
    assert.equal(after.issues.find((i) => i.id === "10003").fields.duedate, "2026-12-01");
  });

  it("re-reads what this app wrote by id, never from a search index that has not caught up", async () => {
    const { j, m, read } = setup(10);
    await read();
    j.advance(2 * MIN);
    // The app moved P-4's due date: Jira has it, the search index does not yet.
    j.edit("10003", { duedate: "2026-12-24" }, false);
    m.markStale("P-4", { duedate: "2026-12-24" });
    const after = await read();
    assert.equal(after.issues.find((i) => i.id === "10003").fields.duedate, "2026-12-24");
    assert.ok(j.calls.some((c) => c.startsWith("bulkfetch 10003")), j.calls.join("\n"));
    assert.equal([...m.rows.values()].find((r) => r.issue.key === "P-4")!.staleAtMs, null);
  });

  it("serves only what the user's own token can see", async () => {
    const { j, read } = setup(10);
    await read({ account: "admin" });
    j.hide("guest", "10001", "10002");
    j.advance(2 * MIN);
    const guest = await read({ account: "guest" });
    assert.equal(guest.issues.length, 8);
    assert.ok(!guest.issues.some((i) => i.id === "10001" || i.id === "10002"));
  });

  it("removes an issue deleted in Jira, but not on the word of someone who sees only part of the project", async () => {
    const { j, m, read } = setup(40);
    await read({ account: "admin" });
    j.hide("reporter", ...Array.from({ length: 30 }, (_, i) => String(10000 + i)));
    j.advance(2 * MIN);
    await read({ account: "reporter" });
    assert.equal(m.rows.size, 40, "a partial view removes nothing");

    j.delete("10005");
    j.advance(2 * MIN);
    const after = await read({ account: "admin" });
    assert.equal(after.issues.length, 39);
    assert.ok(!m.rows.has("10005"));
  });

  it("shows a new issue as soon as the creator's id list is listed again", async () => {
    const { j, m, read } = setup(5);
    await read();
    j.advance(10_000);
    j.create("20000", "P-99");
    // applyWriteToCache's effect for POST /issue: the creator's list is not reused.
    for (const v of m.seen.values()) v.reusable = false;
    const after = await read();
    assert.ok(after.issues.some((i) => i.key === "P-99"));
  });
});

describe("issue cache: rate limits", () => {
  it("serves the copy with the last id list while Jira refuses, and says so", async () => {
    const { j, read } = setup(10);
    await read();
    j.advance(10 * MIN);
    j.rateLimit(true);
    const limited = await read();
    assert.equal(limited.issues.length, 10);
    assert.deepEqual(limited.rateLimited, { retryAfter: "2439" });
  });

  it("refuses once the last id list is too old to decide permissions with", async () => {
    const { j, read } = setup(10);
    await read();
    j.advance(VISIBILITY_GRACE_MS + MIN);
    j.rateLimit(true);
    await assert.rejects(read(), (err: any) => err.status === 429);
  });

  it("keeps what a first read got before a 429 and reads only the rest next time", async () => {
    const { j, m, read } = setup(1000);
    j.failAfterCalls(4); // ids + a few groups, then the quota runs out
    await assert.rejects(read(), (err: any) => err.status === 429);
    const kept = m.rows.size;
    assert.ok(kept > 0 && kept < 1000, `kept ${kept}`);

    j.failAfterCalls(Infinity);
    j.advance(2 * MIN);
    const again = await read();
    assert.equal(again.issues.length, 1000);
    const groups = j.calls.filter((c) => c.includes("id in (")).length;
    assert.ok(groups <= Math.ceil((1000 - kept) / 100) + 1, `${groups} groups for ${1000 - kept} missing`);
  });
});

describe("issue cache: refreshing", () => {
  it("re-reads rows read with another field list a few hundred at a time", async () => {
    const { j, m, read } = setup(BACKFILL_MAX + 700);
    await read();
    for (const r of m.rows.values()) r.sig = "old";
    j.advance(2 * MIN);
    await read();
    const old = [...m.rows.values()].filter((r) => r.sig === "old").length;
    assert.equal(old, 700);
  });
});

describe("issue cache: quota, the board's fields, webhooks", () => {
  it("asks Jira nothing while the quota is known to be spent, and serves the copy", async () => {
    const { j, read } = setup(10);
    await read();
    j.advance(5 * MIN);
    const spent = await read({ quota: { deferBackground: true, limitedUntilMs: j.now + 30 * MIN } });
    assert.equal(spent.requests, 0, j.calls.join("\n"));
    assert.equal(spent.issues.length, 10);
    assert.ok(spent.rateLimited);
  });

  it("does no background refreshing while the quota is nearly spent", async () => {
    const { j, m, read } = setup(300);
    await read();
    for (const r of m.rows.values()) r.sig = "old";
    j.advance(2 * MIN);
    const near = await read({ quota: { deferBackground: true, limitedUntilMs: null } });
    assert.ok(!j.calls.some((c) => c.includes("id in (")), j.calls.join("\n"));
    assert.equal(near.outdated, 300);
  });

  it("keeps a field the board asked for, for every later reader, and says how many rows still lack it", async () => {
    const { j, m, read } = setup(BACKFILL_MAX + 200);
    await read();
    j.advance(2 * MIN);
    const board = await read({ extraFields: ["customfield_10019"] });
    assert.deepEqual(m.sync.get("P")!.extraFields, ["customfield_10019"]);
    assert.equal(board.outdated, 200);
    j.advance(2 * MIN);
    // The task list never names the field, and still reads (and refreshes) with it.
    const tasks = await read();
    assert.equal(tasks.outdated, 0);
  });

  it("asks what changed at once when a webhook said so, and less often while one is live", async () => {
    const { j, m, read } = setup(10);
    await read();
    j.advance(2 * MIN);
    await read();
    j.advance(60_000);
    const quiet = await read({ deltaIntervalMs: 5 * MIN });
    assert.ok(!quiet.detail.includes("delta 1") && quiet.detail.includes("delta skipped"), quiet.detail);
    m.sync.get("P")!.changedMs = j.now;
    j.advance(1000);
    const told = await read({ deltaIntervalMs: 5 * MIN });
    assert.ok(/delta \d+m/.test(told.detail), told.detail);
  });
});

describe("slimIssue", () => {
  it("keeps what the app reads and never a person's email or timezone", () => {
    const slim = slimIssue({
      id: "1",
      key: "P-1",
      self: "https://x/rest/api/3/issue/1",
      fields: {
        assignee: { self: "u", accountId: "a1", displayName: "Minh", emailAddress: "minh@x.com", timeZone: "Asia/Ho_Chi_Minh", avatarUrls: { "16x16": "s", "24x24": "m", "48x48": "l" }, active: true },
        parent: { id: "9", key: "P-9", self: "p", fields: { summary: "Epic", status: { name: "To Do" }, issuetype: { self: "t", name: "Epic", subtask: false, hierarchyLevel: 1 } } },
        status: { self: "s", iconUrl: "i", name: "In Progress", statusCategory: { self: "c", key: "indeterminate", name: "In Progress" } },
        issuetype: { self: "t", iconUrl: "i", name: "Sub-task", subtask: true, avatarId: 3 },
        customfield_10020: [{ id: 7, name: "S7", state: "active", boardId: 3 }],
        description: { type: "doc", content: [{ type: "text", text: "self" }] },
        duedate: "2026-11-10",
      },
    });
    assert.ok(!JSON.stringify(slim).includes("minh@x.com"));
    assert.ok(!JSON.stringify(slim).includes("Asia/Ho_Chi_Minh"));
    assert.deepEqual(slim.fields.assignee, { accountId: "a1", displayName: "Minh", avatarUrls: { "24x24": "m" }, active: true });
    // The board needs to know a parent is an Epic and its title; not its status, priority or links.
    assert.deepEqual(slim.fields.parent, { id: "9", key: "P-9", fields: { summary: "Epic", issuetype: { name: "Epic", subtask: false, hierarchyLevel: 1 } } });
    assert.deepEqual(slim.fields.status, { name: "In Progress", statusCategory: { key: "indeterminate", name: "In Progress" } });
    assert.deepEqual(slim.fields.issuetype, { name: "Sub-task", subtask: true });
    assert.deepEqual(slim.fields.customfield_10020, [{ id: 7, name: "S7", state: "active", boardId: 3 }]);
    assert.deepEqual(slim.fields.description, { type: "doc", content: [{ type: "text", text: "self" }] });
    assert.equal(slim.fields.duedate, "2026-11-10");
  });
});

describe("shouldReplace", () => {
  const row = (updated: string, staleAtMs: number | null = null) => ({ ...toCached({ id: "1", fields: { updated } }, "s", 0), staleAtMs });
  it("a search answer never replaces a newer copy or one this app just wrote", () => {
    assert.equal(shouldReplace(row("2026-11-02T10:00:00.000+0700"), row("2026-11-02T09:00:00.000+0700")), false);
    assert.equal(shouldReplace(row("2026-11-02T09:00:00.000+0700"), row("2026-11-02T10:00:00.000+0700")), true);
    assert.equal(shouldReplace(row("2026-11-02T09:00:00.000+0700", 5), row("2026-11-02T10:00:00.000+0700")), false);
  });
  it("an exact read replaces a stale row unless it was written again meanwhile", () => {
    assert.equal(shouldReplace(row("x", 5), row("y"), 6), true);
    assert.equal(shouldReplace(row("x", 9), row("y"), 6), false);
  });
  it("reads Jira's offset without a colon", () => {
    assert.equal(jiraTimeMs("2026-11-02T10:00:00.000+0700"), Date.parse("2026-11-02T03:00:00Z"));
  });
});

describe("writeEffect", () => {
  it("a field write patches and marks the issue", () => {
    const e = writeEffect("PUT", "/rest/api/3/issue/P-4", JSON.stringify({ fields: { duedate: "2026-12-24" } }));
    assert.deepEqual(e.patch, { key: "P-4", fields: { duedate: "2026-12-24" } });
    assert.deepEqual(e.stale, ["P-4"]);
  });
  it("transitions, assignments, worklogs and estimates mark the issue", () => {
    for (const path of ["/rest/api/3/issue/P-4/transitions", "/rest/api/3/issue/P-4/assignee", "/rest/api/3/issue/P-4/worklog?adjustEstimate=leave", "/rest/agile/1.0/issue/P-4/estimation?boardId=3"]) {
      assert.deepEqual(writeEffect("POST", path).stale, ["P-4"], path);
    }
  });
  it("sprint moves mark every issue moved; a sprint's own change marks its sprint", () => {
    assert.deepEqual(writeEffect("POST", "/rest/agile/1.0/sprint/7/issue", JSON.stringify({ issues: ["P-1", "P-2"] })).stale, ["P-1", "P-2"]);
    assert.deepEqual(writeEffect("POST", "/rest/agile/1.0/backlog/issue", JSON.stringify({ issues: ["P-3"] })).stale, ["P-3"]);
    assert.deepEqual(writeEffect("POST", "/rest/agile/1.0/sprint/7", JSON.stringify({ state: "closed" })).sprints, [7]);
  });
  it("delete removes, create relists, reads do nothing", () => {
    assert.deepEqual(writeEffect("DELETE", "/rest/api/3/issue/P-4?deleteSubtasks=true").deleted, ["P-4"]);
    assert.equal(writeEffect("POST", "/rest/api/3/issue").created, true);
    assert.equal(writeEffect("POST", "/rest/api/3/issue/bulk").created, true);
    for (const path of ["/rest/api/3/search/jql", "/rest/api/3/search/approximate-count", "/rest/api/3/issue/bulkfetch"]) {
      const e = writeEffect("POST", path, "{}");
      assert.ok(!e.patch && !e.created && e.stale.length === 0, path);
    }
    assert.equal(writeEffect("GET", "/rest/api/3/issue/P-4").stale.length, 0);
  });
});
