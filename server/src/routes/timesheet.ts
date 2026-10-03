import { Router, type Request } from "express";
import { requireProject } from "../auth/middleware.js";
import { TimesheetService } from "../timesheet.js";

/**
 * The Timesheet tab. Reads and writes Jira worklogs directly (see timesheet.ts);
 * open to everyone who can browse the project, since Jira shows the same
 * worklogs on every issue to the same people.
 */
export const timesheetRouter = Router();
timesheetRouter.use(requireProject);

function serviceFor(req: Request): TimesheetService {
  const { jira, session } = req.auth!;
  return new TimesheetService(jira, {
    cloudId: session.cloudId,
    projectKey: session.projectKey!,
    accountId: session.accountId,
  });
}

/** Minutes east of UTC, from the browser; Vietnam = 420. */
function tzOf(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && Math.abs(n) <= 14 * 60 ? n : 0;
}

timesheetRouter.get("/", async (req, res, next) => {
  try {
    res.json(await serviceFor(req).read(String(req.query.from ?? ""), String(req.query.to ?? ""), tzOf(req.query.tz)));
  } catch (err) {
    next(err);
  }
});

timesheetRouter.post("/worklogs", async (req, res, next) => {
  try {
    const b = req.body ?? {};
    res.status(201).json(
      await serviceFor(req).log({
        issueKey: String(b.issueKey ?? ""),
        date: String(b.date ?? ""),
        hours: Number(b.hours),
        comment: typeof b.comment === "string" ? b.comment : null,
        tz: tzOf(b.tzOffsetMinutes),
      })
    );
  } catch (err) {
    next(err);
  }
});

timesheetRouter.delete("/worklogs/:issueKey/:id", async (req, res, next) => {
  try {
    await serviceFor(req).remove(req.params.issueKey, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
