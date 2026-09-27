import { Router } from "express";
import { requireProject } from "../auth/middleware.js";
import { availability, plannedWindow, sprintFacts, velocityStats } from "../agile/sprintMetrics.js";
import { estimateIssues, planSprint, sprintInsight } from "../ai/sprintAi.js";
import { badRequest } from "../errors.js";
import * as resources from "../resourceStore.js";
import { boardServiceFor } from "./board.js";

/**
 * AI on the board — mounted at /api/ai/board, so requireStaff (on the /ai mount)
 * covers it like every other route that bills against the shared Gemini key.
 *
 * All three are read-only: they return a proposal, and applying it goes through
 * the ordinary board routes (move to sprint, set goal, set estimate) — a person
 * clicks "Áp dụng". The same rule as the planner: nothing a model suggests
 * reaches Jira on its own.
 */
export const boardAiRouter = Router();

boardAiRouter.use(requireProject);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The browser's local date and UTC offset — sprint days are calendar days where the team is. */
function clock(body: any): { today: string; offset: number } {
  const today = typeof body?.today === "string" && ISO_DATE.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);
  const offset = Number(body?.tzOffsetMinutes);
  return { today, offset: Number.isFinite(offset) && Math.abs(offset) <= 14 * 60 ? offset : 0 };
}

async function agileSnapshot(req: any, boardId: number) {
  const service = boardServiceFor(req);
  const snapshot = await service.snapshot(boardId);
  if (snapshot.mode !== "agile" || !snapshot.board) {
    throw badRequest(snapshot.fallback?.message ?? "Cần một board Jira Software để dùng tính năng này.");
  }
  return { service, snapshot };
}

boardAiRouter.post("/plan", async (req, res, next) => {
  try {
    const { boardId, sprintId } = req.body ?? {};
    const { today, offset } = clock(req.body);
    const { snapshot } = await agileSnapshot(req, Number(boardId));
    const target = snapshot.sprints.find((s) => s.id === Number(sprintId));
    if (!target || target.state !== "future") throw badRequest("Chọn một sprint chưa bắt đầu để lập kế hoạch.");

    const window = plannedWindow(snapshot, target, today, offset);
    const { session, taskService } = req.auth!;
    // Best-effort, like the report's team list: without it the plan still works,
    // it just can't account for who is away.
    const [members, profiles, absences] = await Promise.all([
      taskService!.listUsers().catch(() => []),
      resources.listProfiles(session.cloudId).catch(() => []),
      resources.listAbsences(session.cloudId).catch(() => []),
    ]);
    const team = availability(members, profiles, absences, window.start, window.end, resources.DEFAULT_CAPACITY_HOURS);

    res.json(
      await planSprint({
        snapshot,
        target,
        window,
        velocity: velocityStats(snapshot),
        team,
        projectKey: session.projectKey!,
      })
    );
  } catch (err) {
    next(err);
  }
});

boardAiRouter.post("/estimate", async (req, res, next) => {
  try {
    const { boardId } = req.body ?? {};
    const { service, snapshot } = await agileSnapshot(req, Number(boardId));
    if (!snapshot.estimation) throw badRequest("Board này không dùng trường ước lượng nào.");

    const requested = Array.isArray(req.body?.keys) ? new Set(req.body.keys.map(String)) : null;
    const targets = snapshot.issues
      .filter((i) => !i.subtask && i.statusCategory !== "done" && i.estimate === null && i.issueType.toLowerCase() !== "epic")
      .filter((i) => (requested ? requested.has(i.key) : true))
      .slice(0, 30);
    if (targets.length === 0) throw badRequest("Không còn việc nào chưa ước lượng.");

    const references = await service.estimationReferences(snapshot.board!.id, snapshot.estimation);
    res.json({ ...(await estimateIssues({ targets, references, unit: snapshot.estimation.unit })), unit: snapshot.estimation.unit });
  } catch (err) {
    next(err);
  }
});

boardAiRouter.post("/insight", async (req, res, next) => {
  try {
    const { boardId, sprintId } = req.body ?? {};
    const { today, offset } = clock(req.body);
    const { snapshot } = await agileSnapshot(req, Number(boardId));
    const sprint = snapshot.sprints.find((s) => s.id === Number(sprintId) && s.state === "active");
    if (!sprint) throw badRequest("Chỉ phân tích được sprint đang chạy.");
    const facts = sprintFacts(snapshot, sprint, today, offset);
    res.json(await sprintInsight({ snapshot, facts, projectKey: req.auth!.session.projectKey! }));
  } catch (err) {
    next(err);
  }
});
