import { Router } from "express";
import { requireProject } from "../auth/middleware.js";
import { slaAdminOnly } from "../errors.js";
import { calendarOf, validateCalendar } from "../sla.js";
import { getSlaSettings, patchSlaSettings } from "../slaStore.js";

/**
 * The project's working calendar: working weekdays, holidays, make-up days (sla.ts, WorkCalendarSettings).
 * Stored in the SLA row but read by much more than SLA — the resource heatmap, the timesheet, sprint
 * capacity and the assistant's workload (workCalendar.ts) — so it has its own dialog and its own route.
 *
 * Everyone who can open the project reads it; saving follows the SLA rule (a project admin, i.e. whoever
 * Jira lets read the project's roles), because a holiday changes everyone's numbers.
 */
export const calendarRouter = Router();

calendarRouter.use(requireProject);

calendarRouter.get("/", async (req, res, next) => {
  const { session, taskService } = req.auth!;
  try {
    const [settings, canEdit] = await Promise.all([
      getSlaSettings(session.cloudId, session.projectKey!),
      taskService!
        .listMembers()
        .then((m) => m.rolesReadable)
        .catch(() => false),
    ]);
    res.json({ calendar: calendarOf(settings), canEdit });
  } catch (err) {
    next(err);
  }
});

calendarRouter.put("/", async (req, res, next) => {
  const { session, taskService } = req.auth!;
  try {
    const members = await taskService!.listMembers();
    if (!members.rolesReadable) throw slaAdminOnly("lịch làm việc của dự án");
    // A body that leaves out a field (the hours, the timezone) keeps what is stored for it.
    const stored = await getSlaSettings(session.cloudId, session.projectKey!);
    const calendar = validateCalendar({ ...calendarOf(stored), ...(req.body ?? {}) });
    const saved = await patchSlaSettings(session.cloudId, session.projectKey!, session.accountId, calendar);
    res.json({ calendar: calendarOf(saved), canEdit: true });
  } catch (err) {
    next(err);
  }
});
