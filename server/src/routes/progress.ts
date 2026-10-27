import { Router } from "express";
import { requireProject, requireStaff } from "../auth/middleware.js";
import { notFound } from "../errors.js";
import { createProgressReport } from "../ai/progressReport.js";
import { deleteReport, getReport, latestReport, reportHistory } from "../ai/reportStore.js";
import { FlowService } from "../flowReports.js";
import { computeProgress, type ProgressScope } from "../progress.js";
import { isSnapshotWorthy, listSnapshots, recordSnapshot } from "../progressSnapshotStore.js";

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

/** Short free-text query values only; anything else is ignored rather than trusted. */
function scopeFrom(query: Record<string, unknown>): ProgressScope {
  const one = (v: unknown) => (typeof v === "string" && v.trim() && v.length <= 100 ? v.trim() : undefined);
  const types =
    typeof query.type === "string"
      ? query.type
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t && t.length <= 60)
          .slice(0, 20)
      : [];
  return { assignee: one(query.assignee), epic: one(query.epic), ...(types.length > 0 ? { types } : {}) };
}

progressRouter.get("/", requireProject, async (req, res, next) => {
  const { session, taskService } = req.auth!;
  try {
    const asOf = asOfFrom(req.query.asOf);
    const scope = scopeFrom(req.query);
    const scoped = !!(scope.assignee || scope.epic || (scope.types && scope.types.length > 0));
    const [tasks, latest, history] = await Promise.all([
      // No descriptions: nothing in computeProgress reads them, and they are the heaviest field of the search.
      taskService!.listTasks({ description: false }),
      latestReport(session.cloudId, session.projectKey!),
      reportHistory(session.cloudId, session.projectKey!),
    ]);
    // The scope narrows the live dashboard only. Saved reports are written over
    // the whole project and stay that way.
    const metrics = computeProgress(tasks, asOf, scope);
    // The measured trend: today's whole-project figures are kept as a row, so the trend chart
    // needs no AI report. A failure here must never cost the page its live numbers.
    if (isSnapshotWorthy(asOf, scoped)) {
      await recordSnapshot(session.cloudId, session.projectKey!, metrics).catch((e) =>
        console.warn("[progress] could not record the daily snapshot:", e)
      );
    }
    const trend = await listSnapshots(session.cloudId, session.projectKey!).catch(() => []);
    res.json({ metrics, latest, history, trend });
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
    const [tasks, team] = await Promise.all([
      taskService!.listTasks(),
      // Best-effort: a failed member lookup costs the model some owner
      // suggestions, not the whole report.
      taskService!.listUsers().catch(() => []),
    ]);
    const { report, warnings } = await createProgressReport({
      tasks,
      cloudId: session.cloudId,
      projectKey: session.projectKey!,
      createdBy: session.accountId,
      asOf: asOfFrom((req.body as { asOf?: unknown })?.asOf),
      teamNames: team.map((u) => u.displayName),
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

// Staff only, like generating one: the report page is shared by everyone on the
// project, and guests have no business tidying away what staff paid to produce.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

progressRouter.delete("/reports/:id", requireProject, requireStaff, async (req, res, next) => {
  const { session } = req.auth!;
  try {
    if (!UUID.test(req.params.id) || !(await deleteReport(session.cloudId, session.projectKey!, req.params.id))) {
      next(notFound("Không tìm thấy báo cáo này."));
      return;
    }
    res.json({ history: await reportHistory(session.cloudId, session.projectKey!) });
  } catch (err) {
    next(err);
  }
});

progressRouter.get("/reports/:id", requireProject, async (req, res, next) => {
  const { session } = req.auth!;
  try {
    const report = !UUID.test(req.params.id) ? null : await getReport(session.cloudId, session.projectKey!, req.params.id);
    if (!report) {
      next(notFound("Không tìm thấy báo cáo này."));
      return;
    }
    res.json(report);
  } catch (err) {
    next(err);
  }
});

/**
 * Cumulative flow, control chart and created-vs-resolved over the last 30/60/90 days. Open to
 * every project member like the rest of the live report: it costs no model call, only a bounded
 * Jira read (see flowReports.ts).
 */
progressRouter.get("/flow", requireProject, async (req, res, next) => {
  const { jira, session } = req.auth!;
  try {
    const tz = Number(req.query.tz);
    const offset = Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? tz : 0;
    const service = new FlowService(jira, {
      cloudId: session.cloudId,
      projectKey: session.projectKey!,
      accountId: session.accountId,
    });
    res.json(await service.read(Number(req.query.days) || 60, offset, asOfFrom(req.query.today)));
  } catch (err) {
    next(err);
  }
});
