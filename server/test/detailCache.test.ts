import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  cachedDescription,
  cachedDetail,
  cachedList,
  DELTA_FRESH_MS,
  DETAIL_MAX_AGE_MS,
  DETAIL_VISIBILITY_MS,
  forgetDetail,
  LIST_FRESH_MS,
  LIST_STALE_OK_MS,
  resolveIssue,
  type DetailKind,
  type DetailRow,
  type DetailStore,
  type IssueCopy,
  type ListKind,
} from "../src/detailCache.js";
import { TaskActivity, type TaskComment } from "../src/taskActivity.js";
import type { Visibility } from "../src/issueCache.js";

const MIN = 60_000;
// Real time: TaskActivity reads the clock itself, so the rows must be young by the real one.
const NOW = Date.now();
const WHO = { cloudId: "c", projectKey: "P", accountId: "me", key: "P-1" };

/** The store's contract in memory. Counts what was asked so a test can say "Jira was not asked". */
function memoryStore() {
  const lists = new Map<string, { items: unknown; fetchedAtMs: number }>();
  const details = new Map<string, DetailRow>();
  const copies = new Map<string, IssueCopy>();
  let visibility: Visibility | null = { ids: ["1"], checkedAtMs: NOW, reusable: true };
  let sync = { lastDeltaMs: NOW as number | null, changedMs: null as number | null };
  const written: unknown[] = [];
  copies.set("P-1", { issueId: "1", description: { type: "doc" }, secured: false, staleAtMs: null, updatedMs: 1000 });
  const store: DetailStore = {
    async getList(c, p, k) {
      return lists.get(`${c}|${p}|${k}`) ?? null;
    },
    async putList(c, p, k, items) {
      lists.set(`${c}|${p}|${k}`, { items, fetchedAtMs: NOW });
    },
    async getIssueCopy(_c, _p, key) {
      return copies.get(key) ?? null;
    },
    async getVisibility() {
      return visibility;
    },
    async getSync() {
      return sync;
    },
    async writeBackDescription(_c, id, d) {
      written.push([id, d]);
      for (const copy of copies.values()) if (copy.issueId === id && copy.staleAtMs === null) copy.description = d;
    },
    async getDetail(_c, id, kind) {
      return details.get(`${id}|${kind}`) ?? null;
    },
    async putDetail(_c, id, kind, data, restricted, issueUpdatedMs) {
      details.set(`${id}|${kind}`, { data, restricted, issueUpdatedMs, fetchedAtMs: NOW });
    },
    async dropDetail(_c, key, kinds: DetailKind[]) {
      const id = copies.get(key)?.issueId;
      for (const k of kinds) details.delete(`${id}|${k}`);
    },
  };
  return {
    store,
    lists,
    details,
    copies,
    written,
    setVisibility: (v: Visibility | null) => (visibility = v),
    setSync: (s: typeof sync) => (sync = s),
  };
}

const rateLimited = () => Object.assign(new Error("429"), { status: 429 });

describe("cachedList", () => {
  it("reads Jira once, then serves the copy to everyone while it is young", async () => {
    const m = memoryStore();
    let calls = 0;
    const read = async () => (++calls, ["Low", "High"]);
    assert.deepEqual(await cachedList(m.store, WHO, "priorities", read, NOW), ["Low", "High"]);
    assert.deepEqual(await cachedList(m.store, WHO, "priorities", read, NOW + LIST_FRESH_MS - 1), ["Low", "High"]);
    assert.equal(calls, 1);
  });

  it("reads again once it is ten minutes old", async () => {
    const m = memoryStore();
    let calls = 0;
    const read = async () => ++calls;
    await cachedList(m.store, WHO, "labels", read, NOW);
    // the memory store stamps writes with NOW, so ask "later" by ageing the entry
    m.lists.set("c|P|labels", { items: 1, fetchedAtMs: NOW - LIST_FRESH_MS - 1 });
    assert.equal(await cachedList(m.store, WHO, "labels", read, NOW), 2);
  });

  it("callers that ask at once share one read", async () => {
    const m = memoryStore();
    let calls = 0;
    const read = async () => {
      await new Promise((r) => setTimeout(r, 5));
      return ++calls;
    };
    const [a, b] = await Promise.all([cachedList(m.store, WHO, "versions", read, NOW), cachedList(m.store, WHO, "versions", read, NOW)]);
    assert.equal(calls, 1);
    assert.equal(a, b);
  });

  it("a refusal for rate serves an older copy, up to a day; any other failure is the caller's", async () => {
    const m = memoryStore();
    m.lists.set("c|P|components", { items: ["UI"], fetchedAtMs: NOW - 2 * 60 * MIN });
    assert.deepEqual(await cachedList(m.store, WHO, "components", async () => Promise.reject(rateLimited()), NOW), ["UI"]);
    await assert.rejects(cachedList(m.store, WHO, "components", async () => Promise.reject(new Error("boom")), NOW), /boom/);
    m.lists.set("c|P|components", { items: ["UI"], fetchedAtMs: NOW - LIST_STALE_OK_MS - 1 });
    await assert.rejects(cachedList(m.store, WHO, "components", async () => Promise.reject(rateLimited()), NOW), /429/);
  });

  it("a store that fails never fails the page: Jira is read as if there were no copy", async () => {
    const m = memoryStore();
    const broken: DetailStore = {
      ...m.store,
      getList: async () => Promise.reject(new Error("db down")),
      putList: async () => Promise.reject(new Error("db down")),
    };
    assert.deepEqual(await cachedList(broken, WHO, "issue-types", async () => ["Task"], NOW), ["Task"]);
  });

  it("each project and each kind has its own copy", async () => {
    const m = memoryStore();
    await cachedList(m.store, WHO, "labels" as ListKind, async () => ["a"], NOW);
    assert.deepEqual(await cachedList(m.store, { cloudId: "c", projectKey: "Q" }, "labels", async () => ["b"], NOW), ["b"]);
    assert.deepEqual(await cachedList(m.store, WHO, "versions", async () => ["v"], NOW), ["v"]);
  });
});

describe("resolveIssue (the permission and freshness gate)", () => {
  let m: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    m = memoryStore();
  });

  it("serves when the copy is current and the caller's own id list names the issue", async () => {
    assert.equal((await resolveIssue(m.store, WHO, NOW)).serve, true);
  });

  it("not when the issue is not in the project's copy at all", async () => {
    assert.deepEqual(await resolveIssue(m.store, { ...WHO, key: "P-99" }, NOW), { copy: null, serve: false });
  });

  it("not when the caller's id list does not name the issue (permission decided by Jira, not by the copy)", async () => {
    m.setVisibility({ ids: ["2", "3"], checkedAtMs: NOW, reusable: true });
    assert.equal((await resolveIssue(m.store, WHO, NOW)).serve, false);
  });

  it("not when the caller has no id list, or it is older than ten minutes", async () => {
    m.setVisibility(null);
    assert.equal((await resolveIssue(m.store, WHO, NOW)).serve, false);
    m.setVisibility({ ids: ["1"], checkedAtMs: NOW - DETAIL_VISIBILITY_MS - 1, reusable: true });
    assert.equal((await resolveIssue(m.store, WHO, NOW)).serve, false);
  });

  it("not under an issue security level, and not while the app's own write is not yet re-read", async () => {
    m.copies.set("P-1", { issueId: "1", description: null, secured: true, staleAtMs: null, updatedMs: 1 });
    assert.equal((await resolveIssue(m.store, WHO, NOW)).serve, false);
    m.copies.set("P-1", { issueId: "1", description: null, secured: false, staleAtMs: NOW - 1, updatedMs: 1 });
    assert.equal((await resolveIssue(m.store, WHO, NOW)).serve, false);
  });

  it("not when 'what changed' has not run lately, or a webhook reported something after it", async () => {
    m.setSync({ lastDeltaMs: NOW - DELTA_FRESH_MS - 1, changedMs: null });
    assert.equal((await resolveIssue(m.store, WHO, NOW)).serve, false);
    m.setSync({ lastDeltaMs: null, changedMs: null });
    assert.equal((await resolveIssue(m.store, WHO, NOW)).serve, false);
    m.setSync({ lastDeltaMs: NOW - 1000, changedMs: NOW });
    assert.equal((await resolveIssue(m.store, WHO, NOW)).serve, false);
  });
});

describe("cachedDescription", () => {
  it("is served from the issue copy without asking Jira", async () => {
    const m = memoryStore();
    m.copies.set("P-1", { issueId: "1", description: { text: "from the copy" }, secured: false, staleAtMs: null, updatedMs: 1 });
    let asked = 0;
    const d = await cachedDescription(m.store, WHO, async () => (++asked, { text: "from Jira" }), NOW);
    assert.deepEqual(d, { text: "from the copy" });
    assert.equal(asked, 0);
  });

  it("null is an answer (an issue with no description)", async () => {
    const m = memoryStore();
    m.copies.set("P-1", { issueId: "1", description: null, secured: false, staleAtMs: null, updatedMs: 1 });
    assert.equal(await cachedDescription(m.store, WHO, async () => ({ x: 1 }), NOW), null);
  });

  it("when the gate says no, Jira is read and what it said is written back for the next reader", async () => {
    const m = memoryStore();
    m.setVisibility({ ids: [], checkedAtMs: NOW, reusable: true });
    const d = await cachedDescription(m.store, WHO, async () => ({ text: "fresh" }), NOW);
    assert.deepEqual(d, { text: "fresh" });
    assert.deepEqual(m.written, [["1", { text: "fresh" }]]);
  });

  it("a row the app wrote to and has not re-read is not written over", async () => {
    const m = memoryStore();
    m.copies.set("P-1", { issueId: "1", description: { text: "mine" }, secured: false, staleAtMs: NOW - 5, updatedMs: 1 });
    await cachedDescription(m.store, WHO, async () => ({ text: "older read" }), NOW);
    assert.deepEqual(m.written, []);
  });

  it("an issue the copy does not have is read from Jira and nothing is written", async () => {
    const m = memoryStore();
    assert.deepEqual(await cachedDescription(m.store, { ...WHO, key: "P-7" }, async () => ({ text: "x" }), NOW), { text: "x" });
    assert.deepEqual(m.written, []);
  });
});

const comment = (id: string, extra: Partial<TaskComment> = {}): TaskComment => ({
  id,
  authorAccountId: "u" + id,
  authorName: "A" + id,
  authorAvatarUrl: null,
  text: "t" + id,
  created: "2026-01-01",
  updated: "2026-01-01",
  mine: false,
  ...extra,
});

/** A fake Jira that answers comments the way Jira does: restricted ones carry `visibility`. */
function fakeJira(raw: () => any[]) {
  let reads = 0;
  return {
    reads: () => reads,
    jira: {
      async getComments() {
        reads++;
        return raw();
      },
      async addComment() {
        return { id: "9", body: null, created: "x", author: { accountId: "me", displayName: "Me" } };
      },
    } as any,
  };
}

const raw = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  author: { accountId: "u" + id, displayName: "A" + id },
  body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "t" + id }] }] },
  created: "2026-01-01",
  ...o,
});

describe("comments through TaskActivity", () => {
  it("the second reader is served from the copy; `mine` is about the reader, not the one who filled it", async () => {
    const m = memoryStore();
    const fj = fakeJira(() => [raw("me"), raw("2")]);
    const first = new TaskActivity(fj.jira, "me", { store: m.store, cloudId: "c", projectKey: "P" });
    const a = await first.listComments("P-1");
    assert.equal(fj.reads(), 1);
    assert.deepEqual(a.map((c) => c.mine), [false, false]); // author "ume" is nobody here
    // another account reads the same issue; their id list names it too
    const second = new TaskActivity(fj.jira, "u2", { store: m.store, cloudId: "c", projectKey: "P" });
    const b = await second.listComments("P-1");
    assert.equal(fj.reads(), 1, "Jira was asked again");
    assert.deepEqual(b.map((c) => c.mine), [false, true]);
  });

  it("is read from Jira again once the issue's `updated` is not the one it was read at", async () => {
    const m = memoryStore();
    const fj = fakeJira(() => [raw("1")]);
    const act = new TaskActivity(fj.jira, "me", { store: m.store, cloudId: "c", projectKey: "P" });
    await act.listComments("P-1");
    m.copies.set("P-1", { issueId: "1", description: null, secured: false, staleAtMs: null, updatedMs: 2000 });
    await act.listComments("P-1");
    assert.equal(fj.reads(), 2);
  });

  it("is read again after ten minutes even if nothing seems to have changed", async () => {
    const m = memoryStore();
    const fj = fakeJira(() => [raw("1")]);
    const act = new TaskActivity(fj.jira, "me", { store: m.store, cloudId: "c", projectKey: "P" });
    await act.listComments("P-1");
    const row = m.details.get("1|comments")!;
    m.details.set("1|comments", { ...row, fetchedAtMs: NOW - DETAIL_MAX_AGE_MS - 1 });
    await act.listComments("P-1");
    assert.equal(fj.reads(), 2);
  });

  it("a comment restricted to a group is never stored; the issue is flagged and always read from Jira", async () => {
    const m = memoryStore();
    const fj = fakeJira(() => [raw("1"), raw("2", { visibility: { type: "group", value: "admins" } })]);
    const act = new TaskActivity(fj.jira, "me", { store: m.store, cloudId: "c", projectKey: "P" });
    const seen = await act.listComments("P-1");
    assert.equal(seen.length, 2, "the person who may see it still sees it");
    const row = m.details.get("1|comments")!;
    assert.equal(row.restricted, true);
    assert.deepEqual(row.data, [], "nothing of the restricted issue is kept");
    assert.ok(!JSON.stringify(row.data).includes("t2"));
    await act.listComments("P-1");
    assert.equal(fj.reads(), 2, "a flagged issue is not served from the copy");
  });

  it("the flag follows what Jira shows: once the restricted comment is gone the issue is kept again", async () => {
    const m = memoryStore();
    let list = [raw("1"), raw("2", { visibility: { type: "role", value: "Devs" } })];
    const fj = fakeJira(() => list);
    const act = new TaskActivity(fj.jira, "me", { store: m.store, cloudId: "c", projectKey: "P" });
    await act.listComments("P-1");
    list = [raw("1")];
    await act.listComments("P-1"); // read from Jira because flagged; clears the flag
    assert.equal(m.details.get("1|comments")!.restricted, false);
    await act.listComments("P-1");
    assert.equal(fj.reads(), 2, "served from the copy again");
  });

  it("not served to someone whose own id list does not name the issue", async () => {
    const m = memoryStore();
    const fj = fakeJira(() => [raw("1")]);
    const act = new TaskActivity(fj.jira, "me", { store: m.store, cloudId: "c", projectKey: "P" });
    await act.listComments("P-1");
    m.setVisibility({ ids: ["77"], checkedAtMs: NOW, reusable: true });
    await act.listComments("P-1");
    assert.equal(fj.reads(), 2);
  });

  it("writing a comment forgets what was held, so the next read is Jira's", async () => {
    const m = memoryStore();
    const fj = fakeJira(() => [raw("1")]);
    const act = new TaskActivity(fj.jira, "me", { store: m.store, cloudId: "c", projectKey: "P" });
    await act.listComments("P-1");
    await act.addComment("P-1", "xin chào");
    assert.equal(m.details.has("1|comments"), false);
    await act.listComments("P-1");
    assert.equal(fj.reads(), 2);
  });

  it("without a cache every read goes to Jira", async () => {
    const fj = fakeJira(() => [raw("1")]);
    const act = new TaskActivity(fj.jira, "me");
    await act.listComments("P-1");
    await act.listComments("P-1");
    assert.equal(fj.reads(), 2);
  });
});

describe("attachments (cachedDetail)", () => {
  const shape = { split: (v: unknown) => ({ data: v, restricted: false }), join: (d: unknown) => d };

  it("kept whole and served to the next reader; forgotten after this app changes them", async () => {
    const m = memoryStore();
    let reads = 0;
    const read = async () => (++reads, { files: [{ id: "5" }], links: [] });
    await cachedDetail(m.store, WHO, "attachments", read, shape, NOW);
    assert.deepEqual(await cachedDetail(m.store, WHO, "attachments", read, shape, NOW), { files: [{ id: "5" }], links: [] });
    assert.equal(reads, 1);
    await forgetDetail(m.store, "c", "P-1", ["attachments"]);
    await cachedDetail(m.store, WHO, "attachments", read, shape, NOW);
    assert.equal(reads, 2);
  });

  it("an issue whose copy is stale is read from Jira and nothing is kept (its `updated` is not the one just read)", async () => {
    const m = memoryStore();
    m.copies.set("P-1", { issueId: "1", description: null, secured: false, staleAtMs: NOW - 1, updatedMs: 5 });
    await cachedDetail(m.store, WHO, "attachments", async () => ({ files: [], links: [] }), shape, NOW);
    assert.equal(m.details.size, 0);
  });

  it("a store that fails is not the reader's problem", async () => {
    const m = memoryStore();
    const broken: DetailStore = { ...m.store, getIssueCopy: async () => Promise.reject(new Error("db down")) };
    assert.deepEqual(await cachedDetail(broken, WHO, "attachments", async () => ({ files: [1] }), shape, NOW), { files: [1] });
  });
});
