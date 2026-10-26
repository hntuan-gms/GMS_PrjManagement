import express, { Router } from "express";
import { aiRouter } from "./ai.js";
import { resourcesRouter } from "./resources.js";
import { progressRouter } from "./progress.js";
import { boardRouter } from "./board.js";
import { timesheetRouter } from "./timesheet.js";
import { kbktRouter } from "./kbkt.js";
import { filtersRouter } from "./filters.js";
import { requireAuth, requireProject, requireStaff } from "../auth/middleware.js";
import { badRequest } from "../errors.js";
import { TaskActivity } from "../taskActivity.js";
import { TaskExtras } from "../taskExtras.js";
import type { BulkTaskCreateInput, ImportRow, TaskCreateInput, TaskUpdateInput } from "../types.js";

export const apiRouter = Router();

// Fail-closed: everything below this line requires a session. A route added later
// is protected by default. This matters because the Cloud Run service is publicly
// invokable — this middleware is the only access control in front of Jira.
apiRouter.use(requireAuth);

// Mounted after requireAuth so the planner inherits it rather than restating it.
// requireStaff sits on the mount rather than on each AI route, for the same
// fail-closed reason requireAuth does: a route added to ai.ts later is gated by
// default instead of needing someone to remember.
apiRouter.use("/ai", requireStaff, aiRouter);
apiRouter.use("/resources", resourcesRouter);
apiRouter.use("/progress", progressRouter);
apiRouter.use("/board", boardRouter);
apiRouter.use("/timesheet", timesheetRouter);
apiRouter.use("/kbkt", kbktRouter);
apiRouter.use("/filters", filtersRouter);

// Jira's own default attachment limit is 10 MB; this only has to sit above it
// and below Cloud Run's 32 MB request cap, so Jira's message is the one people see.
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const LINK_URL = /^https?:\/\/\S+$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

apiRouter.get("/priorities", requireProject, async (req, res, next) => {
  try {
    res.json(await req.auth!.taskService!.listPriorities());
  } catch (err) {
    next(err);
  }
});

/** The issue types this project really has — a plan row can only be created as one of these. */
apiRouter.get("/issue-types", requireProject, async (req, res, next) => {
  try {
    res.json(await req.auth!.taskService!.listIssueTypes());
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/labels", requireProject, async (req, res, next) => {
  try {
    res.json(await req.auth!.taskService!.listLabels());
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

/**
 * Components, versions, issue links, watchers and JQL — what Jira owns and this app
 * only shows or forwards (taskExtras.ts). Each call acts as the signed-in user, so
 * Jira's own permissions decide what comes back.
 */
function extrasFor(req: express.Request): TaskExtras {
  return new TaskExtras(req.auth!.jira, { projectKey: req.auth!.session.projectKey!, accountId: req.auth!.session.accountId });
}

apiRouter.get("/components", requireProject, async (req, res, next) => {
  try {
    res.json(await extrasFor(req).components());
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/versions", requireProject, async (req, res, next) => {
  try {
    res.json(await extrasFor(req).versions());
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/link-types", requireProject, async (req, res, next) => {
  try {
    res.json(await extrasFor(req).linkTypes());
  } catch (err) {
    next(err);
  }
});

// "/issue-links", not "/links": POST /tasks/:id/links is already the web link (remotelink) upload.
apiRouter.get("/tasks/:id/issue-links", requireProject, async (req, res, next) => {
  try {
    res.json(await extrasFor(req).links(ownKey(req)));
  } catch (err) {
    next(err);
  }
});

apiRouter.post("/tasks/:id/issue-links", requireProject, async (req, res, next) => {
  try {
    const b = (req.body ?? {}) as { typeName?: unknown; otherKey?: unknown; direction?: unknown };
    res.status(201).json(
      await extrasFor(req).addLink(ownKey(req), {
        typeName: String(b.typeName ?? ""),
        otherKey: String(b.otherKey ?? ""),
        direction: b.direction as "outward" | "inward",
      })
    );
  } catch (err) {
    next(err);
  }
});

apiRouter.delete("/tasks/:id/issue-links/:linkId", requireProject, async (req, res, next) => {
  try {
    res.json(await extrasFor(req).removeLink(ownKey(req), req.params.linkId));
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/tasks/:id/watchers", requireProject, async (req, res, next) => {
  try {
    res.json(await extrasFor(req).watchers(ownKey(req)));
  } catch (err) {
    next(err);
  }
});

apiRouter.put("/tasks/:id/watchers", requireProject, async (req, res, next) => {
  try {
    const watching = (req.body as { watching?: unknown } | undefined)?.watching;
    if (typeof watching !== "boolean") {
      next(badRequest("Cần chỉ rõ theo dõi hay bỏ theo dõi."));
      return;
    }
    res.json(await extrasFor(req).setWatching(ownKey(req), watching));
  } catch (err) {
    next(err);
  }
});

/** POST because a JQL can be long; it changes nothing. */
apiRouter.post("/tasks/jql", requireProject, async (req, res, next) => {
  try {
    res.json(await extrasFor(req).jqlKeys(String((req.body as { jql?: unknown } | undefined)?.jql ?? "")));
  } catch (err) {
    next(err);
  }
});

apiRouter.post("/tasks/import", requireProject, async (req, res, next) => {
  try {
    res.status(201).json(await req.auth!.taskService!.importTasks((req.body as { rows?: ImportRow[] } | undefined)?.rows ?? []));
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

    if (input.labels !== undefined && (!Array.isArray(input.labels) || input.labels.some((l) => typeof l !== "string"))) {
      next(badRequest("Nhãn phải là danh sách chuỗi."));
      return;
    }
    if (input.priority !== undefined && typeof input.priority !== "string") {
      next(badRequest("Độ ưu tiên không hợp lệ."));
      return;
    }
    for (const field of ["components", "fixVersions"] as const) {
      const v = input[field];
      if (v !== undefined && (!Array.isArray(v) || v.some((x) => typeof x !== "string"))) {
        next(badRequest(`"${field}" phải là danh sách chuỗi.`));
        return;
      }
    }
    if (input.parentKey !== undefined && input.parentKey !== null && typeof input.parentKey !== "string") {
      next(badRequest("Việc cha không hợp lệ."));
      return;
    }
    if (input.issueType !== undefined && (typeof input.issueType !== "string" || !input.issueType.trim())) {
      next(badRequest("Loại công việc không hợp lệ."));
      return;
    }
    // Written straight into a DATE column; a malformed value would surface as a
    // Postgres error (500) instead of saying what was wrong.
    for (const field of ["baselineStart", "baselineDue"] as const) {
      const v = input[field];
      if (v !== undefined && v !== null && (typeof v !== "string" || !ISO_DATE.test(v))) {
        next(badRequest("Ngày baseline phải có dạng YYYY-MM-DD."));
        return;
      }
    }

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

/**
 * Comments and history. They read and write Jira directly (see taskActivity.ts),
 * so what a person sees here is what Jira shows — and Jira, not this app, sends
 * the notification when someone is @mentioned.
 */
function activityFor(req: express.Request): TaskActivity {
  return new TaskActivity(req.auth!.jira, req.auth!.session.accountId);
}

/** Keys outside the session's project are refused up front, as the board routes do. */
function ownKey(req: express.Request): string {
  // The exact `KEY-<digits>` shape, not just the prefix: the key is spliced into a
  // Jira URL path, and "PRJ-1/../../x" starts with "PRJ-" too.
  req.auth!.taskService!.assertOwnKey(req.params.id);
  return req.params.id;
}

apiRouter.get("/tasks/:id/comments", requireProject, async (req, res, next) => {
  try {
    res.json(await activityFor(req).listComments(ownKey(req)));
  } catch (err) {
    next(err);
  }
});

apiRouter.post("/tasks/:id/comments", requireProject, async (req, res, next) => {
  try {
    const text = String((req.body as { text?: unknown })?.text ?? "");
    res.status(201).json(await activityFor(req).addComment(ownKey(req), text));
  } catch (err) {
    next(err);
  }
});

apiRouter.put("/tasks/:id/comments/:commentId", requireProject, async (req, res, next) => {
  try {
    const text = String((req.body as { text?: unknown })?.text ?? "");
    res.json(await activityFor(req).updateComment(ownKey(req), req.params.commentId, text));
  } catch (err) {
    next(err);
  }
});

apiRouter.delete("/tasks/:id/comments/:commentId", requireProject, async (req, res, next) => {
  try {
    await activityFor(req).deleteComment(ownKey(req), req.params.commentId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/tasks/:id/activity", requireProject, async (req, res, next) => {
  try {
    res.json(await activityFor(req).listActivity(ownKey(req)));
  } catch (err) {
    next(err);
  }
});

/** What the issue's workflow allows next — the edit modal lists exactly these. */
apiRouter.get("/tasks/:id/transitions", requireProject, async (req, res, next) => {
  try {
    res.json(await req.auth!.taskService!.listTransitions(req.params.id));
  } catch (err) {
    next(err);
  }
});

/** Existing attachments and web links, for the edit modal's list. */
apiRouter.get("/tasks/:id/attachments", requireProject, async (req, res, next) => {
  try {
    const service = req.auth!.taskService!;
    service.assertOwnKey(req.params.id);
    const jira = req.auth!.jira;
    const [files, links] = await Promise.all([
      jira.getAttachments(req.params.id),
      jira.getRemoteLinks(req.params.id).catch(() => []),
    ]);
    res.json({
      files: files.map((f) => ({
        id: String(f.id),
        filename: f.filename,
        size: f.size,
        mimeType: f.mimeType,
        created: f.created,
        author: f.author?.displayName ?? null,
      })),
      links: links
        .filter((l) => l.object?.url)
        .map((l) => ({ id: String(l.id), url: l.object!.url!, title: l.object?.title || l.object!.url! })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * One file per request, as the raw body — no multipart parser on our side (and
 * no new dependency): the browser sends the File as-is with its name in a
 * header, and jiraClient re-wraps it in the multipart form Jira requires.
 */
apiRouter.post(
  "/tasks/:id/attachments",
  requireProject,
  express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES }),
  async (req, res, next) => {
    try {
      req.auth!.taskService!.assertOwnKey(req.params.id);
      const data = req.body;
      if (!Buffer.isBuffer(data) || data.length === 0) throw badRequest("Tệp đính kèm rỗng.");
      const rawName = String(req.get("x-file-name") ?? "tep-dinh-kem");
      let name: string;
      try {
        name = decodeURIComponent(rawName);
      } catch {
        name = rawName;
      }
      const type = String(req.get("x-file-type") ?? "") || "application/octet-stream";
      const created = await req.auth!.jira.addAttachment(req.params.id, { name: name.slice(0, 200), type, data });
      res.status(201).json(created.map((f) => ({ id: String(f.id), filename: f.filename, size: f.size })));
    } catch (err) {
      next(err);
    }
  }
);

apiRouter.post("/tasks/:id/links", requireProject, async (req, res, next) => {
  try {
    req.auth!.taskService!.assertOwnKey(req.params.id);
    const url = String(req.body?.url ?? "").trim();
    if (!LINK_URL.test(url)) throw badRequest("Liên kết phải bắt đầu bằng http:// hoặc https://");
    const title = String(req.body?.title ?? "").trim() || url;
    const created = await req.auth!.jira.addRemoteLink(req.params.id, url, title.slice(0, 255));
    res.status(201).json({ id: String(created.id), url, title });
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
