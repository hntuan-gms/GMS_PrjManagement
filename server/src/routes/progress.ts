import { Router } from "express";
import { requireProject, requireStaff } from "../auth/middleware.js";
import { notFound } from "../errors.js";
import { createProgressReport } from "../ai/progressReport.js";
import { getReport, latestReport, reportHistory } from "../ai/reportStore.js";
import { computeProgress } from "../progress.js";

export const progressRouter = Router();

/**
 * The report page's data. Two different things with two different lifetimes:
 *
 * - **Live metrics** (GET /) are computed from the project's current tasks on
 *   every request. Free — no model call — so the numbers on the page are always
 *   today's, never a stale snapshot.
 * - **AI reports** (POST /reports) cost tokens, so they are generated only when
 *   someone asks, stored with the metrics they were written from, and dated.
 *   The page shows the latest one next to the live numbers and says when it was
 *   written, rather than silently regenerating on every visit.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Today" as the browser sees it. Server UTC is a day behind in Vietnam until
 * 07:00, which would move tasks in and out of "overdue" depending on the hour
 * someone opened the page. The client sends its local date; UTC is the fallback.
 */
function asOfFrom(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  return ISO_DATE.test(value) ? value : new Date().toISOString().slice(0, 10);
}

progressRouter.get("/", requireProject, async (req, res, next) => {
  const { session, taskService } = req.auth!;
  try {
    const asOf = asOfFrom(req.query.asOf);
    const [tasks, latest, history] = await Promise.all([
      taskService!.listTasks(),
      latestReport(session.cloudId, session.projectKey!),
      reportHistory(session.cloudId, session.projectKey!),
    ]);
    res.json({ metrics: computeProgress(tasks, asOf), latest, history });
  } catch (err) {
    next(err);
  }
});

// Staff only, like everything under /api/ai: this is the one route here that
// calls Gemini on the shared key. Live metrics and saved reports stay readable
// by guests — they cost nothing and cover only a project the guest can already
// browse in Jira (requireProject has checked that).
progressRouter.post("/reports", requireProject, requireStaff, async (req, res, next) => {
  const { session, taskService } = req.auth!;
  try {
    const tasks = await taskService!.listTasks();
    const { report, warnings } = await createProgressReport({
      tasks,
      cloudId: session.cloudId,
      projectKey: session.projectKey!,
      createdBy: session.accountId,
      asOf: asOfFrom((req.body as { asOf?: unknown })?.asOf),
    });
    res.status(201).json({
      report,
      warnings,
      history: await reportHistory(session.cloudId, session.projectKey!),
    });
  } catch (err) {
    next(err);
  }
});

progressRouter.get("/reports/:id", requireProject, async (req, res, next) => {
  const { session } = req.auth!;
  try {
    const report = await getReport(session.cloudId, session.projectKey!, req.params.id);
    if (!report) {
      next(notFound("Không tìm thấy báo cáo này."));
      return;
    }
    res.json(report);
  } catch (err) {
    next(err);
  }
});
