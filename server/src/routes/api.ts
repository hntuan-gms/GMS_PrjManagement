import { Router } from "express";
import { aiRouter } from "./ai.js";
import { requireAuth, requireProject } from "../auth/middleware.js";
import { badRequest } from "../errors.js";
import type { BulkTaskCreateInput, TaskCreateInput, TaskUpdateInput } from "../types.js";

export const apiRouter = Router();

// Fail-closed: everything below this line requires a session. A route added later
// is protected by default. This matters because the Cloud Run service is publicly
// invokable — this middleware is the only access control in front of Jira.
apiRouter.use(requireAuth);

// Mounted after requireAuth so the planner inherits it rather than restating it.
apiRouter.use("/ai", aiRouter);

// GET /meta used to live here, returning the same SessionMeta as
// /api/auth/me. Nothing ever fetched it, and having two copies of that object is
// how `overlayEphemeral` ended up flipped in one of them and not the other — the
// client kept showing "your data will be lost on the next deploy" well after the
// move to Postgres made that false. /api/auth/me is the only copy now.

apiRouter.get("/tasks", requireProject, async (req, res, next) => {
  try {
    res.json(await req.auth!.taskService!.listTasks());
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/users", requireProject, async (req, res, next) => {
  try {
    res.json(await req.auth!.taskService!.listUsers());
  } catch (err) {
    next(err);
  }
});

apiRouter.post("/tasks", requireProject, async (req, res, next) => {
  try {
    const input = req.body as TaskCreateInput;
    if (!input.summary || !input.issueType) {
      next(badRequest("Cần nhập tên công việc và loại issue."));
      return;
    }
    res.status(201).json(await req.auth!.taskService!.createTask(input));
  } catch (err) {
    next(err);
  }
});

apiRouter.post("/tasks/bulk", requireProject, async (req, res, next) => {
  try {
    const input = req.body as BulkTaskCreateInput;
    const summaries = (input.summaries ?? []).map((s) => s.trim()).filter(Boolean);
    if (summaries.length === 0 || !input.issueType) {
      next(badRequest("Cần nhập ít nhất một tên công việc và loại issue."));
      return;
    }
    res.status(201).json(await req.auth!.taskService!.createTasksBulk({ ...input, summaries }));
  } catch (err) {
    next(err);
  }
});

apiRouter.patch("/tasks/:id", requireProject, async (req, res, next) => {
  try {
    const input = req.body as TaskUpdateInput;
    const projectKey = req.auth!.session.projectKey!;

    // Cross-project predecessors can't be enforced: the cascade only loads issues
    // from the session's project, so a foreign key would be silently ignored and
    // the dependency would appear to exist without ever being applied.
    if (input.predecessors) {
      const foreign = input.predecessors.filter((p) => !p.taskId.startsWith(`${projectKey}-`));
      if (foreign.length > 0) {
        next(
          badRequest(
            `Phụ thuộc phải nằm trong cùng dự án ${projectKey}: ${foreign.map((p) => p.taskId).join(", ")}`
          )
        );
        return;
      }
    }

    const { task, cascadeWarnings, cascaded } = await req.auth!.taskService!.updateTask(req.params.id, input);
    // `cascaded` (and cascadeWarnings, when non-empty) always present: the client
    // applies a schedule edit's full effect — including any successors the
    // dependency cascade moved — straight from this one response, rather than
    // following up with a separate GET /tasks that used to arrive a moment later
    // and visibly snap the chart to the confirmed values.
    res.json({ ...task, cascaded, ...(cascadeWarnings.length > 0 ? { cascadeWarnings } : {}) });
  } catch (err) {
    next(err);
  }
});

apiRouter.delete("/tasks/:id", requireProject, async (req, res, next) => {
  try {
    await req.auth!.taskService!.deleteTask(req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

apiRouter.post("/sync", requireProject, async (req, res, next) => {
  try {
    const tasks = await req.auth!.taskService!.listTasks();
    res.json({ syncedAt: new Date().toISOString(), count: tasks.length, tasks });
  } catch (err) {
    next(err);
  }
});
