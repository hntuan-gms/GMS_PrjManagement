import { Router, type Request } from "express";
import { requireProject } from "../auth/middleware.js";
import { BoardService } from "../agile/boardService.js";
import { badRequest } from "../errors.js";

export const boardRouter = Router();

/**
 * The Bảng tab (board, backlog, sprints). Everything here reads or writes Jira
 * directly through BoardService — there is no board state of our own to keep in
 * sync, because the point is that a card moved here is moved in Jira.
 *
 * The AI parts live under /api/ai/board (routes/ai.ts), behind requireStaff like
 * every other model call.
 */

boardRouter.use(requireProject);

export function boardServiceFor(req: Request): BoardService {
  const { jira, session } = req.auth!;
  return new BoardService(jira, { cloudId: session.cloudId, projectKey: session.projectKey! });
}

function intParam(raw: unknown, name: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Thiếu hoặc sai ${name}.`);
  return n;
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function rankOf(body: any): { before?: string; after?: string } | undefined {
  const before = typeof body?.before === "string" && body.before ? body.before : undefined;
  const after = typeof body?.after === "string" && body.after ? body.after : undefined;
  return before || after ? { before, after } : undefined;
}

function keysOf(body: any): string[] {
  return Array.isArray(body?.issues) ? body.issues.map(String) : [];
}

/** Snapshot of one board (or the project's status board when there is no Jira Software board). */
boardRouter.get("/", async (req, res, next) => {
  try {
    const raw = req.query.boardId;
    const boardId = raw ? intParam(raw, "boardId") : null;
    res.json(await boardServiceFor(req).snapshot(boardId));
  } catch (err) {
    next(err);
  }
});

boardRouter.get("/issues/:key/transitions", async (req, res, next) => {
  try {
    res.json(await boardServiceFor(req).transitionsFor(req.params.key));
  } catch (err) {
    next(err);
  }
});

/** Drop a card: optional status change (any of the target column's statuses), optional rank. */
boardRouter.post("/issues/:key/move", async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const toStatusIds = Array.isArray(body.toStatusIds) ? body.toStatusIds.map(String) : undefined;
    res.json(await boardServiceFor(req).moveCard({ key: req.params.key, toStatusIds, ...rankOf(body) }));
  } catch (err) {
    next(err);
  }
});

boardRouter.post("/rank", async (req, res, next) => {
  try {
    const rank = rankOf(req.body);
    if (!rank) throw badRequest("Cần chỉ định việc đứng trước hoặc sau.");
    await boardServiceFor(req).rank(keysOf(req.body), rank);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

boardRouter.post("/backlog", async (req, res, next) => {
  try {
    await boardServiceFor(req).moveToBacklog(keysOf(req.body), rankOf(req.body));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

boardRouter.post("/sprints", async (req, res, next) => {
  try {
    const b = req.body ?? {};
    res.status(201).json(
      await boardServiceFor(req).createSprint({
        boardId: intParam(b.boardId, "boardId"),
        name: String(b.name ?? ""),
        goal: typeof b.goal === "string" ? b.goal : null,
        startDate: typeof b.startDate === "string" && ISO_DATETIME.test(b.startDate) ? b.startDate : null,
        endDate: typeof b.endDate === "string" && ISO_DATETIME.test(b.endDate) ? b.endDate : null,
      })
    );
  } catch (err) {
    next(err);
  }
});

boardRouter.patch("/sprints/:id", async (req, res, next) => {
  try {
    const b = req.body ?? {};
    res.json(
      await boardServiceFor(req).updateSprint(intParam(req.params.id, "sprint"), {
        name: typeof b.name === "string" ? b.name : undefined,
        goal: typeof b.goal === "string" || b.goal === null ? b.goal : undefined,
        startDate: typeof b.startDate === "string" && ISO_DATETIME.test(b.startDate) ? b.startDate : undefined,
        endDate: typeof b.endDate === "string" && ISO_DATETIME.test(b.endDate) ? b.endDate : undefined,
      })
    );
  } catch (err) {
    next(err);
  }
});

boardRouter.post("/sprints/:id/start", async (req, res, next) => {
  try {
    const b = req.body ?? {};
    if (!ISO_DATETIME.test(String(b.startDate ?? "")) || !ISO_DATETIME.test(String(b.endDate ?? ""))) {
      throw badRequest("Cần ngày bắt đầu và kết thúc sprint.");
    }
    res.json(
      await boardServiceFor(req).startSprint(intParam(req.params.id, "sprint"), {
        startDate: b.startDate,
        endDate: b.endDate,
        name: typeof b.name === "string" ? b.name : undefined,
        goal: typeof b.goal === "string" ? b.goal : undefined,
      })
    );
  } catch (err) {
    next(err);
  }
});

boardRouter.post("/sprints/:id/complete", async (req, res, next) => {
  try {
    const raw = req.body?.moveTo;
    const moveTo = raw === "new" ? "new" : raw === "backlog" || raw == null ? "backlog" : intParam(raw, "sprint đích");
    res.json(await boardServiceFor(req).completeSprint(intParam(req.params.id, "sprint"), moveTo));
  } catch (err) {
    next(err);
  }
});

boardRouter.post("/sprints/:id/issues", async (req, res, next) => {
  try {
    await boardServiceFor(req).moveToSprint(intParam(req.params.id, "sprint"), keysOf(req.body), rankOf(req.body));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

boardRouter.put("/issues/:key/estimate", async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const value = b.value === null || b.value === "" ? null : Number(b.value);
    await boardServiceFor(req).setEstimate(
      req.params.key,
      intParam(b.boardId, "boardId"),
      value,
      b.unit === "hours" ? "hours" : "points"
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
