import { Type, type FunctionDeclaration } from "@google/genai";
import { nextSprintName } from "../agile/boardService.js";
import type { Sprint } from "../agile/boardTypes.js";
import type { DependencyType, Predecessor, Task, TaskUpdateInput } from "../types.js";
import type { ToolContext, ToolOutcome } from "./tools.js";
import { addDays, findTaskIn, fold, ISO_DATE, str } from "./toolUtils.js";

/**
 * The assistant's editing tools — everything a person can do to a task in the
 * Gantt, the edit modal or the board, available as a sentence:
 * "dời GPM-12 lùi 3 ngày", "GPM-5 xong rồi", "nối GPM-3 với GPM-7",
 * "cho GPM-20 vào sprint 8", "chốt baseline".
 *
 * Every write goes through the same service methods the UI uses, so it gets the
 * same rules for free: updateTask runs the dependency cascade and the Epic check,
 * BoardService scopes sprint moves to the project. What this layer adds is what
 * only a chat needs — turning loose words into exact arguments (a status name the
 * workflow calls something else, a sprint named by number), refusing what would
 * corrupt the plan (a dependency cycle), and asking before the one irreversible
 * action (delete).
 *
 * Read tools (get_task, search_tasks) exist because the system prompt's snapshot
 * is capped and one line per task — descriptions, successors, baselines and
 * allowed statuses are only in here.
 */

const DEP_TYPES: DependencyType[] = ["FS", "SS", "FF", "SF"];

/* -------------------------------------------------------------------------- */
/* Declarations                                                               */
/* -------------------------------------------------------------------------- */

const GET_TASK: FunctionDeclaration = {
  name: "get_task",
  description:
    "Everything about one task: description, dates, duration, % done, baseline, parent and children, " +
    "predecessors and successors (with FS/SS/FF/SF and lag), and the statuses its workflow can move to " +
    "right now. Read-only. Call it before editing when you need more than the snapshot line.",
  parameters: {
    type: Type.OBJECT,
    properties: { taskId: { type: Type.STRING, description: "Issue key, e.g. GPM-12." } },
    required: ["taskId"],
  },
};

const SEARCH_TASKS: FunctionDeclaration = {
  name: "search_tasks",
  description:
    "Find tasks by words in the title and/or filters. Read-only. Use it to resolve 'task đăng nhập', " +
    "'các bug của Lan', 'việc quá hạn trong Epic GPM-2' into issue keys before acting on them.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "Words to match in the summary (diacritics optional)." },
      assignee: { type: Type.STRING, description: "Person's name, or 'none' for unassigned." },
      status: { type: Type.STRING, description: "Status name, or one of: todo, in_progress, done, open." },
      issueType: { type: Type.STRING },
      parentKey: { type: Type.STRING, description: "Only children (at any depth) of this issue." },
      overdue: { type: Type.BOOLEAN },
      limit: { type: Type.NUMBER, description: "Default 20, max 60." },
    },
  },
};

const UPDATE_TASK: FunctionDeclaration = {
  name: "update_task",
  description:
    "Change one task in Jira: title, description, status, schedule or % complete. Schedule changes run " +
    "the dependency cascade, so successors move too — report which ones. Give only the fields to change. " +
    "For several tasks, call it once per task (calls can run in parallel).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      taskId: { type: Type.STRING },
      summary: { type: Type.STRING },
      description: { type: Type.STRING },
      status: {
        type: Type.STRING,
        description:
          "Target status as the user said it ('Done', 'đang làm', 'xong', 'In Review'). Matched against the " +
          "workflow's allowed transitions; if none fits, the allowed ones come back.",
      },
      startDate: { type: Type.STRING, description: "YYYY-MM-DD." },
      dueDate: { type: Type.STRING, description: "YYYY-MM-DD. With startDate (or the current start) sets the duration." },
      durationDays: { type: Type.NUMBER, description: "Inclusive working length in days." },
      shiftDays: {
        type: Type.NUMBER,
        description: "Move the whole task by N calendar days (negative = earlier), keeping its duration.",
      },
      percentComplete: { type: Type.NUMBER, description: "0–100." },
    },
    required: ["taskId"],
  },
};

const ADD_DEPENDENCY: FunctionDeclaration = {
  name: "add_dependency",
  description:
    "Link two tasks: the successor depends on the predecessor ('A xong mới làm B' → predecessor A, " +
    "successor B, FS). Types: FS finish→start (default), SS start→start, FF finish→finish, SF start→finish. " +
    "lagDays delays (or with a negative value overlaps) the successor. Replaces an existing link between the " +
    "same pair. Refused if it would create a cycle. Runs the cascade, so the successor may move.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      predecessorId: { type: Type.STRING },
      successorId: { type: Type.STRING },
      type: { type: Type.STRING, enum: DEP_TYPES, format: "enum" },
      lagDays: { type: Type.NUMBER },
    },
    required: ["predecessorId", "successorId"],
  },
};

const REMOVE_DEPENDENCY: FunctionDeclaration = {
  name: "remove_dependency",
  description: "Remove the link between two tasks (in either direction if the user didn't say which).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      predecessorId: { type: Type.STRING },
      successorId: { type: Type.STRING },
    },
    required: ["predecessorId", "successorId"],
  },
};

const SET_BASELINE: FunctionDeclaration = {
  name: "set_baseline",
  description:
    "Save the current dates as the baseline (the committed plan progress is measured against), for the " +
    "given tasks or, with no taskIds, every scheduled task. clear=true removes the baseline instead. " +
    "Changes what 'trễ so với kế hoạch' means, so only when the user asks to set/lock/reset the baseline.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      taskIds: { type: Type.ARRAY, items: { type: Type.STRING } },
      clear: { type: Type.BOOLEAN },
    },
  },
};

const DELETE_TASK: FunctionDeclaration = {
  name: "delete_task",
  description:
    "Delete a task from Jira (with its sub-tasks). Irreversible. First call WITHOUT confirmed to get what " +
    "will be deleted, tell the user and ask; call again with confirmed=true ONLY after the user explicitly " +
    "agreed in this conversation.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      taskId: { type: Type.STRING },
      confirmed: { type: Type.BOOLEAN },
    },
    required: ["taskId"],
  },
};

const MOVE_TO_SPRINT: FunctionDeclaration = {
  name: "move_to_sprint",
  description:
    "Put tasks into a sprint of the Scrum board, or back to the backlog. sprint = the sprint's name or number " +
    "('Sprint 8', '8'), 'active' for the running one, 'next' for the first future one, or 'backlog'.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      taskIds: { type: Type.ARRAY, items: { type: Type.STRING } },
      sprint: { type: Type.STRING },
    },
    required: ["taskIds", "sprint"],
  },
};

const SET_ESTIMATE: FunctionDeclaration = {
  name: "set_estimate",
  description:
    "Set a task's estimate in the board's estimation field (story points, or hours on a time-based board). " +
    "value null clears it.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      taskId: { type: Type.STRING },
      value: { type: Type.NUMBER },
    },
    required: ["taskId"],
  },
};

const SPRINT_ACTION: FunctionDeclaration = {
  name: "sprint_action",
  description:
    "Manage a sprint on the Scrum board. action: create (new future sprint), start (a future sprint; " +
    "startDate defaults to today, weeks defaults to 2), complete (the active sprint; open work goes to " +
    "moveTo = a sprint name/number, 'new' or 'backlog' — ask the user first and pass confirmed=true), " +
    "update (rename or change the goal).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: { type: Type.STRING, enum: ["create", "start", "complete", "update"], format: "enum" },
      sprint: { type: Type.STRING, description: "Name or number; defaults to 'next' for start, 'active' for complete." },
      name: { type: Type.STRING },
      goal: { type: Type.STRING },
      startDate: { type: Type.STRING, description: "YYYY-MM-DD." },
      weeks: { type: Type.NUMBER },
      moveTo: { type: Type.STRING },
      confirmed: { type: Type.BOOLEAN },
    },
    required: ["action"],
  },
};

export const EDIT_TOOLS: FunctionDeclaration[] = [
  GET_TASK,
  SEARCH_TASKS,
  UPDATE_TASK,
  ADD_DEPENDENCY,
  REMOVE_DEPENDENCY,
  SET_BASELINE,
  DELETE_TASK,
  MOVE_TO_SPRINT,
  SET_ESTIMATE,
  SPRINT_ACTION,
];

const LABELS: Record<string, string> = {
  get_task: "Đang xem chi tiết công việc...",
  search_tasks: "Đang tìm công việc...",
  update_task: "Đang cập nhật công việc trên Jira...",
  add_dependency: "Đang nối phụ thuộc...",
  remove_dependency: "Đang gỡ phụ thuộc...",
  set_baseline: "Đang lưu baseline...",
  delete_task: "Đang xử lý yêu cầu xoá...",
  move_to_sprint: "Đang chuyển việc giữa sprint...",
  set_estimate: "Đang lưu ước lượng...",
  sprint_action: "Đang thao tác sprint...",
};

export function editLabelFor(name: string): string | null {
  return LABELS[name] ?? null;
}

export async function runEditTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolOutcome | null> {
  switch (name) {
    case "get_task":
      return runGetTask(args, ctx);
    case "search_tasks":
      return runSearchTasks(args, ctx);
    case "update_task":
      return runUpdateTask(args, ctx);
    case "add_dependency":
      return runAddDependency(args, ctx);
    case "remove_dependency":
      return runRemoveDependency(args, ctx);
    case "set_baseline":
      return runSetBaseline(args, ctx);
    case "delete_task":
      return runDeleteTask(args, ctx);
    case "move_to_sprint":
      return runMoveToSprint(args, ctx);
    case "set_estimate":
      return runSetEstimate(args, ctx);
    case "sprint_action":
      return runSprintAction(args, ctx);
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Shared                                                                     */
/* -------------------------------------------------------------------------- */

const notFound = (id: string): ToolOutcome => ({ response: { error: `Không tìm thấy công việc ${id} trong dự án này.` } });

function brief(t: Task) {
  return {
    id: t.id,
    summary: t.summary,
    type: t.issueType,
    status: t.statusName,
    assignee: t.assigneeName,
    start: t.startDate,
    due: t.dueDate,
    percent: t.percentComplete,
  };
}

/**
 * Apply an update and fold its whole effect — the task and every successor the
 * cascade moved — back into the turn's snapshot, so a later tool in the same
 * turn (or the model's summary) sees the plan as it now is.
 */
async function applyUpdate(ctx: ToolContext, id: string, input: TaskUpdateInput) {
  const result = await ctx.taskService.updateTask(id, input);
  ctx.mutated = true;
  for (const t of [result.task, ...result.cascaded]) {
    const idx = ctx.tasks.findIndex((x) => x.id === t.id);
    if (idx >= 0) ctx.tasks[idx] = t;
  }
  return {
    task: brief(result.task),
    ...(result.cascaded.length > 0
      ? { alsoMoved: result.cascaded.map((t) => ({ id: t.id, start: t.startDate, due: t.dueDate })) }
      : {}),
    ...(result.cascadeWarnings.length > 0 ? { warnings: result.cascadeWarnings } : {}),
  };
}

function diffDaysInclusive(start: string, end: string): number {
  const ms = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((ms(end) - ms(start)) / 86_400_000) + 1;
}

/** Is `from` reachable from `to` by walking predecessors? Then to → from would close a loop. */
function reaches(tasks: Task[], from: string, target: string): boolean {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const p of byId.get(id)?.predecessors ?? []) stack.push(p.taskId);
  }
  return false;
}

/** Status words people use, by the category they mean — for workflows that name statuses differently. */
const CATEGORY_WORDS: Record<"new" | "indeterminate" | "done", string[]> = {
  new: ["todo", "to do", "chua lam", "can lam", "backlog", "mo lai", "reopen", "open"],
  indeterminate: ["in progress", "dang lam", "doing", "bat dau", "start", "progress"],
  done: ["done", "xong", "hoan thanh", "da xong", "closed", "close", "resolved", "complete"],
};

/* -------------------------------------------------------------------------- */
/* Read tools                                                                 */
/* -------------------------------------------------------------------------- */

async function runGetTask(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const t = findTaskIn(ctx.tasks, str(args, "taskId"));
  if (!t) return notFound(str(args, "taskId"));
  const successors = ctx.tasks
    .filter((x) => x.predecessors.some((p) => p.taskId === t.id))
    .map((x) => {
      const p = x.predecessors.find((q) => q.taskId === t.id)!;
      return { id: x.id, summary: x.summary, type: p.type, lagDays: p.lagDays };
    });
  // Allowed statuses need a Jira call; a failure here shouldn't hide the rest.
  const transitions = await ctx.boardService.transitionsFor(t.id).catch(() => []);
  return {
    response: {
      ...brief(t),
      description: t.description ? t.description.slice(0, 800) : null,
      durationDays: t.durationDays,
      baselineStart: t.baselineStart,
      baselineDue: t.baselineDue,
      estimateHours: t.estimateHours,
      parent: t.wbsParentId,
      children: ctx.tasks.filter((x) => x.wbsParentId === t.id).map((x) => x.id),
      predecessors: t.predecessors.map((p) => ({
        id: p.taskId,
        summary: findTaskIn(ctx.tasks, p.taskId)?.summary ?? null,
        type: p.type,
        lagDays: p.lagDays,
      })),
      successors,
      canMoveTo: transitions.map((x) => x.toStatusName),
      jiraUrl: t.jiraUrl,
    },
  };
}

async function runSearchTasks(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const q = fold(str(args, "query"));
  const who = fold(str(args, "assignee"));
  const status = fold(str(args, "status"));
  const type = fold(str(args, "issueType"));
  const parent = str(args, "parentKey").toUpperCase();
  const limit = Math.min(60, Math.max(1, Number(args.limit) || 20));
  const byId = new Map(ctx.tasks.map((t) => [t.id, t]));

  const under = (t: Task) => {
    for (let cur = t.wbsParentId, guard = 0; cur && guard < 20; guard++) {
      if (cur.toUpperCase() === parent) return true;
      cur = byId.get(cur)?.wbsParentId ?? null;
    }
    return false;
  };
  const statusMatch = (t: Task) => {
    if (!status) return true;
    if (status === "open") return t.statusCategory !== "done";
    if (status === "todo") return t.statusCategory === "new";
    if (status === "in_progress" || status === "in progress") return t.statusCategory === "indeterminate";
    if (status === "done") return t.statusCategory === "done";
    return fold(t.statusName) === status;
  };

  const hits = ctx.tasks.filter((t) => {
    if (q && !q.split(" ").every((w) => fold(`${t.id} ${t.summary}`).includes(w))) return false;
    if (who === "none" ? t.assigneeAccountId : who && !who.split(" ").every((w) => fold(t.assigneeName ?? "").includes(w))) return false;
    if (!statusMatch(t)) return false;
    if (type && fold(t.issueType) !== type) return false;
    if (parent && !under(t)) return false;
    if (args.overdue === true && !(t.dueDate && t.dueDate < ctx.today && t.statusCategory !== "done")) return false;
    return true;
  });
  return {
    response: {
      total: hits.length,
      tasks: hits.slice(0, limit).map(brief),
      ...(hits.length > limit ? { note: `Còn ${hits.length - limit} kết quả nữa; thu hẹp điều kiện nếu cần.` } : {}),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Task edits                                                                 */
/* -------------------------------------------------------------------------- */

async function runUpdateTask(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const t = findTaskIn(ctx.tasks, str(args, "taskId"));
  if (!t) return notFound(str(args, "taskId"));
  const input: TaskUpdateInput = {};

  if (str(args, "summary")) input.summary = str(args, "summary");
  if (typeof args.description === "string") input.description = args.description;
  if (args.percentComplete !== undefined && args.percentComplete !== null) {
    const pct = Number(args.percentComplete);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { response: { error: "percentComplete phải từ 0 đến 100." } };
    input.percentComplete = Math.round(pct);
  }

  // Schedule: resolved to (start, duration) — the pair updateTask and the
  // cascade work in — whichever way the user put it.
  const startArg = str(args, "startDate");
  const dueArg = str(args, "dueDate");
  for (const [label, v] of [["startDate", startArg], ["dueDate", dueArg]] as const) {
    if (v && !ISO_DATE.test(v)) return { response: { error: `${label} phải ở dạng YYYY-MM-DD.` } };
  }
  const shift = Number(args.shiftDays);
  let start = t.startDate;
  let duration = t.durationDays;
  let scheduleTouched = false;
  if (Number.isFinite(shift) && shift !== 0) {
    if (!t.startDate) return { response: { error: `${t.id} chưa có ngày bắt đầu nên không dời được; hãy đặt startDate.` } };
    start = addDays(t.startDate, Math.round(shift));
    scheduleTouched = true;
  }
  if (startArg) {
    start = startArg;
    scheduleTouched = true;
  }
  if (args.durationDays !== undefined && args.durationDays !== null) {
    const d = Math.round(Number(args.durationDays));
    if (!Number.isFinite(d) || d < 1) return { response: { error: "durationDays phải ≥ 1." } };
    duration = d;
    scheduleTouched = true;
  }
  if (dueArg) {
    if (!start) return { response: { error: `${t.id} chưa có ngày bắt đầu; cần startDate cùng với dueDate.` } };
    const d = diffDaysInclusive(start, dueArg);
    if (d < 1) return { response: { error: "Ngày kết thúc phải sau hoặc bằng ngày bắt đầu." } };
    duration = d;
    scheduleTouched = true;
  }
  if (scheduleTouched) {
    input.startDate = start;
    input.durationDays = duration;
  }

  if (str(args, "status")) {
    const want = fold(str(args, "status"));
    const transitions = await ctx.boardService.transitionsFor(t.id);
    const exact = transitions.find((x) => fold(x.toStatusName) === want || fold(x.name) === want);
    const category = (Object.keys(CATEGORY_WORDS) as Array<keyof typeof CATEGORY_WORDS>).find((c) =>
      CATEGORY_WORDS[c].some((w) => want === w || want.includes(w))
    );
    const byCategory = category ? transitions.filter((x) => x.toCategory === category) : [];
    const pick = exact ?? (byCategory.length === 1 ? byCategory[0] : undefined);
    if (fold(t.statusName) === want) {
      // Already there — nothing to transition.
    } else if (!pick) {
      return {
        response: {
          error:
            byCategory.length > 1
              ? `"${str(args, "status")}" khớp nhiều trạng thái; hỏi người dùng chọn một.`
              : `Quy trình của ${t.id} không cho chuyển sang "${str(args, "status")}" từ "${t.statusName}".`,
          allowed: transitions.map((x) => x.toStatusName),
        },
      };
    } else {
      input.statusTransition = pick.name;
    }
  }

  if (Object.keys(input).length === 0) return { response: { error: "Không có gì để thay đổi.", current: brief(t) } };
  return { response: await applyUpdate(ctx, t.id, input) };
}

async function runAddDependency(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const pred = findTaskIn(ctx.tasks, str(args, "predecessorId"));
  const succ = findTaskIn(ctx.tasks, str(args, "successorId"));
  if (!pred) return notFound(str(args, "predecessorId"));
  if (!succ) return notFound(str(args, "successorId"));
  if (pred.id === succ.id) return { response: { error: "Một công việc không thể phụ thuộc chính nó." } };
  const type = (DEP_TYPES.includes(str(args, "type").toUpperCase() as DependencyType)
    ? str(args, "type").toUpperCase()
    : "FS") as DependencyType;
  const lag = Math.round(Number(args.lagDays) || 0);

  // The cascade walks successors breadth-first; a loop would have it chase its
  // own tail. The UI can't draw one by accident, a sentence can.
  if (reaches(ctx.tasks, pred.id, succ.id)) {
    return {
      response: {
        error: `Không nối được: ${pred.id} đã (trực tiếp hoặc gián tiếp) phụ thuộc vào ${succ.id}, nối thêm sẽ tạo vòng lặp.`,
      },
    };
  }

  const predecessors: Predecessor[] = [
    ...succ.predecessors.filter((p) => p.taskId !== pred.id),
    { taskId: pred.id, type, lagDays: lag },
  ];
  const replaced = succ.predecessors.some((p) => p.taskId === pred.id);
  return {
    response: {
      linked: `${pred.id} → ${succ.id} (${type}${lag ? `, lag ${lag} ngày` : ""})`,
      ...(replaced ? { note: "Đã thay liên kết cũ giữa hai việc này." } : {}),
      ...(await applyUpdate(ctx, succ.id, { predecessors })),
    },
  };
}

async function runRemoveDependency(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const a = findTaskIn(ctx.tasks, str(args, "predecessorId"));
  const b = findTaskIn(ctx.tasks, str(args, "successorId"));
  if (!a) return notFound(str(args, "predecessorId"));
  if (!b) return notFound(str(args, "successorId"));
  // Either direction: "bỏ nối A và B" rarely says which way the arrow points.
  const [pred, succ] = b.predecessors.some((p) => p.taskId === a.id)
    ? [a, b]
    : a.predecessors.some((p) => p.taskId === b.id)
      ? [b, a]
      : [null, null];
  if (!pred || !succ) return { response: { error: `${a.id} và ${b.id} không có liên kết nào.` } };
  return {
    response: {
      removed: `${pred.id} → ${succ.id}`,
      ...(await applyUpdate(ctx, succ.id, { predecessors: succ.predecessors.filter((p) => p.taskId !== pred.id) })),
    },
  };
}

async function runSetBaseline(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const ids = Array.isArray(args.taskIds) ? args.taskIds.map(String) : null;
  const clear = args.clear === true;
  const targets = ids
    ? ids.map((id) => findTaskIn(ctx.tasks, id)).filter((t): t is Task => !!t)
    : ctx.tasks.filter((t) => t.startDate);
  if (targets.length === 0) return { response: { error: "Không có công việc nào có lịch để lưu baseline." } };
  if (targets.length > 150) return { response: { error: `Quá nhiều việc (${targets.length}); chọn theo Epic hoặc danh sách cụ thể.` } };

  const failed: string[] = [];
  let saved = 0;
  // Sequential: each is an overlay write plus a visibility check against Jira,
  // and firing a hundred at once is how a rate limit starts.
  for (const t of targets) {
    try {
      await ctx.taskService.updateTask(t.id, clear ? { baselineStart: null, baselineDue: null } : { baselineStart: t.startDate, baselineDue: t.dueDate });
      const idx = ctx.tasks.findIndex((x) => x.id === t.id);
      if (idx >= 0) ctx.tasks[idx] = { ...t, baselineStart: clear ? null : t.startDate, baselineDue: clear ? null : t.dueDate };
      saved += 1;
    } catch {
      failed.push(t.id);
    }
  }
  if (saved > 0) ctx.mutated = true;
  return { response: { [clear ? "cleared" : "saved"]: saved, ...(failed.length > 0 ? { failed } : {}) } };
}

async function runDeleteTask(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const t = findTaskIn(ctx.tasks, str(args, "taskId"));
  if (!t) return notFound(str(args, "taskId"));
  const children = ctx.tasks.filter((x) => x.wbsParentId === t.id).map((x) => x.id);
  const dependants = ctx.tasks.filter((x) => x.predecessors.some((p) => p.taskId === t.id)).map((x) => x.id);
  if (args.confirmed !== true) {
    // The confirmation step is enforced here, not only asked of the model: an
    // unconfirmed call can never delete.
    return {
      response: {
        needsConfirmation: true,
        willDelete: brief(t),
        ...(children.length > 0 ? { alsoDeletesSubtasks: children } : {}),
        ...(dependants.length > 0 ? { losesLinksFrom: dependants } : {}),
        instruction: "Nói rõ cho người dùng những gì sẽ bị xoá (không hoàn tác được) và hỏi xác nhận. Chỉ gọi lại với confirmed=true khi họ đồng ý.",
      },
    };
  }
  await ctx.taskService.deleteTask(t.id);
  ctx.mutated = true;
  ctx.tasks = ctx.tasks.filter((x) => x.id !== t.id && x.wbsParentId !== t.id);
  return { response: { deleted: t.id, summary: t.summary } };
}

/* -------------------------------------------------------------------------- */
/* Board / sprint                                                             */
/* -------------------------------------------------------------------------- */

async function agile(ctx: ToolContext) {
  const snapshot = await ctx.boardService.snapshot(null);
  if (snapshot.mode !== "agile" || !snapshot.board) {
    return { error: snapshot.fallback?.message ?? "Chưa có board Jira Software nên chưa dùng được sprint." } as const;
  }
  return { snapshot } as const;
}

/** "Sprint 8", "8", "active", "next", or a sprint id → one open sprint. */
function findSprint(sprints: Sprint[], raw: string): Sprint | null {
  const q = fold(raw);
  if (!q || q === "active" || q === "hien tai" || q === "dang chay") return sprints.find((s) => s.state === "active") ?? null;
  if (q === "next" || q === "tiep theo" || q === "sau") return sprints.find((s) => s.state === "future") ?? null;
  const byId = sprints.find((s) => String(s.id) === q);
  if (byId) return byId;
  const exact = sprints.find((s) => fold(s.name) === q);
  if (exact) return exact;
  const num = q.match(/(\d+)\s*$/)?.[1];
  if (num) {
    const hits = sprints.filter((s) => s.name.match(/(\d+)\s*$/)?.[1] === num);
    if (hits.length === 1) return hits[0];
  }
  const partial = sprints.filter((s) => fold(s.name).includes(q));
  return partial.length === 1 ? partial[0] : null;
}

const sprintList = (sprints: Sprint[]) => sprints.map((s) => `${s.name} (${s.state === "active" ? "đang chạy" : "chưa bắt đầu"})`);

async function runMoveToSprint(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const board = await agile(ctx);
  if ("error" in board) return { response: { error: board.error } };
  const ids = (Array.isArray(args.taskIds) ? args.taskIds.map(String) : [])
    .map((id) => findTaskIn(ctx.tasks, id)?.id)
    .filter((id): id is string => !!id);
  if (ids.length === 0) return { response: { error: "Không tìm thấy công việc nào trong danh sách." } };

  const target = fold(str(args, "sprint"));
  if (target === "backlog") {
    await ctx.boardService.moveToBacklog(ids);
    ctx.mutated = true;
    return { response: { moved: ids, to: "Backlog" } };
  }
  const sprint = findSprint(board.snapshot.sprints, str(args, "sprint"));
  if (!sprint) return { response: { error: `Không xác định được sprint "${str(args, "sprint")}".`, sprints: sprintList(board.snapshot.sprints) } };
  await ctx.boardService.moveToSprint(sprint.id, ids);
  ctx.mutated = true;
  return { response: { moved: ids, to: sprint.name } };
}

async function runSetEstimate(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const board = await agile(ctx);
  if ("error" in board) return { response: { error: board.error } };
  const t = findTaskIn(ctx.tasks, str(args, "taskId"));
  if (!t) return notFound(str(args, "taskId"));
  const est = board.snapshot.estimation;
  if (!est) return { response: { error: "Board này không dùng trường ước lượng." } };
  const value = args.value === null || args.value === undefined ? null : Number(args.value);
  await ctx.boardService.setEstimate(t.id, board.snapshot.board!.id, value, est.unit);
  ctx.mutated = true;
  return { response: { taskId: t.id, [est.name]: value, unit: est.unit === "hours" ? "giờ" : "điểm" } };
}

/** A local calendar date at a local hour, as the ISO instant Jira's sprint API wants. */
function jiraDateTime(localDate: string, hour: number, offsetMinutes: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour, 0, 0) - offsetMinutes * 60_000).toISOString();
}

async function runSprintAction(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const board = await agile(ctx);
  if ("error" in board) return { response: { error: board.error } };
  const { snapshot } = board;
  const action = str(args, "action");

  if (action === "create") {
    const names = [...snapshot.sprints.map((s) => s.name), ...snapshot.velocity.map((v) => v.name)];
    const latest = names.sort((a, b) => Number(a.match(/(\d+)\s*$/)?.[1] ?? 0) - Number(b.match(/(\d+)\s*$/)?.[1] ?? 0)).at(-1);
    const name = str(args, "name") || (latest ? nextSprintName(latest) : `${ctx.projectKey} Sprint 1`);
    const sprint = await ctx.boardService.createSprint({ boardId: snapshot.board!.id, name, goal: str(args, "goal") || null });
    ctx.mutated = true;
    return { response: { created: sprint.name, id: sprint.id } };
  }

  const fallback = action === "complete" ? "active" : action === "start" ? "next" : "";
  const sprint = findSprint(snapshot.sprints, str(args, "sprint") || fallback);
  if (!sprint) return { response: { error: `Không xác định được sprint "${str(args, "sprint")}".`, sprints: sprintList(snapshot.sprints) } };

  if (action === "update") {
    const updated = await ctx.boardService.updateSprint(sprint.id, {
      ...(str(args, "name") ? { name: str(args, "name") } : {}),
      ...(typeof args.goal === "string" ? { goal: args.goal } : {}),
    });
    ctx.mutated = true;
    return { response: { updated: updated.name, goal: updated.goal } };
  }

  if (action === "start") {
    const startDate = ISO_DATE.test(str(args, "startDate")) ? str(args, "startDate") : ctx.today;
    const weeks = Math.min(8, Math.max(1, Math.round(Number(args.weeks) || 2)));
    const endDate = addDays(startDate, weeks * 7 - 1);
    const started = await ctx.boardService.startSprint(sprint.id, {
      startDate: jiraDateTime(startDate, 9, ctx.tzOffsetMinutes),
      endDate: jiraDateTime(endDate, 18, ctx.tzOffsetMinutes),
      ...(typeof args.goal === "string" ? { goal: args.goal } : {}),
    });
    ctx.mutated = true;
    return { response: { started: started.name, from: startDate, to: endDate } };
  }

  if (action === "complete") {
    const open = snapshot.issues.filter((i) => i.sprintId === sprint.id && i.statusCategory !== "done" && !i.subtask);
    const rawTarget = fold(str(args, "moveTo"));
    const moveTo: number | "backlog" | "new" =
      rawTarget === "new" || rawTarget === "moi" || rawTarget === "sprint moi"
        ? "new"
        : rawTarget && rawTarget !== "backlog"
          ? (findSprint(snapshot.sprints.filter((s) => s.state === "future"), str(args, "moveTo"))?.id ?? -1)
          : "backlog";
    if (moveTo === -1) return { response: { error: `Không xác định được sprint đích "${str(args, "moveTo")}".`, sprints: sprintList(snapshot.sprints) } };
    if (args.confirmed !== true) {
      return {
        response: {
          needsConfirmation: true,
          sprint: sprint.name,
          done: snapshot.issues.filter((i) => i.sprintId === sprint.id && i.statusCategory === "done").length,
          openWillMove: open.map((i) => i.key),
          target: moveTo === "backlog" ? "Backlog" : moveTo === "new" ? "sprint mới" : snapshot.sprints.find((s) => s.id === moveTo)?.name,
          instruction: "Tóm tắt cho người dùng và hỏi xác nhận; chỉ gọi lại với confirmed=true khi họ đồng ý.",
        },
      };
    }
    const result = await ctx.boardService.completeSprint(sprint.id, moveTo);
    ctx.mutated = true;
    return { response: { completed: sprint.name, movedOpenIssues: result.moved } };
  }

  return { response: { error: `Không hiểu thao tác "${action}".` } };
}
