import { Router } from "express";
import { requireProject } from "../auth/middleware.js";
import { badRequest, notFound } from "../errors.js";
import { activeModel, generatePlan, layoutSchedule, listAvailableModels, toPlannerResources } from "../ai/planner.js";
import { streamChat, type ChatUsage } from "../ai/chat.js";
import * as chatStore from "../ai/chatStore.js";
import * as plans from "../ai/planStore.js";
import * as resources from "../resourceStore.js";
import type { Predecessor } from "../types.js";

export const aiRouter = Router();

/**
 * The AI planner. Every route here is mounted under the same requireAuth as the
 * rest of /api (see routes/api.ts), and adds requireProject because a plan only
 * means anything inside one project.
 *
 * Nothing the model produces reaches Jira on its own: generate writes to
 * ai_plan_item, a human edits and approves, and only /apply creates issues.
 */

/** Today in UTC, matching the date convention used everywhere on the server. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadPlan(cloudId: string, runId: string, startDate: string) {
  const run = await plans.getRun(cloudId, runId);
  if (!run) return null;
  const stored = await plans.listItems(runId);
  // Dates are derived on every read rather than stored: an edit to one task's
  // duration has to move everything downstream of it, and a stored copy would
  // silently go stale the moment the reviewer changed anything.
  return { run, items: layoutSchedule(stored, startDate) };
}

/**
 * Which Gemini models this deployment's key can call, and which one is active.
 *
 * Asked of Google on each request rather than hard-coded: model names are added
 * and retired continuously, and setting GEMINI_MODEL to one that no longer
 * exists surfaces as a 404 on the next plan, not at deploy time. No
 * requireProject — this is about the deployment, not about a project.
 */
aiRouter.get("/models", async (_req, res, next) => {
  try {
    res.json({ active: activeModel(), models: await listAvailableModels() });
  } catch (err) {
    next(err);
  }
});

aiRouter.post("/plans", requireProject, async (req, res, next) => {
  const { session, taskService } = req.auth!;
  const brief = String((req.body as { brief?: unknown })?.brief ?? "").trim();
  const startDate = String((req.body as { startDate?: unknown })?.startDate ?? "").trim() || todayIso();
  if (brief.length < 20) {
    next(badRequest("Hãy mô tả dự án chi tiết hơn (ít nhất 20 ký tự) để AI có đủ ngữ cảnh."));
    return;
  }

  let runId: string | undefined;
  try {
    runId = await plans.createRun(session.cloudId, session.projectKey!, session.accountId, brief);

    const [issueTypes, users, profiles, absences] = await Promise.all([
      taskService!.listIssueTypes(),
      taskService!.listUsers(),
      resources.profilesByAccount(session.cloudId),
      resources.absencesByAccount(session.cloudId, startDate),
    ]);

    const result = await generatePlan({
      brief,
      projectKey: session.projectKey!,
      issueTypes,
      resources: toPlannerResources(users, profiles, absences),
      startDate,
    });

    await plans.saveProposal(runId, result.items, result);
    const loaded = await loadPlan(session.cloudId, runId, startDate);
    res.status(201).json({ ...loaded, warnings: result.warnings });
  } catch (err) {
    // The run row is kept, not deleted: a failed run with its error is the only
    // way to work out afterwards why a plan never appeared.
    if (runId) await plans.failRun(runId, (err as Error).message).catch(() => {});
    next(err);
  }
});

/**
 * One assistant turn, streamed as Server-Sent Events.
 *
 * SSE rather than a JSON response because the useful part of a turn — the
 * model's reasoning, then the answer token by token — arrives over many seconds,
 * and holding it all back until the end is what makes an assistant feel broken.
 * POST (so the message body isn't a query string) means the browser uses fetch
 * and reads the stream itself rather than EventSource.
 *
 * Errors after the first byte cannot become an HTTP status — the 200 is already
 * sent — so they go down the stream as an `error` event and the client renders
 * them in the transcript.
 */
aiRouter.post("/chat", requireProject, async (req, res) => {
  const { session, taskService } = req.auth!;
  const body = req.body as { message?: unknown; sessionId?: unknown };
  const message = String(body?.message ?? "").trim();

  if (!message) {
    res.status(400).json({ error: "Tin nhắn trống." });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Cloud Run and any proxy in front of it will otherwise buffer the whole
  // response and deliver it in one lump, which defeats streaming entirely.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const sessionId = await chatStore.ensureSession(
      session.cloudId,
      session.projectKey!,
      session.accountId,
      typeof body?.sessionId === "string" ? body.sessionId : null
    );
    send("session", { sessionId });
    await chatStore.addUserMessage(sessionId, message);

    const [tasks, history] = await Promise.all([
      taskService!.listTasks(),
      chatStore.recentTurns(sessionId),
    ]);
    // The turn just stored is the one being answered; replaying it as history
    // too would show the model its own prompt twice.
    const priorTurns = history.slice(0, -1);

    let answer = "";
    let thinking = "";
    let planRunId: string | null = null;
    let usage: ChatUsage | null = null;

    const stream = streamChat(session.projectKey!, tasks, priorTurns, message, todayIso(), {
      createPlan: async (brief, startDate) => {
        const runId = await plans.createRun(session.cloudId, session.projectKey!, session.accountId, brief);
        try {
          const [issueTypes, users, profiles, absences] = await Promise.all([
            taskService!.listIssueTypes(),
            taskService!.listUsers(),
            resources.profilesByAccount(session.cloudId),
            resources.absencesByAccount(session.cloudId, startDate),
          ]);
          const result = await generatePlan({
            brief,
            projectKey: session.projectKey!,
            issueTypes,
            // Existing tasks double as the evidence for who works on what —
            // see ai/roleEvidence.ts.
            resources: toPlannerResources(users, profiles, absences, tasks),
            startDate,
          });
          await plans.saveProposal(runId, result.items, result);
          planRunId = runId;
          return {
            runId,
            itemCount: result.items.length,
            warnings: result.warnings,
            summary: `Đã dựng ${result.items.length} công việc, chờ người duyệt. Hãy nói ngắn gọn kế hoạch gồm những giai đoạn nào và nhắc người dùng bấm vào bảng để kiểm tra trước khi tạo trên Jira.`,
          };
        } catch (err) {
          await plans.failRun(runId, (err as Error).message).catch(() => {});
          throw err;
        }
      },
    });

    for await (const event of stream) {
      if (event.type === "text") answer += event.text;
      if (event.type === "thinking") thinking += event.text;
      if (event.type === "usage") usage = event.usage;
      send(event.type, event);
    }

    const messageId = await chatStore.addModelMessage(
      sessionId,
      answer,
      thinking || null,
      planRunId,
      usage ?? { promptTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0, model: activeModel() }
    );
    send("done", { messageId, usage: await chatStore.sessionUsage(sessionId) });
  } catch (err) {
    send("error", { message: (err as Error).message });
  } finally {
    res.end();
  }
});

/** Transcript of one session, for reopening the panel. */
aiRouter.get("/chat/:sessionId", requireProject, async (req, res, next) => {
  try {
    const { session } = req.auth!;
    const sessionId = await chatStore.ensureSession(
      session.cloudId,
      session.projectKey!,
      session.accountId,
      req.params.sessionId
    );
    res.json({
      sessionId,
      messages: await chatStore.listMessages(sessionId),
      usage: await chatStore.sessionUsage(sessionId),
    });
  } catch (err) {
    next(err);
  }
});

/** Token spend for this session and for the project as a whole. */
aiRouter.get("/usage", requireProject, async (req, res, next) => {
  try {
    const { session } = req.auth!;
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : null;
    res.json({
      model: activeModel(),
      session: sessionId ? await chatStore.sessionUsage(sessionId) : null,
      project: await chatStore.projectUsage(session.cloudId, session.projectKey!),
    });
  } catch (err) {
    next(err);
  }
});

aiRouter.get("/plans/:runId", requireProject, async (req, res, next) => {
  try {
    const startDate = String(req.query.startDate ?? "") || todayIso();
    const loaded = await loadPlan(req.auth!.session.cloudId, req.params.runId, startDate);
    if (!loaded) {
      next(notFound("Không tìm thấy kế hoạch này."));
      return;
    }
    res.json(loaded);
  } catch (err) {
    next(err);
  }
});

aiRouter.patch("/plans/:runId/items/:itemId", requireProject, async (req, res, next) => {
  try {
    const { runId, itemId } = req.params;
    const run = await plans.getRun(req.auth!.session.cloudId, runId);
    if (!run) {
      next(notFound("Không tìm thấy kế hoạch này."));
      return;
    }
    if (run.status !== "proposed") {
      next(badRequest("Chỉ sửa được kế hoạch đang chờ duyệt."));
      return;
    }
    const body = req.body as Record<string, unknown>;
    await plans.updateItem(runId, itemId, {
      summary: typeof body.summary === "string" ? body.summary : undefined,
      issueType: typeof body.issueType === "string" ? body.issueType : undefined,
      durationDays:
        typeof body.durationDays === "number" ? Math.max(1, Math.round(body.durationDays)) : undefined,
      assigneeAccountId:
        body.assigneeAccountId === null || typeof body.assigneeAccountId === "string"
          ? (body.assigneeAccountId as string | null)
          : undefined,
    });
    res.json(await loadPlan(req.auth!.session.cloudId, runId, todayIso()));
  } catch (err) {
    next(err);
  }
});

aiRouter.delete("/plans/:runId/items/:itemId", requireProject, async (req, res, next) => {
  try {
    await plans.deleteItem(req.params.runId, req.params.itemId);
    res.json(await loadPlan(req.auth!.session.cloudId, req.params.runId, todayIso()));
  } catch (err) {
    next(err);
  }
});

aiRouter.post("/plans/:runId/discard", requireProject, async (req, res, next) => {
  try {
    await plans.setRunStatus(req.params.runId, "discarded");
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/**
 * Approval: creates the issues for real.
 *
 * Two passes, because neither Jira nor the overlay can reference an issue that
 * doesn't exist yet. Parents are created before their children so `parent` can
 * be set, and dependencies are written only once every tempId has a real key.
 * Partial failure is reported rather than rolled back — issues already created
 * in Jira cannot be unmade here, so the response says exactly which rows landed.
 */
aiRouter.post("/plans/:runId/apply", requireProject, async (req, res, next) => {
  const { session, taskService } = req.auth!;
  try {
    const startDate = String((req.body as { startDate?: unknown })?.startDate ?? "").trim() || todayIso();
    const loaded = await loadPlan(session.cloudId, req.params.runId, startDate);
    if (!loaded) {
      next(notFound("Không tìm thấy kế hoạch này."));
      return;
    }
    if (loaded.run.status === "applied") {
      next(badRequest("Kế hoạch này đã được áp dụng rồi."));
      return;
    }

    const pending = loaded.items.filter((i) => !i.appliedIssueKey);
    const keyByTempId = new Map<string, string>(
      loaded.items.filter((i) => i.appliedIssueKey).map((i) => [i.tempId, i.appliedIssueKey!])
    );
    const created: string[] = [];
    const errors: Array<{ summary: string; message: string }> = [];

    // Parents first: an item whose parent is still unborn would lose its place in
    // the WBS, and Jira rejects a parent key that does not exist.
    const ordered = [...pending].sort((a, b) => {
      if (!a.parentTempId && b.parentTempId) return -1;
      if (a.parentTempId && !b.parentTempId) return 1;
      return a.sortOrder - b.sortOrder;
    });

    for (const item of ordered) {
      try {
        const task = await taskService!.createFromPlan({
          summary: item.summary,
          description: item.description,
          issueType: item.issueType,
          parentKey: item.parentTempId ? (keyByTempId.get(item.parentTempId) ?? null) : null,
          startDate: item.startDate,
          durationDays: item.durationDays,
          assigneeAccountId: item.assigneeAccountId,
        });
        keyByTempId.set(item.tempId, task.id);
        await plans.markItemApplied(item.id, task.id);
        created.push(task.id);
      } catch (err) {
        errors.push({ summary: item.summary, message: (err as Error).message });
      }
    }

    // Second pass: dependencies, now that tempIds resolve to real keys. An edge
    // whose endpoint failed to be created is skipped rather than guessed at.
    for (const item of loaded.items) {
      const key = keyByTempId.get(item.tempId);
      if (!key || item.dependencies.length === 0) continue;
      const predecessors: Predecessor[] = item.dependencies
        .map((dep) => ({ taskId: keyByTempId.get(dep.tempId) ?? "", type: dep.type, lagDays: dep.lagDays }))
        .filter((p) => p.taskId !== "");
      if (predecessors.length === 0) continue;
      try {
        await taskService!.setPredecessors(key, predecessors);
      } catch (err) {
        errors.push({ summary: item.summary, message: `Phụ thuộc: ${(err as Error).message}` });
      }
    }

    await plans.setRunStatus(req.params.runId, errors.length > 0 ? "proposed" : "applied");
    res.json({ created, errors });
  } catch (err) {
    next(err);
  }
});
