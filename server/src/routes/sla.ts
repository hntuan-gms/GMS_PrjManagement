import { Router } from "express";
import { requireProject } from "../auth/middleware.js";
import { slaAdminOnly } from "../errors.js";
import { calendarOf, slaFieldsOf, validateSlaSettings } from "../sla.js";
import { getSlaSettings, patchSlaSettings } from "../slaStore.js";

export const slaRouter = Router();

slaRouter.use(requireProject);

/**
 * Everyone who can open the project reads the policy — every SLA chip in the app
 * is computed from it. `canEdit` tells the dialog whether to offer Save; the PUT
 * enforces it again.
 *
 * Editing follows the resource tab's rule (routes/resources.ts): whoever Jira lets
 * read the project's roles, i.e. a project admin. The member list behind that
 * answer is cached per user for five minutes and warmed at login, so it costs no
 * extra Jira call; if it fails, the answer is "no" rather than an error page.
 */
slaRouter.get("/settings", async (req, res, next) => {
  const { session, taskService } = req.auth!;
  try {
    const [settings, canEdit] = await Promise.all([
      getSlaSettings(session.cloudId, session.projectKey!),
      taskService!
        .listMembers()
        .then((m) => m.rolesReadable)
        .catch(() => false),
    ]);
    res.json({ settings, canEdit });
  } catch (err) {
    next(err);
  }
});

slaRouter.put("/settings", async (req, res, next) => {
  const { session, taskService } = req.auth!;
  try {
    const members = await taskService!.listMembers();
    if (!members.rolesReadable) throw slaAdminOnly();
    // The calendar fields (working weekdays, holidays, make-up days) belong to the calendar dialog
    // (routes/calendar.ts): whatever this body says about them is replaced by what is stored, and only
    // the SLA's own fields are written, so a dialog opened before a holiday was added cannot remove it.
    const stored = await getSlaSettings(session.cloudId, session.projectKey!);
    const settings = validateSlaSettings({ ...(req.body ?? {}), ...calendarOf(stored) });
    const saved = await patchSlaSettings(session.cloudId, session.projectKey!, session.accountId, slaFieldsOf(settings));
    res.json({ settings: saved, canEdit: true });
  } catch (err) {
    next(err);
  }
});
