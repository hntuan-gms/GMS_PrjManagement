/**
 * Request authentication. Mounted with `apiRouter.use(requireAuth)` so the design
 * is fail-closed: a route added later is protected by default rather than needing
 * to remember an opt-in. That matters more than usual here, because the Cloud Run
 * service is publicly invokable and this middleware is the only access control.
 */
import type { NextFunction, Request, Response } from "express";
import { AtlassianAuthError } from "./atlassian.js";
import { authRequired, noProjectSelected } from "../errors.js";
import { getStartDateFieldId, startDateFieldOverride } from "../fieldDiscovery.js";
import { JiraClient } from "../jiraClient.js";
import { TaskService } from "../taskService.js";
import { clearAuthCookies } from "./cookies.js";
import { commitAccess, commitSession, readAccess, readSession, type SessionData } from "./session.js";
import { ensureAccessToken } from "./tokens.js";

export interface RequestAuth {
  session: SessionData;
  accessToken: string;
  jira: JiraClient;
  /** Only present once a project has been chosen (i.e. behind requireProject). */
  taskService: TaskService | null;
  startDateFieldId: string | null;
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
    // res.json() is a silent no-op, and losing a rotated refresh token logs the
    // user out on their next request with no way to diagnose why.
    const result = await ensureAccessToken(session, readAccess(req, session));
    if (result.rotated) {
      commitSession(res, result.session);
      commitAccess(res, result.access);
    }

    let currentToken = result.accessToken;
    const jira = new JiraClient({
      cloudId: result.session.cloudId,
      getAccessToken: () => currentToken,
      onUnauthorized: async () => {
        // Safety net for a token that dies mid-request (clock skew, admin revoke).
        // Headers are still open here because every route ends in a single json().
        const retry = await ensureAccessToken(result.session, null);
        currentToken = retry.accessToken;
        commitSession(res, retry.session);
        commitAccess(res, retry.access);
        return retry.accessToken;
      },
    });

    const startDateFieldId =
      startDateFieldOverride() ?? (await getStartDateFieldId(jira, result.session.cloudId));

    req.auth = {
      session: result.session,
      accessToken: result.accessToken,
      jira,
      taskService: null,
      startDateFieldId,
    };
    next();
  } catch (err) {
    if (err instanceof AtlassianAuthError && err.isDeadGrant) {
      clearAuthCookies(res);
      next(authRequired());
      return;
    }
    next(err);
  }
}

/** Adds the project-bound TaskService. Apply to /tasks, /users, /sync. */
export function requireProject(req: Request, _res: Response, next: NextFunction): void {
  const auth = req.auth;
  if (!auth) {
    next(authRequired());
    return;
  }
  if (!auth.session.projectKey) {
    next(noProjectSelected());
    return;
  }
  auth.taskService = new TaskService(auth.jira, {
    cloudId: auth.session.cloudId,
    siteUrl: auth.session.siteUrl,
    projectKey: auth.session.projectKey,
    startDateFieldId: auth.startDateFieldId,
  });
  next();
}
