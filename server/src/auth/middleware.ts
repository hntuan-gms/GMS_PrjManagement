/**
 * Request authentication. Mounted with `apiRouter.use(requireAuth)` so the design
 * is fail-closed: a route added later is protected by default rather than needing
 * to remember an opt-in. That matters more than usual here, because the Cloud Run
 * service is publicly invokable and this middleware is the only access control.
 */
import type { NextFunction, Request, Response } from "express";
import { AtlassianAuthError } from "./atlassian.js";
import { authRequired, noProjectSelected, projectNotAccessible, staffOnly } from "../errors.js";
import { getSprintFieldId, getStartDateFieldId, startDateFieldOverride } from "../fieldDiscovery.js";
import { JiraClient } from "../jiraClient.js";
import { applyWriteToCache } from "../issueCacheStore.js";
import { noteLimited, noteNearLimit, quotaView } from "../jiraQuota.js";
import { TaskService } from "../taskService.js";
import { clearAuthCookies } from "./cookies.js";
import { deleteRefreshToken } from "./refreshTokenStore.js";
import { requestedProjectKey, resolveProject } from "./projectScope.js";
import { commitAccess, readAccess, readSession, type SessionData } from "./session.js";
import { ensureAccessToken } from "./tokens.js";

export interface RequestAuth {
  session: SessionData;
  accessToken: string;
  jira: JiraClient;
  /** Only present once a project has been chosen (i.e. behind requireProject). */
  taskService: TaskService | null;
  startDateFieldId: string | null;
  sprintFieldId: string | null;
}

/**
 * Authenticates and refreshes, but does not require a project. Used by /api/auth/*
 * and the project picker, which must work before a project exists.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = readSession(req);
  if (!session) {
    next(authRequired());
    return;
  }

  try {
    // Refresh eagerly, here, before the route writes anything: res.cookie() after
    // res.json() is a silent no-op, and losing a rotated access token logs the
    // user out on their next request with no way to diagnose why. The refresh
    // token itself rotating no longer touches gms_sess at all — it's persisted
    // straight to Postgres (auth/refreshTokenStore.ts) — so only gms_at is ever
    // recommitted here.
    const result = await ensureAccessToken(session, readAccess(req, session));
    if (result.rotated) {
      commitAccess(res, result.access);
    }

    let currentToken = result.accessToken;
    const jira = new JiraClient({
      cloudId: session.cloudId,
      getAccessToken: () => currentToken,
      onUnauthorized: async () => {
        // Safety net for a token that dies mid-request (clock skew, admin revoke).
        // Headers are still open here because every route ends in a single json().
        const retry = await ensureAccessToken(session, null);
        currentToken = retry.accessToken;
        commitAccess(res, retry.access);
        return retry.accessToken;
      },
      // Every write this user makes marks the issue cache, so the refresh after it is not stale.
      onWrite: (write) => applyWriteToCache(session.cloudId, session.accountId, write),
      // The app's quota is shared by everyone: what one request hears, every instance acts on.
      onRateSignal: (signal) =>
        signal.kind === "near"
          ? noteNearLimit(session.cloudId, signal.reason)
          : noteLimited(session.cloudId, signal.retryAfterSec ?? 0, signal.reason),
    });

    const startDateFieldId =
      startDateFieldOverride() ?? (await getStartDateFieldId(jira, session.cloudId));

    // One /field call serves both lookups (each caches per site for an hour).
    const sprintFieldId = await getSprintFieldId(jira, session.cloudId);

    req.auth = {
      session,
      accessToken: result.accessToken,
      jira,
      taskService: null,
      startDateFieldId,
      sprintFieldId,
    };
    next();
  } catch (err) {
    if (err instanceof AtlassianAuthError && err.isDeadGrant) {
      clearAuthCookies(res);
      // The grant is confirmed dead — a leftover row would just be a permanently
      // unusable secret sitting in the table. Best-effort: this must not turn a
      // clean "please log in again" into a 500.
      void deleteRefreshToken(session.cloudId, session.accountId).catch(() => {});
      next(authRequired());
      return;
    }
    next(err);
  }
}

/**
 * Adds the project-bound TaskService. Apply to /tasks, /users, /sync.
 *
 * The project is the one this request's tab names (`X-Project-Key`), falling back to the
 * session's. From here on `auth.session.projectKey` is that project for every route, so
 * two tabs on two projects never see each other's.
 */
export async function requireProject(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = req.auth;
  if (!auth) {
    next(authRequired());
    return;
  }
  try {
    const project = await resolveProject(req, auth.jira, auth.session);
    if (!project) {
      next(requestedProjectKey(req) ? projectNotAccessible(requestedProjectKey(req)!) : noProjectSelected());
      return;
    }
    auth.session = { ...auth.session, projectKey: project.key, projectName: project.name };
    auth.taskService = new TaskService(auth.jira, {
      cloudId: auth.session.cloudId,
      accountId: auth.session.accountId,
      siteUrl: auth.session.siteUrl,
      projectKey: project.key,
      startDateFieldId: auth.startDateFieldId,
      sprintFieldId: auth.sprintFieldId,
    });
    // Whatever this route answers from the issue copy because Jira refused for rate, the browser is told
    // (X-Jira-Limited: seconds until Jira said to come back) so the page can say its data may lag.
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      const sec = auth.taskService?.lastRead?.limitedForSec;
      if (sec && !res.headersSent) res.setHeader("X-Jira-Limited", String(Math.ceil(sec)));
      return json(body);
    };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * A request the browser makes ahead of need (`X-GMS-Background: 1` — a tab warmed before it is
 * opened) is turned away while the Jira quota is nearly spent: the tab asks for itself when it is
 * opened, and what is left of the quota goes to what people are actually doing.
 */
export async function deferBackgroundWhenLow(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.get("x-gms-background") !== "1" || !req.auth) {
    next();
    return;
  }
  const quota = await quotaView(req.auth.session.cloudId);
  if (!quota.deferBackground) {
    next();
    return;
  }
  res.status(503).json({ error: "Jira sắp hết hạn mức truy cập; tab sẽ tải khi được mở.", code: "JIRA_BUDGET_DEFERRED" });
}

/**
 * Internal staff only. Guarding the AI routes rather than the login gate is what
 * lets external guests use everything else: the assistant and planner call Gemini
 * on a shared key, so an unbounded audience is a cost and data-exposure surface
 * that the Jira-backed features simply aren't.
 */
export function requireStaff(req: Request, _res: Response, next: NextFunction): void {
  const auth = req.auth;
  if (!auth) {
    next(authRequired());
    return;
  }
  if (!auth.session.staff) {
    next(staffOnly());
    return;
  }
  next();
}
