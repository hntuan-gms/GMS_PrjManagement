import { Type, type FunctionDeclaration } from "@google/genai";
import type { TaskService } from "../taskService.js";
import { isAssignableType, type IssueTypeName, type Task } from "../types.js";
import * as resources from "../resourceStore.js";
import {
  buildWorkload,
  commitAssignment,
  demandPerDay,
  rankCandidates,
  type Candidate,
  type PersonWorkload,
} from "../workload.js";

/**
 * What the assistant can actually do, beyond answering.
 *
 * Two classes of tool live here and the difference is deliberate:
 *
 * - **Read tools** (`suggest_assignees`, `team_workload`) are free to call and
 *   are what make the write tools worth having. The model is told to consult
 *   them before assigning anyone.
 * - **Write tools** (`create_task`, `assign_task`, `unassign_task`) reach Jira
 *   directly, one issue at a time, because that is what "tạo giúp tôi một task"
 *   means and staging a single issue for approval is ceremony. `create_plan`
 *   stays the path for anything bigger: a whole breakdown still goes to
 *   ai_plan_run for a human to review, because forty issues created from a
 *   misread sentence is a different kind of mistake than one.
 *
 * Every write returns the issue key it touched so the user can check it, and the
 * route re-reads the project afterwards so the Gantt reflects it immediately.
 */

export interface PlanResult {
  runId: string;
  itemCount: number;
  warnings: string[];
  summary: string;
}

export interface ToolContext {
  taskService: TaskService;
  cloudId: string;
  projectKey: string;
  today: string;
  /** The turn's project snapshot. Tools that create tasks append to it so a
   *  later tool in the same turn can see what an earlier one just made. */
  tasks: Task[];
  createPlan: (brief: string, startDate: string) => Promise<PlanResult>;
  /** Set by any tool that wrote to Jira. */
  mutated: boolean;
  /** Lazily built once per turn — it costs a database round trip. */
  workload?: Map<string, PersonWorkload>;
}

export interface ToolOutcome {
  response: Record<string, unknown>;
  plan?: { runId: string; itemCount: number; warnings: string[] };
}

/* -------------------------------------------------------------------------- */
/* Declarations                                                               */
/* -------------------------------------------------------------------------- */

const CREATE_PLAN: FunctionDeclaration = {
  name: "create_plan",
  description:
    "Break a project or a body of work into a reviewable work breakdown structure with durations, " +
    "dependencies and suggested assignees. Use this when the user asks for a plan, a schedule, a WBS, " +
    "or to split a body of work into many tasks. The result is a proposal a human reviews before " +
    "anything is created in Jira. For a single task the user described precisely, use create_task instead.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      brief: {
        type: Type.STRING,
        description:
          "A self-contained description of what to plan: goals, scope, technology, constraints and " +
          "deadline. Expand on what the user said using the conversation so far; do not just copy " +
          "their last message.",
      },
      startDate: {
        type: Type.STRING,
        description: "Day 1 of the plan as YYYY-MM-DD. Use today unless the user named a date.",
      },
    },
    required: ["brief"],
  },
};

const CREATE_TASK: FunctionDeclaration = {
  name: "create_task",
  description:
    "Create ONE issue in Jira immediately. Use when the user asks for a specific piece of work to be " +
    "added — 'tạo task X cho Minh', 'thêm một bug về màn hình login'. For several related tasks call " +
    "this repeatedly; for a whole plan use create_plan instead. Writes to Jira, so only call it when " +
    "the user has actually asked for the task to be created.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      summary: { type: Type.STRING, description: "The task title, in the user's language." },
      issueType: {
        type: Type.STRING,
        description:
          "The Jira issue type, copied verbatim from the allowed list in the system prompt " +
          "(typically Task, Story, Bug, Epic or Sub-task). This is the 'level' of the item.",
      },
      description: { type: Type.STRING, description: "Optional detail. Plain text." },
      parentKey: {
        type: Type.STRING,
        description:
          "Issue key of the parent (e.g. the Epic this belongs under), when the user placed it " +
          "under something. Omit for a top-level item.",
      },
      startDate: { type: Type.STRING, description: "YYYY-MM-DD. Defaults to today." },
      durationDays: { type: Type.NUMBER, description: "Working days of effort. Defaults to 3." },
      assigneeAccountId: {
        type: Type.STRING,
        description:
          "Who does it, as an accountId from the team list. Never set this for an Epic. " +
          "Leave empty and set autoAssign instead when the user said 'ai rảnh thì giao' or did not name anyone.",
      },
      autoAssign: {
        type: Type.BOOLEAN,
        description:
          "Pick the person with the fewest schedule conflicts in this task's date range and assign them. " +
          "Ignored for an Epic.",
      },
    },
    required: ["summary", "issueType"],
  },
};

const ASSIGN_TASK: FunctionDeclaration = {
  name: "assign_task",
  description:
    "Put a person on an existing task in Jira, or move it to someone else. Give either accountId, or " +
    "auto=true to let the workload model pick whoever has the fewest conflicts. Epics cannot be assigned.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      taskId: { type: Type.STRING, description: "The Jira issue key, e.g. GPM-12." },
      accountId: { type: Type.STRING, description: "Who to assign, from the team list." },
      auto: {
        type: Type.BOOLEAN,
        description: "Choose the least-conflicted person automatically instead of naming one.",
      },
    },
    required: ["taskId"],
  },
};

const UNASSIGN_TASK: FunctionDeclaration = {
  name: "unassign_task",
  description: "Remove the current assignee from a task, putting it back in the unassigned pool.",
  parameters: {
    type: Type.OBJECT,
    properties: { taskId: { type: Type.STRING, description: "The Jira issue key." } },
    required: ["taskId"],
  },
};

const SUGGEST_ASSIGNEES: FunctionDeclaration = {
  name: "suggest_assignees",
  description:
    "Rank who should take a piece of work, fewest schedule conflicts first. Read-only — call it " +
    "before assigning anyone, and whenever the user asks who is free or who should do something. " +
    "Either name an existing taskId, or give a date range for work that does not exist yet.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      taskId: { type: Type.STRING, description: "Rank candidates for this existing issue's dates." },
      from: { type: Type.STRING, description: "YYYY-MM-DD, when taskId is not given." },
      to: { type: Type.STRING, description: "YYYY-MM-DD, when taskId is not given." },
      hoursPerDay: {
        type: Type.NUMBER,
        description: "Effort per working day. Defaults to a full day of each candidate's capacity.",
      },
      limit: { type: Type.NUMBER, description: "How many candidates to return. Default 5." },
    },
  },
};

const TEAM_WORKLOAD: FunctionDeclaration = {
  name: "team_workload",
  description:
    "Who on the team is loaded or free over a date range, with their committed hours, spare hours and " +
    "overloaded days. Read-only. Use for 'ai đang rảnh', 'ai đang quá tải', 'tuần sau team thế nào'.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      from: { type: Type.STRING, description: "YYYY-MM-DD. Defaults to today." },
      to: { type: Type.STRING, description: "YYYY-MM-DD. Defaults to 14 days after `from`." },
    },
  },
};

export const TOOLS: FunctionDeclaration[] = [
  CREATE_PLAN,
  CREATE_TASK,
  ASSIGN_TASK,
  UNASSIGN_TASK,
  SUGGEST_ASSIGNEES,
  TEAM_WORKLOAD,
];

/** What the UI shows while a call is in flight. */
export function labelFor(name: string): string {
  switch (name) {
    case CREATE_PLAN.name:
      return "Đang lập kế hoạch...";
    case CREATE_TASK.name:
      return "Đang tạo công việc trên Jira...";
    case ASSIGN_TASK.name:
      return "Đang gán người phụ trách...";
    case UNASSIGN_TASK.name:
      return "Đang bỏ gán...";
    case SUGGEST_ASSIGNEES.name:
      return "Đang so tải để chọn người...";
    case TEAM_WORKLOAD.name:
      return "Đang xem tải của team...";
    default:
      return "Đang xử lý...";
  }
}

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                   */
/* -------------------------------------------------------------------------- */

function addDays(iso: string, days: number): string {
  const ms = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function str(args: Record<string, unknown>, key: string): string {
  return String(args[key] ?? "").trim();
}

async function workloadOf(ctx: ToolContext): Promise<Map<string, PersonWorkload>> {
  if (ctx.workload) return ctx.workload;
  const [users, profiles, absences] = await Promise.all([
    ctx.taskService.listUsers(),
    resources.listProfiles(ctx.cloudId),
    resources.listAbsences(ctx.cloudId),
  ]);
  ctx.workload = buildWorkload({ tasks: ctx.tasks, users, profiles, absences });
  return ctx.workload;
}

function findTask(ctx: ToolContext, id: string): Task | undefined {
  const needle = id.trim().toUpperCase();
  return ctx.tasks.find((t) => t.id.toUpperCase() === needle);
}

/** Trimmed for the model: full Candidate objects are mostly noise in a prompt. */
function describeCandidate(c: Candidate): Record<string, unknown> {
  return {
    accountId: c.accountId,
    name: c.displayName,
    conflictDays: c.conflictDays,
    freeHours: c.freeHours,
    utilisationAfterPercent: Number.isFinite(c.utilisationAfter)
      ? Math.round(c.utilisationAfter * 100)
      : null,
    openTasks: c.openTaskCount,
    ...(c.collidesWith.length > 0 ? { collidesWith: c.collidesWith.slice(0, 5) } : {}),
    ...(c.availableDays === 0 ? { note: "nghỉ toàn bộ khoảng này" } : {}),
  };
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolOutcome> {
  switch (name) {
    case CREATE_PLAN.name:
      return runCreatePlan(args, ctx);
    case CREATE_TASK.name:
      return runCreateTask(args, ctx);
    case ASSIGN_TASK.name:
      return runAssignTask(args, ctx);
    case UNASSIGN_TASK.name:
      return runUnassignTask(args, ctx);
    case SUGGEST_ASSIGNEES.name:
      return runSuggestAssignees(args, ctx);
    case TEAM_WORKLOAD.name:
      return runTeamWorkload(args, ctx);
    default:
      return { response: { error: `Công cụ "${name}" không tồn tại.` } };
  }
}

async function runCreatePlan(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const brief = str(args, "brief");
  const startDate = str(args, "startDate") || ctx.today;
  const plan = await ctx.createPlan(brief, startDate);
  return {
    response: { result: plan.summary },
    plan: { runId: plan.runId, itemCount: plan.itemCount, warnings: plan.warnings },
  };
}

async function runCreateTask(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const summary = str(args, "summary");
  const issueType = str(args, "issueType");
  if (!summary || !issueType) {
    return { response: { error: "Thiếu tên công việc hoặc loại issue." } };
  }

  const startDate = ISO_DATE.test(str(args, "startDate")) ? str(args, "startDate") : ctx.today;
  const durationRaw = Number(args.durationDays);
  const durationDays = Number.isFinite(durationRaw) ? Math.max(1, Math.round(durationRaw)) : 3;
  const dueDate = addDays(startDate, durationDays - 1);

  let assigneeAccountId: string | null = str(args, "assigneeAccountId") || null;
  let pickedReason: string | undefined;

  if (!isAssignableType(issueType)) {
    // Not an error: the model was told, but an Epic with an owner is a natural
    // thing to say. Dropping it and saying so beats refusing the creation.
    if (assigneeAccountId || args.autoAssign) pickedReason = "Epic nên không gán người phụ trách.";
    assigneeAccountId = null;
  } else if (!assigneeAccountId && args.autoAssign === true) {
    const workload = await workloadOf(ctx);
    const best = rankCandidates(workload, startDate, dueDate, null)[0];
    if (best) {
      assigneeAccountId = best.accountId;
      pickedReason =
        best.conflictDays === 0
          ? `Chọn ${best.displayName}: không trùng lịch, còn trống ${best.freeHours}h trong khoảng này.`
          : `Chọn ${best.displayName}: ít xung đột nhất (${best.conflictDays} ngày trùng).`;
    }
  }

  const created = await ctx.taskService.createTask({
    summary,
    issueType: issueType as IssueTypeName,
    description: str(args, "description") || null,
    wbsParentId: str(args, "parentKey") || null,
    startDate,
    durationDays,
    assigneeAccountId,
  });
  ctx.mutated = true;
  ctx.tasks.push(created);
  // Keep the in-turn workload honest: a second create_task in the same turn must
  // see that this one already booked someone's week.
  if (ctx.workload && created.assigneeAccountId) {
    commitAssignment(ctx.workload, created.assigneeAccountId, startDate, dueDate, null, created.id);
  }

  return {
    response: {
      created: created.id,
      summary: created.summary,
      issueType: created.issueType,
      parent: created.wbsParentId,
      startDate: created.startDate,
      dueDate: created.dueDate,
      assignee: created.assigneeName ?? null,
      ...(pickedReason ? { note: pickedReason } : {}),
    },
  };
}

async function runAssignTask(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const taskId = str(args, "taskId");
  const task = findTask(ctx, taskId);
  if (!task) return { response: { error: `Không tìm thấy công việc ${taskId} trong dự án này.` } };
  if (!isAssignableType(task.issueType)) {
    return {
      response: {
        error: `${task.id} là Epic nên không gán người được. Hãy gán cho các công việc con của nó.`,
      },
    };
  }

  let accountId = str(args, "accountId") || null;
  let reason: string | undefined;

  if (!accountId) {
    if (args.auto !== true) return { response: { error: "Cần accountId hoặc auto=true." } };
    const from = task.startDate ?? ctx.today;
    const to = task.dueDate ?? addDays(from, Math.max(0, task.durationDays - 1));
    const workload = await workloadOf(ctx);
    // With an estimate, spread it evenly over the task's own days; the capacity
    // argument is unused on that branch. Without one, null means "a full day".
    const perDay = task.estimateHours != null ? demandPerDay(task, 8, () => false) : null;
    // The current holder is excluded from their own reassignment only implicitly:
    // they are ranked like everyone else, and if they are still the best fit the
    // assignment is a no-op rather than a shuffle for its own sake.
    const best = rankCandidates(workload, from, to, perDay)[0];
    if (!best) return { response: { error: "Dự án chưa có thành viên nào để gán." } };
    accountId = best.accountId;
    reason =
      best.conflictDays === 0
        ? `${best.displayName} không trùng lịch trong ${from} → ${to}.`
        : `${best.displayName} ít xung đột nhất (${best.conflictDays} ngày trùng với ${best.collidesWith.join(", ")}).`;
  }

  const result = await ctx.taskService.updateTask(task.id, { assigneeAccountId: accountId });
  ctx.mutated = true;
  const idx = ctx.tasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) ctx.tasks[idx] = result.task;

  return {
    response: {
      taskId: task.id,
      summary: task.summary,
      assignedTo: result.task.assigneeName ?? accountId,
      ...(reason ? { reason } : {}),
    },
  };
}

async function runUnassignTask(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const taskId = str(args, "taskId");
  const task = findTask(ctx, taskId);
  if (!task) return { response: { error: `Không tìm thấy công việc ${taskId}.` } };

  const result = await ctx.taskService.updateTask(task.id, { assigneeAccountId: null });
  ctx.mutated = true;
  const idx = ctx.tasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) ctx.tasks[idx] = result.task;

  return { response: { taskId: task.id, summary: task.summary, assignee: null } };
}

async function runSuggestAssignees(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolOutcome> {
  const taskId = str(args, "taskId");
  let from = str(args, "from");
  let to = str(args, "to");
  let subject: string | undefined;
  let hoursPerDay = Number.isFinite(Number(args.hoursPerDay)) ? Number(args.hoursPerDay) : null;

  if (taskId) {
    const task = findTask(ctx, taskId);
    if (!task) return { response: { error: `Không tìm thấy công việc ${taskId}.` } };
    if (!isAssignableType(task.issueType)) {
      return { response: { error: `${task.id} là Epic — hãy hỏi cho các công việc con.` } };
    }
    from = task.startDate ?? ctx.today;
    to = task.dueDate ?? addDays(from, Math.max(0, task.durationDays - 1));
    subject = `${task.id} — ${task.summary}`;
    if (hoursPerDay === null && task.estimateHours != null) {
      hoursPerDay = demandPerDay(task, 8, () => false);
    }
  }

  if (!ISO_DATE.test(from)) from = ctx.today;
  if (!ISO_DATE.test(to) || to < from) to = addDays(from, 2);

  const limitRaw = Number(args.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(20, Math.max(1, Math.round(limitRaw))) : 5;

  const workload = await workloadOf(ctx);
  const ranked = rankCandidates(workload, from, to, hoursPerDay);
  if (ranked.length === 0) return { response: { error: "Dự án chưa có thành viên nào." } };

  return {
    response: {
      ...(subject ? { forTask: subject } : {}),
      window: `${from} → ${to}`,
      rankedBest: ranked.slice(0, limit).map(describeCandidate),
      note: "Đã sắp theo số ngày trùng lịch tăng dần, rồi đến mức tải. Người đầu danh sách là lựa chọn ít xung đột nhất.",
    },
  };
}

async function runTeamWorkload(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  let from = str(args, "from");
  if (!ISO_DATE.test(from)) from = ctx.today;
  let to = str(args, "to");
  if (!ISO_DATE.test(to) || to < from) to = addDays(from, 13);

  // 0 hours of hypothetical new work: this is a report on what people already
  // hold, so conflictDays means "days already over capacity" and loadPercent is
  // their current utilisation rather than a what-if.
  const ranked = rankCandidates(await workloadOf(ctx), from, to, 0);

  return {
    response: {
      window: `${from} → ${to}`,
      people: ranked.map((c) => ({
        accountId: c.accountId,
        name: c.displayName,
        openTasks: c.openTaskCount,
        freeHours: c.freeHours,
        workingDays: c.availableDays,
        loadPercent: Number.isFinite(c.utilisationAfter) ? Math.round(c.utilisationAfter * 100) : null,
        overloadedDays: c.conflictDays,
      })),
    },
  };
}
