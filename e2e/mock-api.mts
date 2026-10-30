// A stand-in for the real API so the real client can be driven in a browser with
// no Atlassian login, no Jira and no database. The progress numbers come from
// the REAL computeProgress, so the report page is exercised end to end.
import express from "express";
import { computeProgress } from "../server/src/progress.ts";
import { autoFieldMap, FIELD_SOURCES, mappableFields } from "../server/src/kbkt/fields.ts";
import { parseWorkbook } from "../server/src/kbkt/parse.ts";
import { DEFAULT_SETTINGS, validateSettings } from "../server/src/kbkt/settings.ts";
import { AppError } from "../server/src/errors.ts";
import { validateFilterInput } from "../server/src/savedFilters.ts";
import { DEFAULT_SLA_SETTINGS, validateSlaSettings } from "../server/src/sla.ts";
import { KbktSync, type LogLine } from "../server/src/kbkt/sync.ts";
import { XlsxFormatError } from "../server/src/kbkt/xlsx.ts";
import { FakeJira } from "../server/test/kbktFakeJira.ts";
import { sampleWorkbook } from "../server/test/kbktFixture.ts";

// The LOCAL date, like the client's todayIso(): UTC is a day behind in Vietnam until 07:00, and a test that
// counts "before today" must not flip with the hour it happens to run.
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const TODAY = localToday();
const day = (n: number) => new Date(Date.parse(TODAY) + n * 86400000).toISOString().slice(0, 10);
// SLA clock instants (Vietnam time, the policy's default). Chosen so a state cannot depend on the hour
// the suite runs: DEMO-3 (High, 16 working hours) was opened a month ago → late; DEMO-4 (Medium, 40h)
// was resolved an hour after it was created → on time; DEMO-7 (Highest, 4h) is opened as the stand-in
// starts → well within.
const at = (n: number, hhmm: string) => `${day(n)}T${hhmm}:00.000+0700`;
const STARTED_AT = new Date().toISOString();

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
  { id: "DEMO-3", summary: "Phân tích yêu cầu", issueType: "Story", wbsParentId: "DEMO-1", assigneeAccountId: "anh", statusName: "In Progress", statusCategory: "indeterminate", startDate: day(-8), dueDate: day(-1), labels: ["urgent"], priority: "High", createdAt: at(-30, "09:00") },
  { id: "DEMO-4", summary: "Viết tài liệu BRD", issueType: "Task", wbsParentId: "DEMO-1", assigneeAccountId: "binh", statusName: "Done", statusCategory: "done", percentComplete: 100, startDate: day(-9), dueDate: day(-4), createdAt: at(-20, "09:00"), resolvedAt: at(-20, "10:00") },
  { id: "DEMO-5", summary: "Thiết kế cơ sở dữ liệu", issueType: "Task", wbsParentId: "DEMO-2", assigneeAccountId: "anh", startDate: day(2), dueDate: day(6), estimateHours: 16, components: ["Backend"], fixVersions: ["1.0"], sprint: { id: 7, name: "Sprint 7", state: "active" } },
  { id: "DEMO-6", summary: "Dựng API đăng nhập", issueType: "Task", wbsParentId: "DEMO-2", assigneeAccountId: "chi", startDate: day(3), dueDate: day(9), labels: ["backend"] },
  { id: "DEMO-7", summary: "Sửa lỗi hiển thị bảng", issueType: "Bug", wbsParentId: "DEMO-2", startDate: day(1), dueDate: day(3), priority: "Highest", createdAt: STARTED_AT },
  { id: "DEMO-8", summary: "Kiểm thử tích hợp", issueType: "Task", wbsParentId: "DEMO-2", assigneeAccountId: "binh", startDate: day(8), dueDate: day(14), labels: ["milestone"] },
  { id: "DEMO-9", summary: "Công việc chưa có ngày", issueType: "Task", assigneeAccountId: "me", startDate: null, dueDate: null },
].map((t: any) => ({ ...base, baselineStart: t.startDate, baselineDue: t.dueDate, ...t, assigneeName: nameOf(t.assigneeAccountId ?? null) }));
// Scripts share this process; one that moves dates puts the seed back afterwards.
const SEED = structuredClone(tasks);

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
  if (req.method !== "GET" && !req.path.startsWith("/api/__")) log.push({ m: req.method, p: req.path, b: req.body, q: req.query });
  next();
});

// Back to the data the server started with — the e2e files share one stand-in API.
const pristine = { tasks: structuredClone(tasks), comments: structuredClone(comments) };
app.post("/api/__restore", (_q, r) => {
  tasks = structuredClone(pristine.tasks);
  comments = structuredClone(pristine.comments);
  issueLinks = [{ id: "L1", a: "DEMO-3", b: "DEMO-5", type: "Blocks" }];
  savedFilters = savedFilters.filter((f) => f.createdBy !== "me");
  watching = false;
  profiles = [];
  absences = [];
  listDelayMs = 0;
  sessionProject = "DEMO";
  tasksSeen = [];
  attachmentsOf5 = seedFiles();
  sla = { settings: structuredClone(DEFAULT_SLA_SETTINGS), canEdit: true };
  log.length = 0;
  r.json({});
});
app.get("/api/__log", (_q, r) => r.json({ log, chatAborts }));
app.post("/api/__reset", (_q, r) => { log.length = 0; chatAborts = 0; r.json({}); });
app.post("/api/__tasks/reset", (_q, r) => { tasks = structuredClone(SEED); r.json({}); });
// A big project, for measuring how the Gantt behaves with hundreds of rows (e2e/perf-scroll.mjs).
// Epics > stories > tasks/bugs spread over about a year, a third of them chained by FS edges.
app.post("/api/__tasks/generate", (req, r) => {
  const n = Math.min(3000, Number(req.body?.n ?? 500));
  const out: any[] = structuredClone(SEED);
  const kinds = ["Task", "Task", "Bug", "Task", "Story"];
  const who = ["anh", "binh", "chi", "me", null];
  let epic: string | null = null;
  for (let i = 0; i < n; i++) {
    const id = `DEMO-${1000 + i}`;
    const isEpic = i % 60 === 0;
    const type = isEpic ? "Epic" : kinds[i % kinds.length];
    if (isEpic) epic = id;
    const start = (i * 3) % 330 - 20;
    const dur = isEpic ? 40 : 2 + (i % 9);
    const prev = out.at(-1);
    out.push({
      ...base, id, summary: `${type} số ${i} — việc thử nghiệm với tên khá dài để bảng rộng ra`, issueType: type,
      wbsParentId: isEpic ? null : epic, startDate: day(start), dueDate: day(start + dur - 1), baselineStart: day(start), baselineDue: day(start + dur - 1),
      durationDays: dur, assigneeAccountId: isEpic ? null : who[i % who.length], assigneeName: isEpic ? null : nameOf(who[i % who.length]),
      statusName: i % 3 === 0 ? "Done" : "To Do", statusCategory: i % 3 === 0 ? "done" : "new",
      predecessors: !isEpic && i % 3 === 1 && prev && prev.issueType !== "Epic" ? [{ taskId: prev.id, type: "FS", lagDays: 0 }] : [],
    });
  }
  tasks = out;
  r.json({ count: out.length });
});

// Two projects, and the session's own "current project" the way the real cookie holds it — shared
// by every tab. A request that names its project (X-Project-Key) is served that one instead.
const PROJECTS = [
  { id: "1", key: "DEMO", name: "Dự án mẫu", avatarUrl: null },
  { id: "2", key: "OTHER", name: "Dự án khác", avatarUrl: null },
];
let sessionProject = "DEMO";
const projectOf = (req: express.Request) => {
  const asked = String(req.get("x-project-key") ?? "");
  return PROJECTS.find((p) => p.key === asked) ?? PROJECTS.find((p) => p.key === sessionProject)!;
};
let tasksSeen: Array<{ project: string | null }> = [];
app.get("/api/auth/me", (req, r) => {
  const p = projectOf(req);
  r.json({
    user: users[0], site: { cloudId: "c1", url: "https://example.atlassian.net", name: "Example" },
    project: { key: p.key, name: p.name }, startDateFieldId: null, overlayEphemeral: false, staff: true,
  });
});
app.get("/api/auth/projects", (_q, r) => r.json(PROJECTS));
app.post("/api/auth/project", (req, r) => {
  const p = PROJECTS.find((x) => x.key === req.body?.key);
  if (!p) return r.status(400).json({ error: "Không có quyền", code: "BAD_REQUEST" });
  sessionProject = p.key;
  r.json({ key: p.key, name: p.name });
});
app.get("/api/__tasks-seen", (_q, r) => r.json({ seen: tasksSeen, sessionProject }));

// Like the real server: the list carries no description (the edit modal asks for it), and
// the list can be made slow to prove that a saved copy shows first.
let listDelayMs = 0;
app.post("/api/__delay", (req, r) => { listDelayMs = Number(req.body?.ms ?? 0); r.json({}); });
const otherProjectTasks = () => [{ ...base, id: "OTHER-1", summary: "Việc của dự án khác", issueType: "Task", startDate: day(0), dueDate: day(2), durationDays: 3 }];
app.post("/api/sync", (req, r) => {
  tasksSeen.push({ project: req.get("x-project-key") ?? null });
  const list = projectOf(req).key === "OTHER" ? otherProjectTasks() : tasks.map(({ description: _d, ...rest }) => rest);
  r.json({ syncedAt: new Date().toISOString(), count: list.length, tasks: list });
});
app.get("/api/tasks", (req, r) => {
  tasksSeen.push({ project: req.get("x-project-key") ?? null });
  if (projectOf(req).key === "OTHER") return r.json(otherProjectTasks());
  const body = tasks.map(({ description: _d, ...rest }) => rest);
  if (listDelayMs > 0) setTimeout(() => r.json(body), listDelayMs);
  else r.json(body);
});
app.get("/api/tasks/:id/description", (req, res) => {
  const t = tasks.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "Không tìm thấy" });
  res.json({ description: t.description ?? null });
});
app.get("/api/users", (_q, r) => r.json(users));
app.get("/api/priorities", (_q, r) => r.json(["Highest", "High", "Medium", "Low", "Lowest"]));
app.get("/api/labels", (_q, r) => r.json(["urgent", "backend", "frontend", "docs"]));
app.get("/api/issue-types", (_q, r) => r.json([
  { name: "Epic", subtask: false }, { name: "Story", subtask: false }, { name: "Task", subtask: false },
  { name: "Bug", subtask: false }, { name: "Công việc con", subtask: true },
]));
// Like a real workflow: Done has a screen that asks for RootCause; Rejected has none, but a
// validator refuses the move until a reason is on the issue (learned only from the refusal).
const ROOT_CAUSE = { id: "customfield_9", name: "RootCause", kind: "text" };
const REJECT_REASON = { id: "customfield_8", name: "Lý do từ chối", kind: "text" };
app.get("/api/tasks/:id/transitions", (_q, r) => r.json([
  { id: "11", name: "Start", toStatusName: "In Progress", toCategory: "indeterminate", fields: [] },
  { id: "31", name: "Done", toStatusName: "Done", toCategory: "done", fields: [ROOT_CAUSE] },
  { id: "41", name: "Reject", toStatusName: "Rejected", toCategory: "done", fields: [] },
]));
// DEMO-5 carries a picture and a PDF, so the detail window's preview, download and delete have something to act on.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAUAAAADICAIAAAAWZq/8AAACYUlEQVR4nO3TQQ0AIBDAMMygDPlnAg98yJImFbDP1j4DRK3vBcAzA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGKbrAulcYzcBCI6PAAAAAElFTkSuQmCC", "base64");
const seedFiles = () => [
  { id: "501", filename: "man-hinh-dang-nhap.png", size: PNG.length, mimeType: "image/png", created: "2026-10-20T08:00:00.000+0700", author: "Nguyễn Anh" },
  { id: "502", filename: "dac-ta.pdf", size: 2048, mimeType: "application/pdf", created: "2026-10-21T08:00:00.000+0700", author: "Nguyễn Anh" },
];
let attachmentsOf5 = seedFiles();
app.get("/api/tasks/:id/attachments", (req, r) => r.json({ files: req.params.id === "DEMO-5" ? attachmentsOf5 : [], links: [] }));
app.get("/api/tasks/:id/attachments/:attId/content", (req, r) => {
  const f = req.params.id === "DEMO-5" ? attachmentsOf5.find((x) => x.id === req.params.attId) : undefined;
  if (!f) return r.status(404).json({ error: "Không tìm thấy tệp đính kèm trên công việc này." });
  r.setHeader("Content-Type", req.query.inline === "1" && f.mimeType === "image/png" ? "image/png" : "application/octet-stream");
  r.send(f.mimeType === "image/png" ? PNG : Buffer.from("%PDF-1.4 stand-in"));
});
app.delete("/api/tasks/:id/attachments/:attId", (req, r) => {
  const before = attachmentsOf5.length;
  attachmentsOf5 = attachmentsOf5.filter((x) => x.id !== req.params.attId);
  if (attachmentsOf5.length === before) return r.status(404).json({ error: "Không tìm thấy tệp đính kèm trên công việc này." });
  r.status(204).end();
});

app.patch("/api/tasks/:id", (req, res) => {
  const t = tasks.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "Không tìm thấy" });
  const b = req.body;
  if (b.assigneeAccountId !== undefined) {
    if (b.assigneeAccountId && t.issueType === "Epic") return res.status(400).json({ error: `${t.id} là Epic nên không gán người phụ trách được.` });
    t.assigneeAccountId = b.assigneeAccountId; t.assigneeName = nameOf(b.assigneeAccountId);
  }
  if (b.statusTransition) {
    const map: any = { "In Progress": "indeterminate", Done: "done", "To Do": "new", Rejected: "done" };
    if (!map[b.statusTransition] && !["11", "31", "41"].includes(b.statusTransition)) return res.status(400).json({ error: `Không chuyển được sang "${b.statusTransition}".` });
    const name = b.statusTransition === "11" ? "In Progress" : b.statusTransition === "31" ? "Done" : b.statusTransition === "41" ? "Rejected" : b.statusTransition;
    const given = (b.transitionFields ?? {}) as Record<string, string>;
    if (name === "Done" && !(given[ROOT_CAUSE.id] ?? "").trim()) {
      return res.status(400).json({
        error: `Chuyển ${t.id} sang "Done" cần nhập: RootCause.`,
        code: "TRANSITION_FIELDS_REQUIRED",
        details: { toStatusName: "Done", fields: [ROOT_CAUSE] },
      });
    }
    if (name === "Rejected" && !(given[REJECT_REASON.id] ?? "").trim()) {
      return res.status(400).json({
        error: "Vui lòng nhập Lý do từ chối",
        code: "TRANSITION_FIELDS_REQUIRED",
        details: { toStatusName: "Rejected", fields: [REJECT_REASON], reason: "Vui lòng nhập Lý do từ chối" },
      });
    }
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
  for (const k of ["summary", "description", "startDate", "priority", "labels", "components", "fixVersions", "percentComplete", "estimateHours", "durationDays", "baselineStart", "baselineDue", "predecessors"]) if (b[k] !== undefined) t[k] = b[k];
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
    const t = { ...base, baselineStart: b.startDate ?? null, baselineDue: null, id: `DEMO-${10 + tasks.length}`, summary: s, issueType: b.issueType, wbsParentId: b.wbsParentId ?? null, assigneeAccountId: b.assigneeAccountId ?? null, assigneeName: nameOf(b.assigneeAccountId ?? null), startDate: b.startDate ?? null, dueDate: null, priority: b.priority ?? base.priority, labels: b.labels ?? [], estimateHours: b.estimateHours ?? null };
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

// --- phase 2 / stage 3: a resource pool that remembers (skills, edited leave) --------------------
let profiles: any[] = [];
let absences: any[] = [];
app.get("/api/resources", (_q, r) => r.json({
  users, memberSource: "project-roles", memberFallback: null, memberSkippedGroups: 0, memberRoles: ["Developers"],
  memberTruncated: false, profiles, absences, defaultCapacityHours: 8,
}));
app.put("/api/resources/:accountId", (req, res) => {
  const b = req.body ?? {};
  const cur = profiles.find((p) => p.accountId === req.params.accountId) ?? { accountId: req.params.accountId, role: null, skills: [], capacityHoursPerDay: 8, costPerDay: null, notes: null };
  if (typeof b.role === "string") cur.role = b.role.trim() || null;
  if (Array.isArray(b.skills)) cur.skills = b.skills;
  if (typeof b.notes === "string") cur.notes = b.notes.trim() || null;
  if (b.capacityHoursPerDay != null) cur.capacityHoursPerDay = Number(b.capacityHoursPerDay);
  profiles = [...profiles.filter((p) => p.accountId !== cur.accountId), cur];
  res.json(cur);
});
app.post("/api/resources/:accountId/absences", (req, res) => {
  const a = { id: `ab${absences.length + 1}`, accountId: req.params.accountId, from: req.body.from, to: req.body.to, reason: req.body.reason ?? null };
  absences = [...absences, a];
  res.status(201).json(a);
});
app.delete("/api/resources/absences/:id", (req, res) => { absences = absences.filter((a) => a.id !== req.params.id); res.status(204).end(); });
app.patch("/api/resources/absences/:id", (req, res) => {
  const a = absences.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: "Không tìm thấy kỳ nghỉ này." });
  const b = req.body ?? {};
  if ((b.to ?? a.to) < (b.from ?? a.from)) return res.status(400).json({ error: "Ngày kết thúc phải sau hoặc bằng ngày bắt đầu." });
  Object.assign(a, { from: b.from ?? a.from, to: b.to ?? a.to, reason: b.reason === undefined ? a.reason : b.reason });
  res.json(a);
});

app.get("/api/progress", (req, res) => {
  const q = req.query as Record<string, string>;
  const scope = { assignee: q.assignee || undefined, epic: q.epic || undefined, types: q.type ? q.type.split(",") : [] };
  const snap = (n: number, actual: number, planned: number) => ({ date: day(n), actualPct: actual, plannedPct: planned, spi: 0.9, health: "at_risk", total: 10, done: 3, inProgress: 2, overdue: 1 });
  res.json({ metrics: computeProgress(tasks, q.asOf || TODAY, scope), latest: null, history: [], trend: [snap(-14, 10, 20), snap(-7, 22, 30), snap(0, 30, 41)] });
});
app.get("/api/progress/flow", (req, res) => {
  const days = Number(req.query.days) || 60;
  const dates = Array.from({ length: 10 }, (_, i) => day(-9 + i));
  res.json({
    from: dates[0], to: dates[9], days, issueCount: 12, truncated: false,
    cfd: { dates, series: [
      { statusId: "1", name: "To Do", category: "new", counts: dates.map((_, i) => 8 - Math.floor(i / 3)) },
      { statusId: "2", name: "In Progress", category: "indeterminate", counts: dates.map((_, i) => 2 + Math.floor(i / 4)) },
      { statusId: "3", name: "Done", category: "done", counts: dates.map((_, i) => Math.floor(i / 2)) },
    ] },
    created: { bucket: days <= 30 ? "day" : "week", buckets: [{ start: day(-14), created: 5, resolved: 2 }, { start: day(-7), created: 3, resolved: 4 }, { start: day(0), created: 1, resolved: 1 }] },
    control: {
      points: [{ key: "DEMO-3", date: day(-5), leadDays: 8, cycleDays: 4 }, { key: "DEMO-4", date: day(-2), leadDays: 6, cycleDays: null }, { key: "DEMO-5", date: day(-1), leadDays: 12, cycleDays: 9 }],
      lead: { count: 3, mean: 8.7, p50: 8, p85: 12, p95: 12 }, cycle: { count: 2, mean: 6.5, p50: 4, p85: 9, p95: 9 },
      leadRolling: [8, 7, 8.7], cycleRolling: [4, null, 6.5],
    },
  });
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
app.put("/api/timesheet/worklogs/:k/:id", (req, res) => {
  const b = req.body ?? {};
  res.json({ id: req.params.id, issueKey: req.params.k, summary: "Phân tích yêu cầu", issueType: "Story", authorAccountId: "me", authorName: "Tuấn Test", date: b.date ?? TODAY, hours: b.hours ?? 4, comment: b.comment === undefined ? "họp" : b.comment, mine: true });
});

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

// --- board: a Scrum board with one active sprint ---------------------------
const boardIssues = () => tasks.filter((t) => t.issueType !== "Epic").map((t, i) => ({
  key: t.id, summary: t.summary, issueType: t.issueType, subtask: false,
  statusId: t.statusCategory === "done" ? "3" : t.statusCategory === "indeterminate" ? "2" : "1",
  statusName: t.statusName, statusCategory: t.statusCategory, assigneeAccountId: t.assigneeAccountId, assigneeName: t.assigneeName,
  priority: t.priority, estimate: 3, sprintId: i < 6 ? 7 : null, epicKey: t.wbsParentId?.startsWith("DEMO-") && ["DEMO-1", "DEMO-2"].includes(t.wbsParentId) ? t.wbsParentId : null,
  epicSummary: t.wbsParentId === "DEMO-1" ? "Giai đoạn 1" : t.wbsParentId === "DEMO-2" ? "Giai đoạn 2" : null,
  parentKey: t.wbsParentId, flagged: false, labels: t.labels, fixVersions: i % 3 === 0 ? ["1.0"] : [], dueDate: t.dueDate, resolutionDate: null, updated: null, blockedBy: [],
}));
// Two sub-tasks under the first work item, one finished — the parent card lists them (stage 3.3).
const subtaskIssues = () => {
  const parent = tasks.find((t) => t.issueType !== "Epic");
  if (!parent) return [];
  const sub = (key: string, done: boolean) => ({
    key, summary: `Việc con ${key}`, issueType: "Sub-task", subtask: true, statusId: done ? "3" : "1", statusName: done ? "Done" : "To Do",
    statusCategory: done ? "done" : "new", assigneeAccountId: null, assigneeName: null, priority: null, estimate: null, sprintId: 7,
    epicKey: null, epicSummary: null, parentKey: parent.id, flagged: false, labels: [], fixVersions: [], dueDate: null, resolutionDate: null, updated: null, blockedBy: [],
  });
  return [sub("DEMO-901", true), sub("DEMO-902", false)];
};
// Two boards, as a project often has: the Scrum one (default) and a Kanban one whose first and
// last-but-one columns are empty (board-kanban.e2e.mjs folds them, switches to it from the Backlog).
const BOARDS = [{ id: 1, name: "Bảng DEMO", type: "scrum" }, { id: 2, name: "Bảng Kanban DEMO", type: "kanban" }];
const STATUSES = [{ id: "0", name: "Backlog", category: "new" }, { id: "1", name: "To Do", category: "new" }, { id: "2", name: "In Progress", category: "indeterminate" }, { id: "3", name: "Done", category: "done" }];
app.get("/api/board", (q, r) => {
  const kanban = Number(q.query.boardId) === 2;
  const col = (name: string, ids: string[]) => ({ name, statusIds: ids, min: null, max: null });
  r.json({
    mode: "agile", fallback: null, boards: BOARDS, board: kanban ? BOARDS[1] : BOARDS[0],
    columns: kanban
      ? [col("Backlog", ["0"]), col("To Do", ["1"]), col("In Progress", ["2"]), col("Selected for development", ["4"]), col("Done", ["3"])]
      : [col("To Do", ["1"]), col("In Progress", ["2"]), col("Done", ["3"])],
    statuses: kanban ? [...STATUSES, { id: "4", name: "Selected for development", category: "new" }] : STATUSES.slice(1),
    estimation: { fieldId: "customfield_1", name: "Story Points", unit: "points" },
    sprints: kanban ? [] : [{ id: 7, name: "Sprint 7", state: "active", goal: "Chốt phần khảo sát", startDate: day(-5), endDate: day(9), completeDate: null },
      { id: 8, name: "Sprint 8", state: "future", goal: null, startDate: null, endDate: null, completeDate: null }],
    quickFilters: kanban ? [] : [{ id: 11, name: "Việc của tôi", description: "assignee = currentUser()" }, { id: 12, name: "Chỉ lỗi", description: null }],
    versions: [{ id: "1", name: "1.0", released: false, releaseDate: day(10) }, { id: "2", name: "2.0", released: false, releaseDate: null }],
    velocity: kanban ? [] : [
      { sprintId: 4, name: "Sprint 4", startDate: day(-40), completeDate: day(-27), completed: 18, completedCount: 6 },
      { sprintId: 5, name: "Sprint 5", startDate: day(-26), completeDate: day(-13), completed: 24, completedCount: 8 },
      { sprintId: 6, name: "Sprint 6", startDate: day(-12), completeDate: day(-6), completed: 21, completedCount: 7 },
    ],
    throughput: [], issues: [...boardIssues(), ...subtaskIssues()].map((i) => (kanban ? { ...i, sprintId: null } : i)), truncated: false,
  });
});
app.get("/api/board/quickfilters/keys", (req, res) => {
  const ids = String(req.query.ids ?? "").split(",");
  const keys = tasks.filter((t) => (ids.includes("11") ? t.assigneeAccountId === "me" : true) && (ids.includes("12") ? t.issueType === "Bug" : true)).map((t) => t.id);
  res.json({ keys });
});
app.put("/api/board/issues/:key/flag", (_q, r) => r.status(204).end());
app.delete("/api/board/sprints/:id", (_q, r) => r.json({ moved: 2 }));
app.get("/api/board/sprints/:id/capacity", (_q, r) => r.json({
  window: { start: day(-5), end: day(9), lengthDays: 15 },
  team: users.map((u, i) => ({ accountId: u.accountId, name: u.displayName, days: i === 3 ? 0 : 10, hoursPerDay: 8, capacityHours: i === 3 ? 0 : 80 })),
}));
app.get("/api/board/sprints/:id/report", (_q, r) => r.json({
  sprint: { id: 7, name: "Sprint 7", state: "active", goal: null, startDate: day(-5), endDate: day(9), completeDate: null },
  start: day(-5), end: day(9),
  committed: [{ key: "DEMO-3", summary: "Phân tích yêu cầu", issueType: "Story", statusName: "Done", statusCategory: "done", weight: 5, origin: "committed" }],
  added: [{ key: "DEMO-5", summary: "Thiết kế", issueType: "Task", statusName: "To Do", statusCategory: "new", weight: 3, origin: "added" }],
  completed: [{ key: "DEMO-3", summary: "Phân tích yêu cầu", issueType: "Story", statusName: "Done", statusCategory: "done", weight: 5, origin: "committed" }],
  notCompleted: [{ key: "DEMO-5", summary: "Thiết kế", issueType: "Task", statusName: "To Do", statusCategory: "new", weight: 3, origin: "added" }],
  churned: [], totals: { committed: 5, added: 3, completed: 5, notCompleted: 3 },
  burnup: Array.from({ length: 6 }, (_, i) => ({ date: day(-5 + i), scope: i < 3 ? 5 : 8, completed: i < 2 ? 0 : 5 })),
}));
app.post("/api/board/sprints/:id/issues", (_q, r) => r.status(204).end());
app.post("/api/board/issues/:key/move", (_q, r) => r.json({ statusId: null }));
app.get("/api/board/issues/:key/transitions", (_q, r) => r.json([]));

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

// KBKT import: the REAL parser and sync engine against an in-memory Jira, so the
// dialog is driven end to end — upload, preview, streamed apply, re-sync.
// DEMO-50 is a Story that already exists, for "Story có sẵn".
const newKbktJira = () => {
  const jira = new FakeJira("DEMO");
  jira.issues.set("DEMO-50", {
    key: "DEMO-50",
    fields: { summary: "UC đăng nhập hệ thống", issuetype: { name: "Story", hierarchyLevel: 0 }, status: { name: "In Progress" }, labels: [], parent: { key: "DEMO-1" }, issuelinks: [], attachment: [] },
  });
  return jira;
};
let kbktJira = newKbktJira();
let kbktSettings = structuredClone(DEFAULT_SETTINGS);
app.post("/api/__kbkt/reset", (_q, r) => { kbktJira = newKbktJira(); kbktSettings = structuredClone(DEFAULT_SETTINGS); r.json({}); });
app.get("/api/__kbkt/issues", (_q, r) => r.json([...kbktJira.issues.values()].map((i) => ({ key: i.key, summary: i.fields.summary, parent: i.fields.parent?.key ?? null, labels: i.fields.labels, custom: Object.keys(i.fields).filter((k) => k.startsWith("customfield_") && i.fields[k] != null) }))));
// Story-level issues by key or title words, like the real route (minus JQL).
app.get("/api/kbkt/stories", (req, res) => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const key = /^(?:demo-)?(\d+)$/.exec(q);
  res.json([...kbktJira.issues.values()]
    .filter((i) => i.fields.issuetype?.name === "Story")
    .filter((i) => (key ? i.key === `DEMO-${key[1]}` : !q || String(i.fields.summary).toLowerCase().includes(q)))
    .map((i) => ({ key: i.key, summary: i.fields.summary, type: i.fields.issuetype.name, status: i.fields.status?.name ?? "" })));
});
app.get("/api/__kbkt/sample", (_q, r) => r.type("application/octet-stream").send(Buffer.from(sampleWorkbook())));
app.get("/api/kbkt/options", async (_q, r) => r.json({
  // The real field rules over the fake's create screens (Sub Testcase = 3, Sub-Bug = 4).
  fieldSources: {
    test: FIELD_SOURCES.test.map(({ key, label }) => ({ key, label })),
    bug: FIELD_SOURCES.bug.map(({ key, label }) => ({ key, label })),
  },
  fields: {
    "Sub Testcase": mappableFields((await kbktJira.getCreateMetaFields("DEMO", "3")) as any),
    "Sub-Bug": mappableFields((await kbktJira.getCreateMetaFields("DEMO", "4")) as any),
  },
  autoFieldMaps: {
    "Sub Testcase": { test: autoFieldMap("test", (await kbktJira.getCreateMetaFields("DEMO", "3")) as any), bug: {} },
    "Sub-Bug": { test: {}, bug: autoFieldMap("bug", (await kbktJira.getCreateMetaFields("DEMO", "4")) as any) },
  },
  issueTypes: [{ name: "Epic", subtask: false }, { name: "Story", subtask: false }, { name: "Sub Testcase", subtask: true }, { name: "Sub-Bug", subtask: true }],
  statuses: { "Sub Testcase": ["Not run", "Passed", "Failed", "Pending"], "Sub-Bug": ["To Do", "In Progress", "Done"] },
  priorities: ["Highest", "High", "Medium", "Low", "Lowest"],
  linkTypes: ["Blocks", "Relates"],
  epics: [{ key: "DEMO-1", summary: "Đợt 1" }],
}));
app.get("/api/kbkt/settings", (_q, r) => r.json(kbktSettings));

// The SLA policy, through the real validator. The stand-in user is a project admin (canEdit).
let sla = { settings: structuredClone(DEFAULT_SLA_SETTINGS), canEdit: true };
app.get("/api/sla/settings", (_q, r) => r.json(sla));
app.put("/api/sla/settings", (req, res) => {
  try {
    sla = { settings: validateSlaSettings(req.body), canEdit: true };
    res.json(sla);
  } catch (e) {
    res.status(e instanceof AppError ? e.status : 500).json({ error: (e as Error).message, code: e instanceof AppError ? e.code : undefined });
  }
});
app.put("/api/kbkt/settings", (req, res) => { kbktSettings = validateSettings(req.body); res.json(kbktSettings); });
const kbktRun = (req: express.Request) => {
  const q = req.query as Record<string, string | undefined>;
  return {
    fileName: decodeURIComponent(String(req.get("x-file-name") ?? "x.xlsx")),
    wb: parseWorkbook(req.body),
    options: {
      epicRef: q.epic ?? null,
      storyKey: q.story === undefined ? undefined : q.story === "new" ? null : q.story,
      dueDate: q.dueDate ?? null,
      force: q.force === "1",
    },
  };
};
const kbktRaw = express.raw({ type: () => true, limit: "20mb" });
app.post("/api/kbkt/preview", kbktRaw, async (req, res) => {
  try {
    const { fileName, wb, options } = kbktRun(req);
    const lines: LogLine[] = [];
    const result = await new KbktSync(kbktJira as any, "DEMO", kbktSettings, (l) => lines.push(l)).run(wb, fileName, { ...options, apply: false });
    res.json({ fileName, version: Number(/_v(\d+)\.xlsx$/i.exec(fileName)?.[1] ?? 0), cases: wb.cases.length, bugs: wb.bugs.size, ...result, log: lines });
  } catch (e) {
    res.status(e instanceof XlsxFormatError ? 400 : 500).json({ error: (e as Error).message });
  }
});
app.post("/api/kbkt/apply", kbktRaw, async (req, res) => {
  let run: ReturnType<typeof kbktRun>;
  try {
    run = kbktRun(req);
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.flushHeaders();
  const send = (e: string, d: unknown) => res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
  const result = await new KbktSync(kbktJira as any, "DEMO", kbktSettings, (l) => send("log", l)).run(run.wb, run.fileName, { ...run.options, apply: true });
  send("done", { fileName: run.fileName, ...result });
  res.end();
});

// Saved filters: the REAL validator, an in-memory table, and the signed-in user
// is always "me". One filter shared by someone else, to show the shared section.
let filterSeq = 0;
const newFilter = (createdBy: string, input: any) => ({
  id: `00000000-0000-4000-8000-${String(++filterSeq).padStart(12, "0")}`,
  createdBy, name: input.name, shared: input.shared, spec: input.spec, updatedAt: new Date().toISOString(),
});
let savedFilters: any[] = [
  newFilter("anh", validateFilterInput({ name: "Việc gấp của nhóm", shared: true, spec: { labels: ["urgent"] } }, false)),
];
const viewOf = (f: any) => ({ ...f, mine: f.createdBy === "me", ownerName: nameOf(f.createdBy) });
const filterError = (res: express.Response, e: unknown) =>
  res.status(e instanceof AppError ? e.status : 500).json({ error: (e as Error).message });
app.get("/api/filters", (_q, r) => r.json(savedFilters.filter((f) => f.createdBy === "me" || f.shared).map(viewOf)));
app.post("/api/filters", (req, res) => {
  try {
    const f = newFilter("me", validateFilterInput(req.body, false));
    savedFilters.push(f);
    res.status(201).json(viewOf(f));
  } catch (e) { filterError(res, e); }
});
app.patch("/api/filters/:id", (req, res) => {
  try {
    const f = savedFilters.find((x) => x.id === req.params.id && x.createdBy === "me");
    if (!f) return res.status(404).json({ error: "Không tìm thấy bộ lọc, hoặc bạn không phải người tạo bộ lọc này." });
    Object.assign(f, validateFilterInput(req.body, true), { updatedAt: new Date().toISOString() });
    res.json(viewOf(f));
  } catch (e) { filterError(res, e); }
});
app.delete("/api/filters/:id", (req, res) => {
  const before = savedFilters.length;
  savedFilters = savedFilters.filter((x) => !(x.id === req.params.id && x.createdBy === "me"));
  if (savedFilters.length === before) return res.status(404).json({ error: "Không tìm thấy bộ lọc." });
  res.status(204).end();
});

const port = Number(process.env.MOCK_PORT ?? 4000);
app.listen(port, () => console.log(`MOCK API on :${port}`));
