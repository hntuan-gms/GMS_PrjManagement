import { Router, type NextFunction, type Request, type Response } from "express";
import { requireProject } from "../auth/middleware.js";
import { badRequest, resourcesAdminOnly } from "../errors.js";
import * as resources from "../resourceStore.js";

export const resourcesRouter = Router();

/**
 * Project admins only — anyone Jira lets read this project's roles.
 *
 * Not a secrecy rule first: the tab is only correct for those users. Everyone
 * else gets the assignable-users fallback, which on a company-managed site is
 * most of the licensed staff, so the tab would show them a "team" of strangers
 * and a heatmap built on it. Hiding a wrong answer beats explaining it.
 *
 * It is enforced here, not just by hiding the tab, because these routes also
 * serve absence dates (when someone is away) and accept capacity/absence writes.
 * Mounted router-wide, like requireAuth on the API router, so a route added here
 * later is covered by default. The check reuses the member list the GET needs
 * anyway, cached per user for five minutes, so it costs no extra Jira call.
 */
async function requireResourceAccess(req: Request, _res: Response, next: NextFunction) {
  try {
    const members = await req.auth!.taskService!.listMembers();
    if (!members.rolesReadable) {
      next(resourcesAdminOnly());
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}

resourcesRouter.use(requireProject, requireResourceAccess);

/**
 * The resource pool behind the "Nguồn lực" tab.
 *
 * The load itself is NOT computed here. It is a pure function of tasks the
 * client already holds (assignee, start, duration, estimate) plus the capacity
 * and absences below, so computing it server-side would mean a round trip after
 * every drag — and the whole point of the heatmap is that it recolours while the
 * bar is still under the cursor. `client/src/resourceAllocation.ts` owns it.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Everything the tab needs in one call: Jira's people, plus what we store about them. */
resourcesRouter.get("/", requireProject, async (req, res, next) => {
  const { session, taskService } = req.auth!;
  try {
    const [members, profiles, absences] = await Promise.all([
      taskService!.listMembers(),
      resources.listProfiles(session.cloudId),
      resources.listAbsences(session.cloudId),
    ]);
    res.json({
      users: members.users,
      // Where the list came from, so the tab can say so rather than leaving the
      // user to guess why a colleague is or isn't in it. "assignable" means the
      // account could not read the project's roles and this is everyone Jira
      // will let it assign — a superset, usually a large one.
      memberSource: members.source,
      // Why the role lookup failed, when it did — so the tab names the actual
      // missing piece instead of always blaming Administer Projects.
      memberFallback: members.fallback ?? null,
      memberRoles: members.roles,
      memberSkippedGroups: members.skippedGroups,
      memberTruncated: members.truncated,
      profiles,
      absences,
      defaultCapacityHours: resources.DEFAULT_CAPACITY_HOURS,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Upsert one person's capacity/role/skills.
 *
 * displayName comes from the client rather than a fresh Jira lookup: the client
 * is rendering that exact name next to the field being edited, and re-fetching
 * the whole assignable-user list to fill one NOT NULL convenience column would
 * cost a Jira round trip per keystroke-ish save.
 */
resourcesRouter.put("/:accountId", requireProject, async (req, res, next) => {
  const { session } = req.auth!;
  const body = req.body as {
    displayName?: unknown;
    role?: unknown;
    skills?: unknown;
    capacityHoursPerDay?: unknown;
    notes?: unknown;
  };

  const displayName = String(body?.displayName ?? "").trim();
  if (!displayName) {
    next(badRequest("Thiếu tên hiển thị của thành viên."));
    return;
  }

  let capacityHoursPerDay: number | undefined;
  if (body?.capacityHoursPerDay !== undefined && body.capacityHoursPerDay !== null) {
    const hours = Number(body.capacityHoursPerDay);
    // The upper bound is a sanity check, not a labour rule: a typo of 80 instead
    // of 8 would silently make an overloaded person look free for weeks.
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      next(badRequest("Công suất phải nằm trong khoảng 0 đến 24 giờ mỗi ngày."));
      return;
    }
    capacityHoursPerDay = hours;
  }

  try {
    const profile = await resources.saveProfile(session.cloudId, req.params.accountId, displayName, {
      role: typeof body?.role === "string" ? body.role.trim() || null : undefined,
      skills: Array.isArray(body?.skills)
        ? body.skills.map((s) => String(s).trim()).filter(Boolean)
        : undefined,
      capacityHoursPerDay,
      notes: typeof body?.notes === "string" ? body.notes.trim() || null : undefined,
    });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

resourcesRouter.post("/:accountId/absences", requireProject, async (req, res, next) => {
  const { session } = req.auth!;
  const body = req.body as { from?: unknown; to?: unknown; reason?: unknown };
  const from = String(body?.from ?? "");
  const to = String(body?.to ?? "");

  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    next(badRequest("Ngày nghỉ phải ở dạng YYYY-MM-DD."));
    return;
  }
  // Checked here as well as by the table's CHECK constraint, so a reversed range
  // comes back as a readable Vietnamese message instead of a 500 from Postgres.
  if (to < from) {
    next(badRequest("Ngày kết thúc phải sau hoặc bằng ngày bắt đầu."));
    return;
  }

  try {
    const absence = await resources.addAbsence(
      session.cloudId,
      req.params.accountId,
      from,
      to,
      typeof body?.reason === "string" ? body.reason.trim() || null : null
    );
    res.status(201).json(absence);
  } catch (err) {
    next(err);
  }
});

resourcesRouter.delete("/absences/:id", requireProject, async (req, res, next) => {
  try {
    await resources.deleteAbsence(req.auth!.session.cloudId, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
