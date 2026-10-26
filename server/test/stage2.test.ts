import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeSpec, cleanName } from "../src/filterStore.js";
import { JiraApiError } from "../src/jiraClient.js";
import { scopeJql, TaskExtras, toLinkViews } from "../src/taskExtras.js";
import { isRealDate, MAX_IMPORT_ROWS, pickSprint, TaskService } from "../src/taskService.js";
import type { ImportRow, Task } from "../src/types.js";

describe("pickSprint (2.8)", () => {
  it("prefers the running sprint over a future or closed one", () => {
    const s = pickSprint([
      { id: 1, name: "Sprint 1", state: "closed" },
      { id: 3, name: "Sprint 3", state: "future" },
      { id: 2, name: "Sprint 2", state: "active" },
    ]);
    assert.deepEqual(s, { id: 2, name: "Sprint 2", state: "active" });
  });

  it("with only closed sprints, the most recent one; a carried-over issue sits in several", () => {
    assert.equal(pickSprint([{ id: 1, name: "A", state: "closed" }, { id: 4, name: "D", state: "closed" }])?.name, "D");
  });

  it("is null for no sprint, a site without the field, or junk", () => {
    assert.equal(pickSprint(null), null);
    assert.equal(pickSprint(undefined), null);
    assert.equal(pickSprint([]), null);
    assert.equal(pickSprint("Sprint 1"), null);
    assert.equal(pickSprint([{ name: "no id" }, null, 5]), null);
  });
});

describe("toLinkViews (2.2)", () => {
  const blocks = { id: "10", name: "Blocks", inward: "is blocked by", outward: "blocks" };
  const issue = (key: string, summary: string, cat = "new") => ({ key, fields: { summary, status: { name: "To Do", statusCategory: { key: cat } }, issuetype: { name: "Task" } } });

  it("reads the direction from which end Jira filled in", () => {
    const v = toLinkViews([
      { id: "1", type: blocks, outwardIssue: issue("A-2", "Dựng API") },
      { id: "2", type: blocks, inwardIssue: issue("A-3", "Thiết kế DB", "done") },
    ]);
    assert.deepEqual(v.map((l) => [l.id, l.direction, l.label, l.key, l.statusCategory]), [
      ["1", "outward", "blocks", "A-2", "new"],
      ["2", "inward", "is blocked by", "A-3", "done"],
    ]);
  });

  it("skips a malformed link instead of failing the whole list", () => {
    assert.deepEqual(toLinkViews([{ id: "1", type: blocks }, null as never, { id: "2", type: blocks, outwardIssue: issue("A-1", "x") }]).map((l) => l.id), ["2"]);
  });
});

describe("scopeJql (2.7)", () => {
  it("wraps what the user typed in the project scope", () => {
    assert.equal(scopeJql("ABC", 'status = "In Progress" OR assignee = currentUser()'), 'project = ABC AND (status = "In Progress" OR assignee = currentUser())');
  });

  it("drops a trailing ORDER BY, which cannot sit inside the parentheses", () => {
    assert.equal(scopeJql("ABC", "priority = High ORDER BY created DESC"), "project = ABC AND (priority = High)");
    assert.equal(scopeJql("ABC", "priority = High order by created desc, key asc"), "project = ABC AND (priority = High)");
  });

  it("leaves an 'order by' that is inside a quoted string alone", () => {
    assert.equal(scopeJql("ABC", 'summary ~ "order by name"'), 'project = ABC AND (summary ~ "order by name")');
  });

  it("an empty query is just the project", () => {
    assert.equal(scopeJql("ABC", "  ORDER BY created  "), "project = ABC");
  });
});

describe("TaskExtras", () => {
  const fake = (over: Record<string, unknown>) => new TaskExtras(over as never, { projectKey: "P", accountId: "me" });

  it("JQL results are cut to this project's keys (a widened query returns nothing foreign)", async () => {
    const extras = fake({ searchKeys: async () => ({ keys: ["P-1", "OTHER-9", "P-22"], truncated: false }) });
    assert.deepEqual((await extras.jqlKeys("status = Done")).keys, ["P-1", "P-22"]);
  });

  it("a JQL syntax error is a 400 in Jira's own words, not a 500", async () => {
    const extras = fake({
      searchKeys: async () => {
        throw new JiraApiError(400, JSON.stringify({ errorMessages: ["Error in the JQL Query: lỗi cú pháp"] }));
      },
    });
    await assert.rejects(extras.jqlKeys("status ="), (e: Error & { status?: number }) => e.status === 400 && /JQL không hợp lệ/.test(e.message));
  });

  it("refuses an empty or oversized JQL before calling Jira", async () => {
    const extras = fake({ searchKeys: async () => assert.fail("must not be called") });
    await assert.rejects(extras.jqlKeys("   "), /Chưa nhập JQL/);
    await assert.rejects(extras.jqlKeys("a".repeat(2001)), /quá dài/);
  });

  it("a link's direction decides which end of Jira's pair this issue is", async () => {
    const calls: Array<[string, string, string]> = [];
    const extras = fake({
      getIssueLinkTypes: async () => [{ id: "1", name: "Blocks", inward: "is blocked by", outward: "blocks" }],
      createIssueLink: async (t: string, i: string, o: string) => void calls.push([t, i, o]),
      getIssueLinks: async () => [],
    });
    await extras.addLink("P-1", { typeName: "Blocks", otherKey: "p-2", direction: "outward" });
    await extras.addLink("P-1", { typeName: "Blocks", otherKey: "P-3", direction: "inward" });
    // "P-1 blocks P-2": P-1 is the outward issue. "P-1 is blocked by P-3": P-1 is the inward issue.
    assert.deepEqual(calls, [["Blocks", "P-2", "P-1"], ["Blocks", "P-1", "P-3"]]);
  });

  it("refuses a link to itself, a malformed key, an unknown type", async () => {
    const extras = fake({ getIssueLinkTypes: async () => [{ id: "1", name: "Blocks", inward: "i", outward: "o" }], createIssueLink: async () => assert.fail("no") });
    await assert.rejects(extras.addLink("P-1", { typeName: "Blocks", otherKey: "P-1", direction: "outward" }), /chính nó/);
    await assert.rejects(extras.addLink("P-1", { typeName: "Blocks", otherKey: "nope", direction: "outward" }), /không hợp lệ/);
    await assert.rejects(extras.addLink("P-1", { typeName: "Cloners", otherKey: "P-2", direction: "outward" }), /Không có loại liên kết/);
  });

  it("only deletes a link that belongs to this issue", async () => {
    let deleted: string | null = null;
    const extras = fake({
      getIssueLinks: async () => [{ id: "7", type: { name: "Blocks", outward: "blocks" }, outwardIssue: { key: "P-2", fields: {} } }],
      deleteIssueLink: async (id: string) => void (deleted = id),
    });
    await assert.rejects(extras.removeLink("P-1", "99"), /không thuộc/);
    assert.equal(deleted, null);
    await extras.removeLink("P-1", "7");
    assert.equal(deleted, "7");
  });

  it("refuses an issue outside the project before asking Jira anything", async () => {
    const extras = fake({ getIssueLinks: async () => assert.fail("no") });
    await assert.rejects(extras.links("OTHER-1"), /dự án P/);
  });

  it("watching is always the signed-in user", async () => {
    const seen: string[] = [];
    const extras = fake({
      addWatcher: async (_k: string, who: string) => void seen.push(`+${who}`),
      removeWatcher: async (_k: string, who: string) => void seen.push(`-${who}`),
      getWatchers: async () => ({ isWatching: true, watchCount: 2, watchers: [{ accountId: "me", displayName: "Tôi" }] }),
    });
    const w = await extras.setWatching("P-1", true);
    await extras.setWatching("P-1", false);
    assert.deepEqual(seen, ["+me", "-me"]);
    assert.equal(w.count, 2);
    assert.equal(w.listed, true);
  });

  it("when Jira only gives the count (no permission to list), says the list is missing", async () => {
    const extras = fake({ getWatchers: async () => ({ isWatching: false, watchCount: 3 }) });
    const w = await extras.watchers("P-1");
    assert.equal(w.listed, false);
    assert.deepEqual(w.watchers, []);
  });
});

describe("sanitizeSpec / cleanName (2.6)", () => {
  const base = { text: "", people: [], statuses: [], types: [], epics: [], labels: [], components: [], versions: [], sprints: [], onlyOverdue: false, jql: "" };

  it("keeps what a filter holds and drops the rest", () => {
    const s = sanitizeSpec({ ...base, people: ["@me", "abc", "abc"], onlyOverdue: true, evil: "<script>" });
    assert.deepEqual(s.people, ["@me", "abc"]);
    assert.equal(s.onlyOverdue, true);
    assert.ok(!("evil" in s));
  });

  it("an empty filter is not worth saving", () => {
    assert.throws(() => sanitizeSpec(base), /Chưa có điều kiện/);
    assert.doesNotThrow(() => sanitizeSpec({ ...base, jql: "status = Done" }));
  });

  it("refuses the wrong shape instead of storing it", () => {
    assert.throws(() => sanitizeSpec({ ...base, people: "abc" }), /danh sách chuỗi/);
    assert.throws(() => sanitizeSpec({ ...base, labels: [1] }), /danh sách chuỗi/);
    assert.throws(() => sanitizeSpec(null), /không hợp lệ/);
    assert.throws(() => sanitizeSpec({ ...base, jql: "x".repeat(2001) }), /quá dài/);
  });

  it("names are trimmed, collapsed and capped", () => {
    assert.equal(cleanName("  Việc   quá   hạn "), "Việc quá hạn");
    assert.equal(cleanName("x".repeat(200)).length, 80);
    assert.throws(() => cleanName("   "), /đặt tên/);
    assert.throws(() => cleanName(undefined), /đặt tên/);
  });
});

describe("isRealDate", () => {
  it("accepts a real date and refuses an impossible or malformed one", () => {
    assert.equal(isRealDate("2026-10-22"), true);
    assert.equal(isRealDate("2026-02-30"), false);
    assert.equal(isRealDate("22/10/2026"), false);
    assert.equal(isRealDate("2026-1-5"), false);
  });
});

describe("importTasks (2.11)", () => {
  /** A service whose Jira side is a stub: createTask records the input and hands back a key. */
  function service(failOn: (summary: string) => boolean = () => false) {
    const created: Array<Record<string, unknown>> = [];
    const svc = new TaskService({} as never, { cloudId: "c", accountId: "me", siteUrl: "https://x", projectKey: "P", startDateFieldId: null });
    (svc as unknown as { listUsers: () => unknown }).listUsers = async () => [
      { accountId: "q1", displayName: "Võ Đình Quang", avatarUrl: null },
      { accountId: "q2", displayName: "Nguyễn Quang", avatarUrl: null },
      { accountId: "lan", displayName: "Trần Lan", avatarUrl: null },
    ];
    (svc as unknown as { listPriorities: () => unknown }).listPriorities = async () => ["Highest", "High", "Medium", "Low", "Lowest"];
    (svc as unknown as { createTask: (i: Record<string, unknown>) => unknown }).createTask = async (input: Record<string, unknown>) => {
      if (failOn(String(input.summary))) throw new Error("Jira từ chối");
      created.push(input);
      return { id: `P-${created.length}`, summary: input.summary } as unknown as Task;
    };
    return { svc, created };
  }
  const run = (svc: TaskService, rows: Array<Partial<ImportRow>>) => svc.importTasks(rows as ImportRow[]);

  it("creates rows in order with their own type, owner, dates and priority", async () => {
    const { svc, created } = service();
    const r = await run(svc, [{ summary: "Dựng API", issueType: "Story", assignee: "lan", startDate: "2026-11-02", durationDays: 5, priority: "cao", labels: ["be"] }]);
    assert.equal(r.errors.length, 0);
    assert.deepEqual(
      { t: created[0].issueType, a: created[0].assigneeAccountId, s: created[0].startDate, d: created[0].durationDays, p: created[0].priority },
      { t: "Story", a: "lan", s: "2026-11-02", d: 5, p: "High" }
    );
  });

  it("a '#N' parent points at an earlier row, so one sheet carries a whole WBS", async () => {
    const { svc, created } = service();
    await run(svc, [{ summary: "Giai đoạn 1", issueType: "Epic" }, { summary: "Khảo sát", parent: "#1" }, { summary: "Phỏng vấn", parent: "#2" }]);
    assert.deepEqual(created.map((c) => c.wbsParentId), [null, "P-1", "P-2"]);
  });

  it("a parent that failed, or lies below, is a row error — not a task in the wrong place", async () => {
    const { svc, created } = service((s) => s === "Cha");
    const r = await run(svc, [{ summary: "Cha" }, { summary: "Con", parent: "#1" }, { summary: "Lạc", parent: "#9" }]);
    assert.equal(created.length, 0);
    assert.deepEqual(r.errors.map((e) => [e.row, /chưa được tạo|phía trên|Jira từ chối/.test(e.message)]), [[1, true], [2, true], [3, true]]);
  });

  it("an existing key works as a parent, one from another project does not", async () => {
    const { svc, created } = service();
    const r = await run(svc, [{ summary: "a", parent: "p-7" }, { summary: "b", parent: "OTHER-1" }]);
    assert.equal(created[0].wbsParentId, "P-7");
    assert.equal(r.errors[0].row, 2);
  });

  it("an ambiguous owner name is that row's error and creates nothing for it", async () => {
    const { svc, created } = service();
    const r = await run(svc, [{ summary: "Việc của Quang", assignee: "Quang" }, { summary: "Việc ổn", assignee: "Trần Lan" }]);
    assert.equal(created.length, 1);
    assert.equal(created[0].assigneeAccountId, "lan");
    assert.match(r.errors[0].message, /2 người khớp/);
    assert.equal(r.errors[0].row, 1);
  });

  it("bad dates, durations and priorities are caught per row, with the sheet's row number", async () => {
    const { svc } = service();
    const r = await run(svc, [{ summary: "a", startDate: "2026-02-30" }, { summary: "b", durationDays: 0 }, { summary: "c", priority: "siêu cấp" }, { summary: "" }, { summary: "ok" }]);
    assert.deepEqual(r.errors.map((e) => e.row), [1, 2, 3, 4]);
    assert.equal(r.created.length, 1);
  });

  it("one Jira failure does not stop the rest", async () => {
    const { svc } = service((s) => s === "hỏng");
    const r = await run(svc, [{ summary: "một" }, { summary: "hỏng" }, { summary: "ba" }]);
    assert.deepEqual(r.created.map((t) => t.id), ["P-1", "P-2"]);
    assert.deepEqual(r.errors.map((e) => e.row), [2]);
  });

  it("refuses an empty or oversized import before creating anything", async () => {
    const { svc, created } = service();
    await assert.rejects(run(svc, []), /Không có dòng nào/);
    await assert.rejects(run(svc, Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ summary: `t${i}` }))), /tối đa/);
    assert.equal(created.length, 0);
  });
});
