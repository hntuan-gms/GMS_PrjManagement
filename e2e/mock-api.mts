// A stand-in for the real API so the real client can be driven in a browser with
// no Atlassian login, no Jira and no database. The progress numbers come from
// the REAL computeProgress, so the report page is exercised end to end.
import express from "express";
import { computeProgress } from "../server/src/progress.ts";

// The LOCAL date, like the client's todayIso(): UTC is a day behind in Vietnam until 07:00, and a test that
// counts "before today" must not flip with the hour it happens to run.
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const TODAY = localToday();
const day = (n: number) => new Date(Date.parse(TODAY) + n * 86400000).toISOString().slice(0, 10);

const users = [
  { accountId: "me", displayName: "Tuấn Test", avatarUrl: null },
  { accountId: "anh", displayName: "Nguyễn Anh", avatarUrl: null },
  { accountId: "binh", displayName: "Trần Bình", avatarUrl: null },
  { accountId: "chi", displayName: "Lê Chi", avatarUrl: null },
];
const nameOf = (id: string | null) => users.find((u) => u.accountId === id)?.displayName ?? null;

const base = {
  description: null, durationDays: 4, percentComplete: 0, predecessors: [], estimateHours: null, spentHours: null,
  priority: "Medium", labels: [] as string[], components: [] as string[], fixVersions: [] as string[], sprint: null as any, jiraUrl: "https://example.atlassian.net/browse/X",
  statusName: "To Do", statusCategory: "new", assigneeAccountId: null, assigneeName: null, assigneeAvatarUrl: null,
  wbsParentId: null,
};
let tasks: any[] = [
  { id: "DEMO-1", summary: "Giai đoạn 1 — Khảo sát", issueType: "Epic", startDate: day(-10), dueDate: day(5) },
  { id: "DEMO-2", summary: "Giai đoạn 2 — Xây dựng", issueType: "Epic", startDate: day(2), dueDate: day(20) },
  { id: "DEMO-3", summary: "Phân tích yêu cầu", issueType: "Story", wbsParentId: "DEMO-1", assigneeAccountId: "anh", statusName: "In Progress", statusCategory: "indeterminate", startDate: day(-8), dueDate: day(-1), labels: ["urgent"], priority: "High" },
  { id: "DEMO-4", summary: "Viết tài liệu BRD", issueType: "Task", wbsParentId: "DEMO-1", assigneeAccountId: "binh", statusName: "Done", statusCategory: "done", percentComplete: 100, startDate: day(-9), dueDate: day(-4) },
  { id: "DEMO-5", summary: "Thiết kế cơ sở dữ liệu", issueType: "Task", wbsParentId: "DEMO-2", assigneeAccountId: "anh", startDate: day(2), dueDate: day(6), estimateHours: 16, components: ["Backend"], fixVersions: ["1.0"], sprint: { id: 7, name: "Sprint 7", state: "active" } },
  { id: "DEMO-6", summary: "Dựng API đăng nhập", issueType: "Task", wbsParentId: "DEMO-2", assigneeAccountId: "chi", startDate: day(3), dueDate: day(9), labels: ["backend"] },
  { id: "DEMO-7", summary: "Sửa lỗi hiển thị bảng", issueType: "Bug", wbsParentId: "DEMO-2", startDate: day(1), dueDate: day(3), priority: "Highest" },
  { id: "DEMO-8", summary: "Kiểm thử tích hợp", issueType: "Task", wbsParentId: "DEMO-2", assigneeAccountId: "binh", startDate: day(8), dueDate: day(14), labels: ["milestone"] },
  { id: "DEMO-9", summary: "Công việc chưa có ngày", issueType: "Task", assigneeAccountId: "me", startDate: null, dueDate: null },
].map((t: any) => ({ ...base, baselineStart: t.startDate, baselineDue: t.dueDate, ...t, assigneeName: nameOf(t.assigneeAccountId ?? null) }));

let comments: Record<string, any[]> = {
  "DEMO-3": [
    { id: "c1", authorAccountId: "anh", authorName: "Nguyễn Anh", authorAvatarUrl: null, text: "Cần chốt phạm vi với @[Tuấn Test](me) trước thứ Sáu. Xem https://example.com/spec.", created: new Date().toISOString(), updated: new Date().toISOString(), mine: false },
  ],
};
let cid = 100;
const log: any[] = [];
let chatAborts = 0;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  if (req.method !== "GET" && !req.path.startsWith("/api/__")) log.push({ m: req.method, p: req.path, b: req.body });
  next();
});

// Back to the data the server started with — the e2e files share one stand-in API.
const pristine = { tasks: structuredClone(tasks), comments: structuredClone(comments) };
app.post("/api/__restore", (_q, r) => {
  tasks = structuredClone(pristine.tasks);
  comments = structuredClone(pristine.comments);
  issueLinks = [{ id: "L1", a: "DEMO-3", b: "DEMO-5", type: "Blocks" }];
  savedFilters = savedFilters.filter((f) => !f.mine);
  watching = false;
  log.length = 0;
  r.json({});
});
app.get("/api/__log", (_q, r) => r.json({ log, chatAborts }));
app.post("/api/__reset", (_q, r) => { log.length = 0; chatAborts = 0; r.json({}); });

app.get("/api/auth/me", (_q, r) => r.json({
  user: users[0], site: { cloudId: "c1", url: "https://example.atlassian.net", name: "Example" },
  project: { key: "DEMO", name: "Dự án mẫu" }, startDateFieldId: null, overlayEphemeral: false, staff: true,
}));
app.get("/api/auth/projects", (_q, r) => r.json([{ id: "1", key: "DEMO", name: "Dự án mẫu", avatarUrl: null }]));

app.get("/api/tasks", (_q, r) => r.json(tasks));
app.get("/api/users", (_q, r) => r.json(users));
app.get("/api/priorities", (_q, r) => r.json(["Highest", "High", "Medium", "Low", "Lowest"]));
app.get("/api/labels", (_q, r) => r.json(["urgent", "backend", "frontend", "docs"]));
app.get("/api/issue-types", (_q, r) => r.json([
  { name: "Epic", subtask: false }, { name: "Story", subtask: false }, { name: "Task", subtask: false },
  { name: "Bug", subtask: false }, { name: "Công việc con", subtask: true },
]));
app.get("/api/tasks/:id/transitions", (_q, r) => r.json([
  { id: "11", name: "Start", toStatusName: "In Progress", toCategory: "indeterminate" },
  { id: "31", name: "Done", toStatusName: "Done", toCategory: "done" },
]));
app.get("/api/tasks/:id/attachments", (_q, r) => r.json({ files: [], links: [] }));

app.patch("/api/tasks/:id", (req, res) => {
  const t = tasks.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "Không tìm thấy" });
  const b = req.body;
  if (b.assigneeAccountId !== undefined) {
    if (b.assigneeAccountId && t.issueType === "Epic") return res.status(400).json({ error: `${t.id} là Epic nên không gán người phụ trách được.` });
    t.assigneeAccountId = b.assigneeAccountId; t.assigneeName = nameOf(b.assigneeAccountId);
  }
  if (b.statusTransition) {
    const map: any = { "In Progress": "indeterminate", Done: "done", "To Do": "new" };
    if (!map[b.statusTransition] && !["11", "31"].includes(b.statusTransition)) return res.status(400).json({ error: `Không chuyển được sang "${b.statusTransition}".` });
    const name = b.statusTransition === "11" ? "In Progress" : b.statusTransition === "31" ? "Done" : b.statusTransition;
    t.statusName = name; t.statusCategory = map[name];
  }
  if (b.issueType !== undefined) {
    if (b.issueType === "Epic" && t.assigneeAccountId) return res.status(400).json({ error: `${t.id} đang có người phụ trách; Epic không có người phụ trách, hãy bỏ người phụ trách trước khi đổi sang Epic.` });
    t.issueType = b.issueType;
  }
  if (b.parentKey !== undefined) {
    if (b.parentKey === t.id) return res.status(400).json({ error: "Một công việc không thể làm cha của chính nó." });
    t.wbsParentId = b.parentKey;
  }
  for (const k of ["summary", "description", "startDate", "priority", "labels", "components", "fixVersions", "percentComplete", "estimateHours", "durationDays"]) if (b[k] !== undefined) t[k] = b[k];
  if (b.startDate !== undefined && b.startDate) t.dueDate = day(Math.round((Date.parse(b.startDate) - Date.parse(TODAY)) / 86400000) + (t.durationDays ?? 1) - 1);
  res.json({ ...t, cascaded: [] });
});
app.post("/api/tasks", (req, res) => {
  const b = req.body;
  const t = { ...base, baselineStart: b.startDate ?? null, baselineDue: b.dueDate ?? null, id: `DEMO-${10 + tasks.length}`, summary: b.summary, issueType: b.issueType, wbsParentId: b.wbsParentId ?? null, assigneeAccountId: b.assigneeAccountId ?? null, assigneeName: nameOf(b.assigneeAccountId ?? null), startDate: b.startDate ?? null, dueDate: b.dueDate ?? null, labels: b.labels ?? [] };
  tasks.push(t);
  res.status(201).json(t);
});
app.post("/api/tasks/bulk", (req, res) => {
  const b = req.body; const created: any[] = [];
  for (const s of b.summaries) {
    const t = { ...base, baselineStart: b.startDate ?? null, baselineDue: null, id: `DEMO-${10 + tasks.length}`, summary: s, issueType: b.issueType, wbsParentId: b.wbsParentId ?? null, assigneeAccountId: b.assigneeAccountId ?? null, assigneeName: nameOf(b.assigneeAccountId ?? null), startDate: b.startDate ?? null, dueDate: null };
    tasks.push(t); created.push(t);
  }
  res.status(201).json({ created, errors: [] });
});
app.delete("/api/tasks/:id", (req, res) => { tasks = tasks.filter((t) => t.id !== req.params.id); res.status(204).end(); });

app.get("/api/tasks/:id/comments", (req, res) => res.json(comments[req.params.id] ?? []));
app.post("/api/tasks/:id/comments", (req, res) => {
  const c = { id: `c${++cid}`, authorAccountId: "me", authorName: "Tuấn Test", authorAvatarUrl: null, text: req.body.text, created: new Date().toISOString(), updated: new Date().toISOString(), mine: true };
  (comments[req.params.id] ??= []).unshift(c);
  res.status(201).json(c);
});
app.put("/api/tasks/:id/comments/:cid", (req, res) => {
  const c = (comments[req.params.id] ?? []).find((x) => x.id === req.params.cid);
  if (!c) return res.status(404).json({ error: "Không có" });
  c.text = req.body.text; c.updated = new Date(Date.now() + 1000).toISOString();
  res.json(c);
});
app.delete("/api/tasks/:id/comments/:cid", (req, res) => { comments[req.params.id] = (comments[req.params.id] ?? []).filter((x) => x.id !== req.params.cid); res.status(204).end(); });
app.get("/api/tasks/:id/activity", (_q, res) => res.json([
  { id: "h2", authorName: "Nguyễn Anh", authorAccountId: "anh", created: new Date().toISOString(), changes: [{ field: "status", from: "To Do", to: "In Progress" }, { field: "timeoriginalestimate", from: null, to: "16h" }] },
  { id: "h1", authorName: "Tuấn Test", authorAccountId: "me", created: new Date(Date.now() - 86400000).toISOString(), changes: [{ field: "assignee", from: null, to: "Nguyễn Anh" }] },
]));

app.get("/api/resources", (_q, r) => r.json({
  users, memberSource: "project-roles", memberFallback: null, memberSkippedGroups: 0, memberRoles: ["Developers"],
  memberTruncated: false, profiles: [], absences: [], defaultCapacityHours: 8,
}));

app.get("/api/progress", (req, res) => {
  const q = req.query as Record<string, string>;
  const scope = { assignee: q.assignee || undefined, epic: q.epic || undefined, types: q.type ? q.type.split(",") : [] };
  res.json({ metrics: computeProgress(tasks, q.asOf || TODAY, scope), latest: null, history: [] });
});

app.get("/api/timesheet", (req, res) => {
  const { from, to } = req.query as Record<string, string>;
  res.json({
    from, to,
    people: users.map((u) => ({ accountId: u.accountId, displayName: u.displayName, avatarUrl: null, capacityHoursPerDay: 8, absences: [], outsider: false })),
    entries: [
      { id: "w1", issueKey: "DEMO-3", summary: "Phân tích yêu cầu", issueType: "Story", authorAccountId: "me", authorName: "Tuấn Test", date: TODAY, hours: 4, comment: "họp", mine: true },
      { id: "w2", issueKey: "DEMO-4", summary: "Viết tài liệu BRD", issueType: "Task", authorAccountId: "anh", authorName: "Nguyễn Anh", date: TODAY, hours: 6, comment: null, mine: false },
    ],
  });
});
app.delete("/api/timesheet/worklogs/:k/:id", (_q, r) => r.status(204).end());

// --- phase 2 / stage 2: components, versions, links, watchers, JQL, baselines, import, saved filters ---
app.get("/api/components", (_q, r) => r.json([{ id: "1", name: "Backend" }, { id: "2", name: "UI" }]));
app.get("/api/versions", (_q, r) => r.json([
  { id: "1", name: "1.0", released: false, archived: false, releaseDate: day(10), startDate: null },
  { id: "2", name: "0.9", released: true, archived: false, releaseDate: day(-3), startDate: null },
]));
app.get("/api/link-types", (_q, r) => r.json([
  { id: "1", name: "Blocks", inward: "is blocked by", outward: "blocks" },
  { id: "2", name: "Relates", inward: "relates to", outward: "relates to" },
]));
let issueLinks: Array<{ id: string; a: string; b: string; type: string }> = [{ id: "L1", a: "DEMO-3", b: "DEMO-5", type: "Blocks" }];
let linkSeq = 1;
const linkViews = (key: string) => issueLinks.filter((l) => l.a === key || l.b === key).map((l) => {
  const out = l.a === key; const other = out ? l.b : l.a; const o = tasks.find((t) => t.id === other);
  const t = l.type === "Blocks" ? { outward: "blocks", inward: "is blocked by" } : { outward: "relates to", inward: "relates to" };
  return { id: l.id, typeName: l.type, direction: out ? "outward" : "inward", label: out ? t.outward : t.inward, key: other, summary: o?.summary ?? "", status: o?.statusName ?? "", statusCategory: o?.statusCategory ?? "new", issueType: o?.issueType ?? "" };
});
app.get("/api/tasks/:id/issue-links", (req, r) => r.json(linkViews(req.params.id)));
app.post("/api/tasks/:id/issue-links", (req, res) => {
  const { typeName, otherKey, direction } = req.body;
  if (!tasks.some((t) => t.id === otherKey)) return res.status(400).json({ error: "Jira không tạo được liên kết: không tìm thấy công việc kia." });
  issueLinks.push({ id: `L${++linkSeq}`, a: direction === "outward" ? req.params.id : otherKey, b: direction === "outward" ? otherKey : req.params.id, type: typeName });
  res.status(201).json(linkViews(req.params.id));
});
app.delete("/api/tasks/:id/issue-links/:linkId", (req, res) => { issueLinks = issueLinks.filter((l) => l.id !== req.params.linkId); res.json(linkViews(req.params.id)); });

let watching = false;
const watchersView = () => ({ isWatching: watching, count: 1 + (watching ? 1 : 0), listed: true, watchers: [{ accountId: "anh", displayName: "Nguyễn Anh", avatarUrl: null }, ...(watching ? [{ accountId: "me", displayName: "Tuấn Test", avatarUrl: null }] : [])] });
app.get("/api/tasks/:id/watchers", (_q, r) => r.json(watchersView()));
app.put("/api/tasks/:id/watchers", (req, r) => { watching = !!req.body.watching; r.json(watchersView()); });

app.post("/api/tasks/jql", (req, res) => {
  const jql: string = String(req.body.jql ?? "");
  if (/status =\s*$/i.test(jql) || jql.includes("lỗi cú pháp")) return res.status(400).json({ error: "JQL không hợp lệ: Error in the JQL Query: lỗi cú pháp" });
  const keys = tasks.filter((t) => (/assignee = anh/i.test(jql) ? t.assigneeAccountId === "anh" : true) && (/status = Done/i.test(jql) ? t.statusCategory === "done" : true)).map((t) => t.id);
  res.json({ keys, truncated: false });
});

app.post("/api/tasks/baseline", (req, res) => {
  const { ids, clear } = req.body ?? {};
  const chosen = tasks.filter((t) => !ids || ids.includes(t.id));
  let skipped = 0;
  for (const t of chosen) {
    if (clear) { t.baselineStart = null; t.baselineDue = null; }
    else if (t.startDate && t.dueDate) { t.baselineStart = t.startDate; t.baselineDue = t.dueDate; }
    else skipped++;
  }
  res.json({ updated: chosen.length - skipped, skipped });
});

app.post("/api/tasks/import", (req, res) => {
  const rows: any[] = req.body.rows ?? [];
  const created: any[] = []; const errors: any[] = []; const rowKeys: Record<number, string> = {};
  rows.forEach((r, i) => {
    const n = i + 1;
    if (String(r.summary).includes("LỖI")) { errors.push({ row: n, summary: r.summary, message: "Jira từ chối (giả lập)" }); return; }
    let parent: string | null = null;
    const m = /^#(\d+)$/.exec(r.parent ?? "");
    if (m) { parent = rowKeys[Number(m[1])] ?? null; if (!parent) { errors.push({ row: n, summary: r.summary, message: "Việc cha chưa được tạo" }); return; } }
    else if (r.parent) parent = r.parent;
    const t = { ...base, id: `DEMO-${100 + tasks.length}`, summary: r.summary, issueType: r.issueType ?? "Task", wbsParentId: parent, startDate: r.startDate ?? null, dueDate: r.startDate ?? null, baselineStart: r.startDate ?? null, baselineDue: r.startDate ?? null, assigneeAccountId: null, assigneeName: null, labels: r.labels ?? [] };
    tasks.push(t); created.push(t); rowKeys[n] = t.id;
  });
  res.status(201).json({ created, errors, warnings: [], rowKeys });
});

let savedFilters: any[] = [
  { id: "f1", name: "Việc của Anh", shared: true, mine: false, ownerName: "Nguyễn Anh", updatedAt: new Date().toISOString(),
    spec: { text: "", people: ["anh"], statuses: [], types: [], epics: [], labels: [], components: [], versions: [], sprints: [], onlyOverdue: false, jql: "" } },
];
let filterSeq = 1;
app.get("/api/filters", (_q, r) => r.json(savedFilters));
app.post("/api/filters", (req, res) => {
  const { name, spec, shared } = req.body;
  const existing = savedFilters.find((f) => f.mine && f.name.toLowerCase() === String(name).toLowerCase());
  const f = { id: existing?.id ?? `f${++filterSeq + 1}`, name, shared: shared !== false, mine: true, ownerName: "Tuấn Test", updatedAt: new Date().toISOString(), spec };
  savedFilters = [...savedFilters.filter((x) => x.id !== f.id), f];
  res.status(201).json(f);
});
app.patch("/api/filters/:id", (req, res) => { const f = savedFilters.find((x) => x.id === req.params.id && x.mine); if (!f) return res.status(404).json({ error: "Không tìm thấy bộ lọc này, hoặc đây không phải bộ lọc của bạn." }); f.shared = !!req.body.shared; res.status(204).end(); });
app.delete("/api/filters/:id", (req, res) => { const n = savedFilters.length; savedFilters = savedFilters.filter((x) => !(x.id === req.params.id && x.mine)); res.status(n === savedFilters.length ? 404 : 204).end(); });

// --- board: a Scrum board with one active sprint ---------------------------
const boardIssues = () => tasks.filter((t) => t.issueType !== "Epic").map((t, i) => ({
  key: t.id, summary: t.summary, issueType: t.issueType, subtask: false,
  statusId: t.statusCategory === "done" ? "3" : t.statusCategory === "indeterminate" ? "2" : "1",
  statusName: t.statusName, statusCategory: t.statusCategory, assigneeAccountId: t.assigneeAccountId, assigneeName: t.assigneeName,
  priority: t.priority, estimate: 3, sprintId: i < 6 ? 7 : null, epicKey: t.wbsParentId?.startsWith("DEMO-") && ["DEMO-1", "DEMO-2"].includes(t.wbsParentId) ? t.wbsParentId : null,
  epicSummary: t.wbsParentId === "DEMO-1" ? "Giai đoạn 1" : t.wbsParentId === "DEMO-2" ? "Giai đoạn 2" : null,
  parentKey: t.wbsParentId, flagged: false, labels: t.labels, dueDate: t.dueDate, resolutionDate: null, updated: null, blockedBy: [],
}));
app.get("/api/board", (_q, r) => r.json({
  mode: "agile", fallback: null, boards: [{ id: 1, name: "Bảng DEMO", type: "scrum" }], board: { id: 1, name: "Bảng DEMO", type: "scrum" },
  columns: [{ name: "To Do", statusIds: ["1"], min: null, max: null }, { name: "In Progress", statusIds: ["2"], min: null, max: null }, { name: "Done", statusIds: ["3"], min: null, max: null }],
  statuses: [{ id: "1", name: "To Do", category: "new" }, { id: "2", name: "In Progress", category: "indeterminate" }, { id: "3", name: "Done", category: "done" }],
  estimation: { fieldId: "customfield_1", name: "Story Points", unit: "points" },
  sprints: [{ id: 7, name: "Sprint 7", state: "active", goal: "Chốt phần khảo sát", startDate: day(-5), endDate: day(9), completeDate: null }],
  velocity: [], throughput: [], issues: boardIssues(), truncated: false,
}));
app.post("/api/board/sprints/:id/issues", (_q, r) => r.status(204).end());

// --- ai chat: an SSE stream that notices when the client goes away ----------
app.get("/api/ai/chat/sessions", (_q, r) => r.json([]));
// Pricing is "configured" here so the cost shows; phase1.e2e.mjs does not look at it.
app.get("/api/ai/usage", (_q, r) => r.json({
  model: "mock", pricing: { configured: true, currency: "USD" },
  session: null,
  project: { messages: 0, promptTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0, totalTokens: 0, cost: { amount: 0.5, currency: "USD", partial: false } },
}));

// The last exchange, as the real server tracks it, so regenerate / edit can be
// refused (409) exactly when the answer wrote to Jira.
let lastAnswerMutated = false;
let answerCount = 0;
const slowWords = ["Đây", " là", " câu", " trả", " lời", " rất", " dài", " được", " stream", " từng", " chữ", "."];

app.post("/api/ai/chat", (req, res) => {
  const body = req.body ?? {};
  const retry = body.regenerate === true || body.replaceLast === true;
  if (retry && lastAnswerMutated) {
    return res.status(409).json({ error: "Lượt này đã thay đổi dữ liệu trên Jira nên không tạo lại hay sửa được." });
  }
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.flushHeaders();
  const send = (e: string, d: unknown) => res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
  const message: string = String(body.message ?? "");
  send("session", { sessionId: "s1" });
  const done = () => {
    send("done", { messageId: `m${answerCount}`, usage: { messages: answerCount, promptTokens: 1000, outputTokens: 500, thoughtTokens: 0, cachedTokens: 0, totalTokens: 1500, cost: { amount: 0.0123 * answerCount, currency: "USD", partial: false } } });
    res.end();
  };

  // Fast, scripted turns for the tests that are not about streaming.
  if (message.includes("nhanh") || body.regenerate === true) {
    answerCount++;
    lastAnswerMutated = false;
    if (message.includes("tạo")) {
      lastAnswerMutated = true;
      send("tool", { name: "create_task", label: "Đang tạo công việc trên Jira..." });
      send("mutated", {});
    }
    if (message.includes("lọc")) {
      send("tool", { name: "set_view_filter", label: "Đang áp bộ lọc lên màn hình..." });
      send("filter", { spec: { text: "", people: ["anh"], statuses: [], types: [], epics: [], labels: [], priorities: [], onlyOverdue: false, onlyBlocked: false }, view: null, summary: "người: Nguyễn Anh" });
    }
    const files: Array<{ name: string }> = Array.isArray(body.attachments) ? body.attachments : [];
    send("text", { text: `Trả lời số ${answerCount}.${files.length ? ` Đã đọc ${files.length} tệp: ${files.map((f) => f.name).join(", ")}.` : ""}` });
    return done();
  }

  let i = 0;
  const iv = setInterval(() => {
    if (i >= slowWords.length) { clearInterval(iv); answerCount++; lastAnswerMutated = false; return done(); }
    send("text", { text: slowWords[i++] });
  }, 400);
  res.on("close", () => { if (!res.writableFinished) { chatAborts++; clearInterval(iv); } });
});

const port = Number(process.env.MOCK_PORT ?? 4000);
app.listen(port, () => console.log(`MOCK API on :${port}`));
