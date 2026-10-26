import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runTool, type ToolContext } from "../src/ai/tools.js";
import { resolvePriority } from "../src/ai/toolUtils.js";
import { countMatching, resolveViewFilter } from "../src/ai/viewFilter.js";
import type { JiraUser, Task } from "../src/types.js";
import { task } from "./fixtures.js";

/**
 * The assistant's tools against a stand-in context: no Jira, no Gemini. What is
 * checked is the part this code owns — how loose words become exact arguments,
 * what is refused, and what is (not) written.
 */

const team: JiraUser[] = [
  { accountId: "me", displayName: "Tuấn Test", avatarUrl: null },
  { accountId: "q1", displayName: "Võ Đình Quang", avatarUrl: null },
  { accountId: "q2", displayName: "Nguyễn Quang", avatarUrl: null },
  { accountId: "lan", displayName: "Trần Lan", avatarUrl: null },
];

const project = (): Task[] => [
  task({ id: "P-1", summary: "Phase A", issueType: "Epic" }),
  task({ id: "P-2", summary: "Thiết kế màn hình đăng nhập", issueType: "Story", wbsParentId: "P-1", assigneeAccountId: "lan", assigneeName: "Trần Lan", priority: "High", labels: ["ui", "urgent"], dueDate: "2026-10-05" }),
  task({ id: "P-3", summary: "Viết API thanh toán", wbsParentId: "P-1", assigneeAccountId: "q1", assigneeName: "Võ Đình Quang", priority: "Low", labels: ["backend"], components: ["Backend"], fixVersions: ["1.0"] }),
  task({ id: "P-4", summary: "Kiểm thử", issueType: "Sub-task", wbsParentId: "P-2", statusName: "Done", statusCategory: "done" }),
  task({ id: "P-5", summary: "Kiểm thử", issueType: "Sub-task", wbsParentId: "P-3" }),
];

function makeCtx(tasks: Task[] = project()) {
  const calls = { updates: [] as Array<{ id: string; input: Record<string, unknown> }>, comments: [] as Array<{ id: string; text: string }>, created: [] as unknown[] };
  const ctx = {
    cloudId: "c",
    projectKey: "P",
    accountId: "me",
    today: "2026-10-14",
    tasks,
    team,
    mutated: false,
    tzOffsetMinutes: 420,
    taskService: {
      listPriorities: async () => ["Highest", "High", "Medium", "Low", "Lowest"],
      updateTask: async (id: string, input: Record<string, unknown>) => {
        calls.updates.push({ id, input });
        const base = tasks.find((t) => t.id === id)!;
        return { task: { ...base, ...(input.labels ? { labels: input.labels as string[] } : {}) }, cascaded: [], cascadeWarnings: [] };
      },
      createTask: async (input: { summary: string; issueType: string }) => {
        calls.created.push(input);
        return task({ id: "P-99", summary: input.summary, issueType: input.issueType as Task["issueType"] });
      },
    },
    extras: {
      components: async () => [{ id: "1", name: "Backend" }, { id: "2", name: "UI" }],
      versions: async () => [{ id: "1", name: "1.0", archived: false }, { id: "2", name: "1.1", archived: false }, { id: "3", name: "0.9", archived: true }],
    },
    activity: {
      addComment: async (id: string, text: string) => {
        calls.comments.push({ id, text });
        return { authorName: "Tuấn Test" };
      },
      listComments: async () => [],
      listActivity: async () => [],
    },
    boardService: {
      snapshot: async () => ({
        mode: "agile",
        board: { id: 1 },
        sprints: [{ id: 7, name: "Sprint 7", state: "active" }],
        issues: [
          { key: "P-2", sprintId: 7 },
          { key: "P-3", sprintId: null },
        ],
      }),
    },
  } as unknown as ToolContext;
  return { ctx, calls };
}

const run = (name: string, args: Record<string, unknown>, ctx: ToolContext) => runTool(name, args, ctx);

describe("resolvePriority", () => {
  const site = ["Highest", "High", "Medium", "Low", "Lowest"];
  it("maps spoken Vietnamese and English to the site's own name", () => {
    assert.deepEqual(resolvePriority(site, "cao"), { name: "High" });
    assert.deepEqual(resolvePriority(site, "Khẩn cấp"), { name: "Highest" });
    assert.deepEqual(resolvePriority(site, "thấp nhất"), { name: "Lowest" });
    assert.deepEqual(resolvePriority(site, "medium"), { name: "Medium" });
  });

  it("works on a site that renamed its priorities", () => {
    assert.deepEqual(resolvePriority(["P1", "P2"], "p1"), { name: "P1" });
    assert.ok("error" in resolvePriority(["P1", "P2"], "cao"));
  });

  it("an unknown priority is an error that lists what exists", () => {
    const r = resolvePriority(site, "siêu cấp");
    assert.ok("error" in r && r.available.length === 5);
  });
});

describe("update_task: priority and labels (1.1)", () => {
  it("sets the priority by a spoken word", async () => {
    const { ctx, calls } = makeCtx();
    await run("update_task", { taskId: "P-3", priority: "cao" }, ctx);
    assert.deepEqual(calls.updates, [{ id: "P-3", input: { priority: "High" } }]);
  });

  it("adds a label to the ones the task has, sending the full set", async () => {
    const { ctx, calls } = makeCtx();
    await run("update_task", { taskId: "P-3", addLabels: ["Khẩn cấp"] }, ctx);
    assert.deepEqual(calls.updates[0].input.labels, ["backend", "Khẩn-cấp"]);
  });

  it("removes a label case- and accent-insensitively and keeps the rest", async () => {
    const { ctx, calls } = makeCtx();
    await run("update_task", { taskId: "P-2", removeLabels: ["UI"] }, ctx);
    assert.deepEqual(calls.updates[0].input.labels, ["urgent"]);
  });

  it("adding a label the task already has changes nothing", async () => {
    const { ctx, calls } = makeCtx();
    const out = await run("update_task", { taskId: "P-3", addLabels: ["backend"] }, ctx);
    assert.equal(calls.updates.length, 0);
    assert.ok("error" in out.response);
  });

  it("an invalid priority writes nothing and lists the valid ones", async () => {
    const { ctx, calls } = makeCtx();
    const out = await run("update_task", { taskId: "P-3", priority: "siêu cấp" }, ctx);
    assert.equal(calls.updates.length, 0);
    assert.ok(Array.isArray(out.response.available));
  });
});

describe("search_tasks: label, priority, sprint (1.2)", () => {
  const ids = (out: { response: Record<string, unknown> }) => (out.response.tasks as Array<{ id: string }>).map((t) => t.id);

  it("by label", async () => {
    assert.deepEqual(ids(await run("search_tasks", { label: "URGENT" }, makeCtx().ctx)), ["P-2"]);
  });

  it("by priority, spoken", async () => {
    assert.deepEqual(ids(await run("search_tasks", { priority: "thấp" }, makeCtx().ctx)), ["P-3"]);
  });

  it("by sprint name, and by backlog", async () => {
    assert.deepEqual(ids(await run("search_tasks", { sprint: "7" }, makeCtx().ctx)), ["P-2"]);
    assert.deepEqual(ids(await run("search_tasks", { sprint: "backlog" }, makeCtx().ctx)), ["P-3"]);
  });

  it("an unknown sprint lists the real ones instead of returning nothing", async () => {
    const out = await run("search_tasks", { sprint: "99" }, makeCtx().ctx);
    assert.ok("error" in out.response && Array.isArray(out.response.sprints));
  });

  it("filters combine", async () => {
    assert.deepEqual(ids(await run("search_tasks", { label: "ui", sprint: "active" }, makeCtx().ctx)), ["P-2"]);
    assert.deepEqual(ids(await run("search_tasks", { label: "ui", sprint: "backlog" }, makeCtx().ctx)), []);
  });
});

describe("add_comment (1.3)", () => {
  it("resolves a spoken name and posts a real mention", async () => {
    const { ctx, calls } = makeCtx();
    const out = await run("add_comment", { taskId: "P-2", text: "@Lan xem giúp nhé", mentions: ["lan"] }, ctx);
    assert.deepEqual(calls.comments, [{ id: "P-2", text: "@[Trần Lan](lan) xem giúp nhé" }]);
    assert.deepEqual(out.response.notified, ["Trần Lan"]);
    assert.equal(ctx.mutated, true);
  });

  it("an ambiguous name posts NOTHING and comes back as a question", async () => {
    const { ctx, calls } = makeCtx();
    const out = await run("add_comment", { taskId: "P-2", text: "Cần chốt", mentions: ["Quang"] }, ctx);
    assert.equal(calls.comments.length, 0);
    assert.equal(ctx.mutated, false);
    assert.ok(Array.isArray(out.response.candidates) && (out.response.candidates as string[]).length === 2);
  });

  it("an unknown name posts nothing", async () => {
    const { ctx, calls } = makeCtx();
    const out = await run("add_comment", { taskId: "P-2", text: "hi", mentions: ["Không Ai"] }, ctx);
    assert.equal(calls.comments.length, 0);
    assert.ok("error" in out.response);
  });

  it("refuses a task outside the project and an empty comment", async () => {
    const { ctx, calls } = makeCtx();
    assert.ok("error" in (await run("add_comment", { taskId: "ZZ-1", text: "hi" }, ctx)).response);
    assert.ok("error" in (await run("add_comment", { taskId: "P-2", text: "  " }, ctx)).response);
    assert.equal(calls.comments.length, 0);
  });
});

describe("create_task: duplicate guard (1.7)", () => {
  it("does not create a task that looks like an existing one, and says which", async () => {
    const { ctx, calls } = makeCtx();
    const out = await run("create_task", { summary: "Thiết kế màn hình đăng nhập", issueType: "Story" }, ctx);
    assert.equal(calls.created.length, 0);
    assert.equal(out.response.needsConfirmation, true);
    assert.equal((out.response.possibleDuplicates as Array<{ id: string }>)[0].id, "P-2");
    assert.equal(ctx.mutated, false);
  });

  it("creates it once the user has seen the duplicates and still wants it", async () => {
    const { ctx, calls } = makeCtx();
    const out = await run("create_task", { summary: "Thiết kế màn hình đăng nhập", issueType: "Story", allowDuplicate: true }, ctx);
    assert.equal(calls.created.length, 1);
    assert.equal(out.response.created, "P-99");
  });

  it("different work is created without a question", async () => {
    const { ctx, calls } = makeCtx();
    await run("create_task", { summary: "Triển khai lên Cloud Run", issueType: "Task" }, ctx);
    assert.equal(calls.created.length, 1);
  });

  it("under a parent only that parent's children count: the same sub-task title under another Story is normal", async () => {
    const { ctx, calls } = makeCtx();
    // "Kiểm thử" exists under P-2 and P-3; a new one under P-1 (no such child) is fine,
    // and one under P-3 collides with P-5 only.
    await run("create_task", { summary: "Kiểm thử", issueType: "Sub-task", parentKey: "P-1" }, ctx);
    assert.equal(calls.created.length, 1);
    const out = await run("create_task", { summary: "Kiểm thử", issueType: "Sub-task", parentKey: "P-3" }, ctx);
    assert.equal(out.response.needsConfirmation, true);
    assert.deepEqual((out.response.possibleDuplicates as Array<{ id: string }>).map((d) => d.id), ["P-5"]);
  });
});

describe("find_similar_tasks (1.7)", () => {
  it("checks an existing task against the rest, never against itself", async () => {
    const { ctx } = makeCtx();
    const out = await run("find_similar_tasks", { taskId: "P-4" }, ctx);
    const matches = out.response.matches as Array<{ id: string; likelyDuplicate: boolean }>;
    assert.deepEqual(matches.map((m) => m.id), ["P-5"]);
    assert.equal(matches[0].likelyDuplicate, true);
  });

  it("needs something to compare", async () => {
    assert.ok("error" in (await run("find_similar_tasks", {}, makeCtx().ctx)).response);
  });
});

describe("set_view_filter (1.6)", () => {
  const resolve = (args: Record<string, unknown>) =>
    resolveViewFilter(args, { tasks: project(), team, accountId: "me", today: "2026-10-14" });

  it("turns names and words into exact ids and status names", () => {
    const r = resolve({ assignees: ["lan"], statuses: ["xong"], overdue: true });
    assert.ok("event" in r);
    assert.deepEqual(r.event.spec?.people, ["lan"]);
    assert.deepEqual(r.event.spec?.statuses, ["Done"]);
    assert.equal(r.event.spec?.onlyOverdue, true);
  });

  it("'me' is the signed-in user and 'none' is unassigned", () => {
    const r = resolve({ assignees: ["tôi", "chưa gán"] });
    assert.ok("event" in r);
    assert.deepEqual(r.event.spec?.people, ["me", "none"]);
  });

  it("\"Minh\" is a colleague, not \"mình\" (me): the folded words collide", () => {
    const withMinh = [...team, { accountId: "minh", displayName: "Lê Minh", avatarUrl: null }];
    const r = resolveViewFilter({ assignees: ["Minh"] }, { tasks: project(), team: withMinh, accountId: "me", today: "2026-10-14" });
    assert.ok("event" in r);
    assert.deepEqual(r.event.spec?.people, ["minh"]);
  });

  it("an ambiguous name is a question, not a filter", () => {
    const r = resolve({ assignees: ["Quang"] });
    assert.ok("error" in r && Array.isArray(r.candidates));
  });

  it("an Epic can be named by its title and a status that does not exist is refused", () => {
    const r = resolve({ epics: ["phase a"] });
    assert.ok("event" in r);
    assert.deepEqual(r.event.spec?.epics, ["P-1"]);
    assert.ok("error" in resolve({ statuses: ["Đang review"] }));
  });

  it("reports how many tasks match, by the same rules as the Gantt filter", () => {
    const r = resolve({ assignees: ["lan"], overdue: true });
    assert.ok("event" in r);
    assert.equal(r.matching, 1); // P-2: Lan's, past due, open
    assert.equal(countMatching(project(), { ...r.event.spec!, onlyOverdue: false }, "2026-10-14"), 1);
  });

  it("clear removes the filters; an empty call is an error", () => {
    const cleared = resolve({ clear: true });
    assert.ok("event" in cleared && cleared.event.spec === null);
    assert.ok("error" in resolve({}));
  });

  it("travels with the tool outcome and changes no data", async () => {
    const { ctx, calls } = makeCtx();
    const out = await run("set_view_filter", { assignees: ["lan"], view: "board" }, ctx);
    assert.equal(out.filter?.view, "board");
    assert.equal(calls.updates.length, 0);
    assert.equal(ctx.mutated, false);
  });
});

describe("task_digest (1.5)", () => {
  it("still answers when Jira's comments are unreachable, and says what is missing", async () => {
    const { ctx } = makeCtx();
    (ctx as unknown as { activity: Record<string, unknown> }).activity.listComments = async () => {
      throw new Error("boom");
    };
    const out = await run("task_digest", { taskId: "P-2" }, ctx);
    assert.match(String(out.response.notAvailable), /bình luận/);
    assert.ok(Array.isArray(out.response.signals));
  });
});

describe("get_task_comments / get_task_history (1.3, 1.4)", () => {
  it("read the issue's own comments and history, newest first, capped", async () => {
    const { ctx } = makeCtx();
    (ctx as unknown as { activity: Record<string, unknown> }).activity.listComments = async () =>
      Array.from({ length: 12 }, (_, i) => ({ authorName: "Lan", created: `2026-10-${String(i + 1).padStart(2, "0")}`, updated: `2026-10-${String(i + 1).padStart(2, "0")}`, text: `c${i} @[Quang](q1)` }));
    (ctx as unknown as { activity: Record<string, unknown> }).activity.listActivity = async () => [
      { created: "2026-10-09", authorName: "Minh", changes: [{ field: "status", from: "To Do", to: "Done" }] },
    ];
    const comments = await run("get_task_comments", { taskId: "P-2", limit: 3 }, ctx);
    assert.equal((comments.response.comments as unknown[]).length, 3);
    assert.equal(comments.response.total, 12);
    assert.match(String((comments.response.comments as Array<{ text: string }>)[0].text), /@Quang/);
    assert.ok(!String((comments.response.comments as Array<{ text: string }>)[0].text).includes("]("));
    const history = await run("get_task_history", { taskId: "P-2" }, ctx);
    assert.deepEqual((history.response.history as Array<{ changes: string[] }>)[0].changes, ["status: To Do → Done"]);
  });

  it("refuse a task outside the project", async () => {
    const { ctx } = makeCtx();
    assert.ok("error" in (await run("get_task_comments", { taskId: "ZZ-1" }, ctx)).response);
    assert.ok("error" in (await run("get_task_history", { taskId: "ZZ-1" }, ctx)).response);
  });
});

describe("components, versions, parent and type via update_task / search_tasks (phase 2 · stage 2)", () => {
  it("adds a component by its spoken name, written as the project spells it, as the full set", async () => {
    const { ctx, calls } = makeCtx();
    await run("update_task", { taskId: "P-3", addComponents: ["ui"] }, ctx);
    assert.deepEqual(calls.updates[0].input.components, ["Backend", "UI"]);
  });

  it("removes one and keeps the rest", async () => {
    const { ctx, calls } = makeCtx();
    await run("update_task", { taskId: "P-3", removeComponents: ["BACKEND"] }, ctx);
    assert.deepEqual(calls.updates[0].input.components, []);
  });

  it("a name the project does not define is refused and lists the real ones — nothing is written", async () => {
    const { ctx, calls } = makeCtx();
    const out = await run("update_task", { taskId: "P-3", addComponents: ["Mobile"] }, ctx);
    assert.equal(calls.updates.length, 0);
    assert.deepEqual(out.response.available, ["Backend", "UI"]);
  });

  it("an archived version is not offered, one already set can still be removed", async () => {
    const { ctx, calls } = makeCtx();
    const refused = await run("update_task", { taskId: "P-3", addFixVersions: ["0.9"] }, ctx);
    assert.ok("error" in refused.response);
    await run("update_task", { taskId: "P-3", addFixVersions: ["1.1"], removeFixVersions: ["1.0"] }, ctx);
    assert.deepEqual(calls.updates[0].input.fixVersions, ["1.1"]);
  });

  it("moves a task under a parent, or off its parent with 'none'", async () => {
    const { ctx, calls } = makeCtx();
    await run("update_task", { taskId: "P-3", parentKey: "p-1" }, ctx);
    await run("update_task", { taskId: "P-3", parentKey: "none" }, ctx);
    assert.deepEqual(calls.updates.map((u) => u.input.parentKey), ["P-1", null]);
    assert.ok("error" in (await run("update_task", { taskId: "P-3", parentKey: "ZZ-9" }, ctx)).response);
  });

  it("changes the type only when it is different", async () => {
    const { ctx, calls } = makeCtx();
    await run("update_task", { taskId: "P-3", issueType: "Bug" }, ctx);
    assert.equal(calls.updates[0].input.issueType, "Bug");
    const same = await run("update_task", { taskId: "P-3", issueType: "task" }, ctx);
    assert.equal(calls.updates.length, 1);
    assert.ok("error" in same.response);
  });

  it("search_tasks finds by component and by version", async () => {
    const { ctx } = makeCtx();
    const ids = (o: { response: Record<string, unknown> }) => (o.response.tasks as Array<{ id: string }>).map((t) => t.id);
    assert.deepEqual(ids(await run("search_tasks", { component: "backend" }, ctx)), ["P-3"]);
    assert.deepEqual(ids(await run("search_tasks", { version: "1.0" }, ctx)), ["P-3"]);
    assert.deepEqual(ids(await run("search_tasks", { version: "2.0" }, ctx)), []);
  });
});
