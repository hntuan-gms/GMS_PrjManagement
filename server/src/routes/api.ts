import { Router } from "express";
import { requireAuth, requireProject } from "../auth/middleware.js";
import { badRequest } from "../errors.js";
import type { SessionMeta, TaskCreateInput, TaskUpdateInput } from "../types.js";

export const apiRouter = Router();

// Fail-closed: everything below this line requires a session. A route added later
// is protected by default. This matters because the Cloud Run service is publicly
// invokable — this middleware is the only access control in front of Jira.
apiRouter.use(requireAuth);

apiRouter.get("/meta", (req, res) => {
  const { session, startDateFieldId } = req.auth!;
  const meta: SessionMeta = {
    user: {
      accountId: session.accountId,
      displayName: session.displayName,
      avatarUrl: session.avatarUrl,
    },
    site: { cloudId: session.cloudId, url: session.siteUrl, name: session.siteName },
    project: session.projectKey
      ? { key: session.projectKey, name: session.projectName ?? session.projectKey }
      : null,
    startDateFieldId,
    // The overlay lives on the container's ephemeral disk; the client warns about it.
    overlayEphemeral: true,
  };
  res.json(meta);
});

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

    const { task, cascadeWarnings } = await req.auth!.taskService!.updateTask(req.params.id, input);
    res.json(cascadeWarnings.length > 0 ? { ...task, cascadeWarnings } : task);
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
