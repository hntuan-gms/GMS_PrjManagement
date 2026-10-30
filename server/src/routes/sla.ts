import { Router } from "express";
import { requireProject } from "../auth/middleware.js";
import { slaAdminOnly } from "../errors.js";
import { validateSlaSettings } from "../sla.js";
import { getSlaSettings, saveSlaSettings } from "../slaStore.js";

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
    const settings = validateSlaSettings(req.body);
    res.json({ settings: await saveSlaSettings(session.cloudId, session.projectKey!, session.accountId, settings), canEdit: true });
  } catch (err) {
    next(err);
  }
});
