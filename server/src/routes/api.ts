import { clientLogLines } from "../auth/clientLog.js";
import { parseScheduleBatch } from "../scheduleBatch.js";
import { createKeyedMutex } from "../keyedMutex.js";
import { PROJECT_HEADER } from "../auth/projectScope.js";
import type { CreateRequirements } from "../createRequirements.js";
import { cachedDetail, cachedList, forgetDetail, type ListKind } from "../detailCache.js";
import { pgDetailStore } from "../detailCacheStore.js";
import express, { Router } from "express";
import { aiRouter } from "./ai.js";
import { resourcesRouter } from "./resources.js";
import { progressRouter } from "./progress.js";
import { boardRouter } from "./board.js";
import { timesheetRouter } from "./timesheet.js";
import { clockworkRouter } from "./clockwork.js";
import { kbktRouter } from "./kbkt.js";
import { filtersRouter } from "./filters.js";
import { slaRouter } from "./sla.js";
import { calendarRouter } from "./calendar.js";
import { deferBackgroundWhenLow, requireAuth, requireProject, requireStaff } from "../auth/middleware.js";
import { confluenceLinksEnabled } from "../auth/config.js";
import { confluencePageId, isGenericTitle, linkTitle, resolvePageTitles } from "../confluenceLinks.js";
import { badRequest, notFound } from "../errors.js";
import { TaskActivity } from "../taskActivity.js";
import { TaskExtras } from "../taskExtras.js";
import type { BulkTaskCreateInput, ImportRow, TaskCreateInput, TaskUpdateInput } from "../types.js";

export const apiRouter = Router();

// Fail-closed: everything below this line requires a session. A route added later
// is protected by default. This matters because the Cloud Run service is publicly
// invokable — this middleware is the only access control in front of Jira.
apiRouter.use(requireAuth);
// A tab warmed ahead of need waits while the Jira quota is nearly spent (jiraQuota.ts).
apiRouter.use(deferBackgroundWhenLow);

// Mounted after requireAuth so the planner inherits it rather than restating it.
// requireStaff sits on the mount rather than on each AI route, for the same
// fail-closed reason requireAuth does: a route added to ai.ts later is gated by
// default instead of needing someone to remember.
apiRouter.use("/ai", requireStaff, aiRouter);

// What the browser did (a drag, Ctrl+Z, a re-read), one log line per event, beside the `access` lines: see
// auth/clientLog.ts. Nothing is stored and nothing in the body is acted on. Any signed-in person may send it.
apiRouter.post("/client-log", (req, res) => {
  const who = req.auth?.session;
  if (who) {
    const key = req.header(PROJECT_HEADER);
    for (const line of clientLogLines(who, req.body, key ?? null)) console.log(line);
  }
  res.status(204).end();
});
apiRouter.use("/resources", resourcesRouter);
apiRouter.use("/progress", progressRouter);
apiRouter.use("/board", boardRouter);
apiRouter.use("/timesheet", timesheetRouter);
apiRouter.use("/kbkt", kbktRouter);
apiRouter.use("/filters", filtersRouter);
apiRouter.use("/sla", slaRouter);
apiRouter.use("/calendar", calendarRouter);
// A site route: a person across projects, so not behind requireProject (routes/clockwork.ts).
apiRouter.use("/clockwork", clockworkRouter);

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

// The list leaves descriptions out (the heaviest field; only the edit modal reads one):
// GET /tasks/:id/description fetches it when a task is opened.
apiRouter.get("/tasks", requireProject, async (req, res, next) => {
  try {
    res.json(await req.auth!.taskService!.listTasks({ description: false }));
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/tasks/:id/description", requireProject, async (req, res, next) => {
  try {
    res.json({ description: await req.auth!.taskService!.getDescription(ownKey(req)) });
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

/**
 * A project's own list (priorities, issue types, labels, components, versions, link types): the same answer for
 * everyone who can browse the project, so it is read from Jira once per ten minutes and kept (detailCache.ts).
 * requireProject has already confirmed this user can browse the project.
 */
function listOf<T>(req: express.Request, kind: ListKind, read: () => Promise<T>): Promise<T> {
  const { cloudId, projectKey } = req.auth!.session;
  return cachedList(pgDetailStore, { cloudId, projectKey: projectKey! }, kind, read);
}

apiRouter.get("/priorities", requireProject, async (req, res, next) => {
  try {
    res.json(await listOf(req, "priorities", () => req.auth!.taskService!.listPriorities()));
  } catch (err) {
    next(err);
  }
});

/** The issue types this project really has — a plan row can only be created as one of these. */
apiRouter.get("/issue-types", requireProject, async (req, res, next) => {
  try {
    res.json(await listOf(req, "issue-types", () => req.auth!.taskService!.listIssueTypes()));
  } catch (err) {
    next(err);
  }
});

/**
 * What a new Task or Sub-task must carry in this project (`?kind=subtask|task`). Read from the create screen,
 * kept ten minutes in memory per project and kind, and never an error: unknown means "send it and let Jira say".
 */
const requirementsCache = new Map<string, { at: number; value: CreateRequirements }>();
apiRouter.get("/create-requirements", requireProject, async (req, res, next) => {
  try {
    const { cloudId, projectKey } = req.auth!.session;
    const subtask = req.query.kind === "subtask";
    const key = `${cloudId}|${projectKey}|${subtask ? "s" : "t"}`;
    const hit = requirementsCache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) {
      res.json(hit.value);
      return;
    }
    const value = await req.auth!.taskService!.createRequirements(subtask);
    requirementsCache.set(key, { at: Date.now(), value });
    res.json(value);
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/labels", requireProject, async (req, res, next) => {
  try {
    res.json(await listOf(req, "labels", () => req.auth!.taskService!.listLabels()));
  } catch (err) {
    next(err);
  }
});

apiRouter.post("/tasks", requireProject, async (req, res, next) => {
  try {
    const input = req.body as TaskCreateInput;
    if (!input.summary || !input.issueType) {
      next(badRequest("Cần nhập tên việc và loại issue."));
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
    res.json(await listOf(req, "components", () => extrasFor(req).components()));
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/versions", requireProject, async (req, res, next) => {
  try {
    res.json(await listOf(req, "versions", () => extrasFor(req).versions()));
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/link-types", requireProject, async (req, res, next) => {
  try {
    res.json(await listOf(req, "link-types", () => extrasFor(req).linkTypes()));
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
      next(badRequest("Cần nhập ít nhất một tên việc và loại issue."));
      return;
    }
    const result = await req.auth!.taskService!.createTasksBulk({ ...input, summaries });
    // The answer is 201 even when Jira refused rows (the refusals are in the body), so the access line alone
    // reads as success. Say what was refused, without the titles people typed.
    if (result.errors.length > 0) {
      const why = [...new Set(result.errors.map((e) => e.message))].join(" | ").slice(0, 300);
      console.warn(`[create] ${req.auth!.session.projectKey}: ${result.created.length} created, ${result.errors.length} refused by Jira: ${why}`);
    }
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * Change the issue type of existing issues (Jira's Move — the edit call cannot
 * cross workflows). `preview: true` writes nothing and returns the plan with the
 * status each issue would land in; without it the move runs. `statusMap` is
 * source status id → target status id, for a landing the person chose.
 */
apiRouter.post("/tasks/change-type", requireProject, async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { keys?: unknown; issueType?: unknown; statusMap?: unknown; preview?: unknown };
    const keys = Array.isArray(body.keys) ? body.keys.map(String) : [];
    const issueType = typeof body.issueType === "string" ? body.issueType.trim() : "";
    if (keys.length === 0 || !issueType) {
      next(badRequest("Cần chọn việc và loại issue mới."));
      return;
    }
    const svc = req.auth!.taskService!;
    if (body.preview === true) {
      const { plan, targetStatuses } = await svc.previewTypeChange(keys, issueType);
      res.json({ plan, targetStatuses });
      return;
    }
    const statusMap: Record<string, string> = {};
    if (body.statusMap && typeof body.statusMap === "object") {
      for (const [from, to] of Object.entries(body.statusMap as Record<string, unknown>)) {
        if (typeof to === "string") statusMap[from] = to;
      }
    }
    res.json(await svc.changeIssueType(keys, issueType, statusMap));
  } catch (err) {
    next(err);
  }
});

/**
 * Writes to one project's tasks take turns (keyedMutex.ts): a drag's cascade is several Jira calls, and one that
 * the browser abandoned (a reload) keeps running here while the batch the page sent on its way out starts.
 */
const projectWrites = createKeyedMutex();
const writeLockKey = (req: express.Request) => `${req.auth!.session.cloudId}:${req.auth!.session.projectKey}`;

/**
 * What is left in the browser's queue when the page closes, in one request that outlives the page
 * (scheduleBatch.ts). Applied in order through the same updateTask as a single PATCH; the first refusal stops
 * the rest, because a later write was drawn on top of the one that failed. The answer is for tests and logs:
 * the page that sent it is usually gone.
 */
apiRouter.post("/tasks/schedule-batch", requireProject, async (req, res, next) => {
  try {
    const parsed = parseScheduleBatch(req.body, req.auth!.session.projectKey!);
    if (!parsed.ok) {
      next(badRequest(parsed.error));
      return;
    }
    const results: { id: string; ok: boolean; error?: string }[] = [];
    await projectWrites(writeLockKey(req), async () => {
      for (const op of parsed.ops) {
        try {
          await req.auth!.taskService!.updateTask(op.id, op.patch);
          results.push({ id: op.id, ok: true });
        } catch (e) {
          results.push({ id: op.id, ok: false, error: e instanceof Error ? e.message : String(e) });
          break;
        }
      }
    });
    console.log(JSON.stringify({ severity: "INFO", kind: "schedule-batch", message: `[schedule-batch] ${results.filter((r) => r.ok).length}/${parsed.ops.length}`, results }));
    res.json({ results });
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
      next(badRequest("Ưu tiên không hợp lệ."));
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
      next(badRequest("Loại việc không hợp lệ."));
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

    const { task, cascadeWarnings, cascaded } = await projectWrites(writeLockKey(req), () => req.auth!.taskService!.updateTask(req.params.id, input));
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
  const { cloudId, projectKey, accountId } = req.auth!.session;
  return new TaskActivity(req.auth!.jira, accountId, { store: pgDetailStore, cloudId, projectKey: projectKey! });
}

/** Who is asking about which issue: what the copy's permission gate needs (detailCache.ts). */
function whoReads(req: express.Request, key: string) {
  const { cloudId, projectKey, accountId } = req.auth!.session;
  return { cloudId, projectKey: projectKey!, accountId, key };
}

/** This app changed the issue's attachments or links: what is held about them is no longer true. */
function forgetAttachments(req: express.Request, key: string): Promise<void> {
  return forgetDetail(pgDetailStore, req.auth!.session.cloudId, key, ["attachments"]);
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
    const key = req.params.id;
    // `pageId`/`generic`: a Confluence page whose Jira label ("Wiki Page") names nothing; its real name is read
    // below, per viewer, and never kept in the shared copy (confluenceLinks.ts).
    type View = {
      files: Array<{ id: string; filename: string; size: number; mimeType: string; created: string; author: string | null }>;
      links: Array<{ id: string; url: string; title: string; pageId?: string | null; generic?: boolean }>;
    };
    const view = await cachedDetail<View>(
        pgDetailStore,
        whoReads(req, key),
        "attachments",
        async () => {
          const [files, links] = await Promise.all([jira.getAttachments(key), jira.getRemoteLinks(key).catch(() => [])]);
          return {
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
              .map((l) => {
                const generic = isGenericTitle(l.object?.title, l.object!.url!);
                return { id: String(l.id), url: l.object!.url!, title: linkTitle(l, null), pageId: generic ? confluencePageId(l) : null, generic };
              }),
          };
        },
        // Every person who can see the issue sees the same files, so the answer is kept whole.
        { split: (v) => ({ data: v, restricted: false }), join: (d) => d as View }
      );
    // A copy written before pages were told apart has neither field: work them out from its title and address.
    const pages = view.links.map((l) => ((l.generic ?? isGenericTitle(l.title, l.url)) ? (l.pageId ?? confluencePageId({ object: { url: l.url } })) : null));
    const wanted = pages.filter((p): p is string => !!p);
    const names =
      wanted.length && confluenceLinksEnabled()
        ? await resolvePageTitles(wanted, req.auth!.session, (id) => jira.getConfluencePageTitle(id))
        : new Map<string, string | null>();
    res.json({
      files: view.files,
      links: view.links.map((l, i) => {
        const pageId = pages[i];
        // No title passed: linkTitle then falls back to the address, or "Trang Confluence <id>".
        const title = pageId ? linkTitle({ object: { url: l.url }, globalId: `pageId=${pageId}` }, names.get(pageId)) : l.title;
        return { id: l.id, url: l.url, title };
      }),
    });
  } catch (err) {
    next(err);
  }
});

/** Raster images are the only thing shown inline; Jira's SVG would run script on our origin. */
const INLINE_IMAGE = /^image\/(png|jpe?g|gif|webp)$/i;
const MAX_PREVIEW_BYTES = 30 * 1024 * 1024;

/** The attachment, only if it belongs to this issue — an id alone would reach any issue on the site. */
async function ownAttachment(req: express.Request) {
  req.auth!.taskService!.assertOwnKey(req.params.id);
  const attId = String(req.params.attId);
  if (!/^\d{1,12}$/.test(attId)) throw notFound("Không tìm thấy tệp đính kèm.");
  const file = (await req.auth!.jira.getAttachments(req.params.id)).find((f) => String(f.id) === attId);
  if (!file) throw notFound("Không tìm thấy tệp đính kèm trên việc này.");
  return file;
}

/**
 * A file's bytes, for the detail window's preview and download. Proxied because Jira's own
 * content URL needs a Jira browser session, not our token. Shown inline only for raster images
 * (`?inline=1`); everything else is a download, sandboxed and never sniffed.
 */
apiRouter.get("/tasks/:id/attachments/:attId/content", requireProject, async (req, res, next) => {
  try {
    const file = await ownAttachment(req);
    if (file.size > MAX_PREVIEW_BYTES) throw badRequest("Tệp quá lớn để mở ở đây — hãy mở trên Jira.");
    const data = await req.auth!.jira.getAttachmentContent(String(file.id));
    const inline = req.query.inline === "1" && INLINE_IMAGE.test(file.mimeType);
    res.setHeader("Content-Type", inline ? file.mimeType : "application/octet-stream");
    res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(data);
  } catch (err) {
    next(err);
  }
});

apiRouter.delete("/tasks/:id/attachments/:attId", requireProject, async (req, res, next) => {
  try {
    const file = await ownAttachment(req);
    await req.auth!.jira.deleteAttachment(String(file.id));
    await forgetAttachments(req, req.params.id);
    res.status(204).end();
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
      await forgetAttachments(req, req.params.id);
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
    await forgetAttachments(req, req.params.id);
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
    const tasks = await req.auth!.taskService!.listTasks({ description: false });
    res.json({ syncedAt: new Date().toISOString(), count: tasks.length, tasks });
  } catch (err) {
    next(err);
  }
});
