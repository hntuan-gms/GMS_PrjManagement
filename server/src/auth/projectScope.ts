/**
 * Which project a request is about.
 *
 * The session cookie holds one `projectKey`, and a cookie is shared by every tab of a
 * browser: opening a second project in tab B rewrote it, so tab A's next request silently
 * ran against B's project. Each tab now says which project it means in `X-Project-Key`
 * (kept in its own sessionStorage), and the cookie is only the default for a tab that has
 * not said — a fresh tab, a login, the stand-in API.
 *
 * The header is a claim, not a grant: it is checked against the projects this account can
 * browse (the same list the picker shows), so it cannot point a request at someone else's
 * project any more than `POST /auth/project` can.
 */
import type { Request } from "express";
import type { JiraClient } from "../jiraClient.js";
import type { SessionData } from "./session.js";

export const PROJECT_HEADER = "x-project-key";

export interface ProjectRef {
  key: string;
  name: string;
}

/** Jira project keys: a letter, then letters, digits or underscores. Anything else is not even asked about. */
const KEY_SHAPE = /^[A-Za-z][A-Za-z0-9_]{1,24}$/;

/** The key a request names, or null when it names none (or something that cannot be a key). */
export function requestedProjectKey(req: { get(name: string): string | undefined }): string | null {
  const raw = req.get(PROJECT_HEADER)?.trim();
  return raw && KEY_SHAPE.test(raw) ? raw : null;
}

/**
 * The project a request runs against: the one it names if the account can browse it,
 * otherwise (nothing named) the session's own. A named project the account cannot browse
 * is `null` — never silently replaced by the cookie's, which would run the request against
 * a project the caller did not mean.
 */
export function pickProject(
  requested: string | null,
  current: ProjectRef | null,
  accessible: ProjectRef[]
): ProjectRef | null {
  if (!requested) return current;
  if (current && current.key === requested) return current;
  return accessible.find((p) => p.key === requested) ?? null;
}

const CACHE_MS = 5 * 60 * 1000;
/** A key missing from a fresh list is a refusal; from an older one, worth one more look (a project made since). */
const RELIST_AFTER_MS = 30 * 1000;

interface Listed {
  at: number;
  projects: ProjectRef[];
}
const listed = new Map<string, Listed>();
const inFlight = new Map<string, Promise<Listed>>();

async function accessibleProjects(jira: JiraClient, session: SessionData, force: boolean): Promise<Listed> {
  const id = `${session.cloudId}:${session.accountId}`;
  const hit = listed.get(id);
  if (hit && !force && Date.now() - hit.at < CACHE_MS) return hit;
  // Several requests of one page load arrive together; they share one listing.
  let pending = inFlight.get(id);
  if (!pending) {
    pending = jira
      .listProjects()
      .then((ps) => {
        const next = { at: Date.now(), projects: ps.map((p) => ({ key: p.key, name: p.name })) };
        listed.set(id, next);
        return next;
      })
      .finally(() => inFlight.delete(id));
    inFlight.set(id, pending);
  }
  return pending;
}

/**
 * Remember a listing the picker has just fetched, so the choice made a moment later does not list
 * the account's projects (~1 s of Jira) a second time to check the key is one of them.
 */
export function rememberProjectList(session: SessionData, projects: Array<{ key: string; name: string }>): void {
  listed.set(`${session.cloudId}:${session.accountId}`, {
    at: Date.now(),
    projects: projects.map((p) => ({ key: p.key, name: p.name })),
  });
}

/** The project of that key if this account can browse it: from the remembered list, relisted once if it may be stale. */
export async function findAccessibleProject(jira: JiraClient, session: SessionData, key: string): Promise<ProjectRef | null> {
  let list = await accessibleProjects(jira, session, false);
  if (!list.projects.some((p) => p.key === key) && Date.now() - list.at > RELIST_AFTER_MS) {
    list = await accessibleProjects(jira, session, true);
  }
  return list.projects.find((p) => p.key === key) ?? null;
}

/** Forget what an account may browse (logout, or a test). */
export function forgetProjectList(cloudId: string, accountId: string): void {
  listed.delete(`${cloudId}:${accountId}`);
}

export async function resolveProject(req: Request, jira: JiraClient, session: SessionData): Promise<ProjectRef | null> {
  const requested = requestedProjectKey(req);
  const current = session.projectKey ? { key: session.projectKey, name: session.projectName ?? session.projectKey } : null;
  // The cookie's own project was validated when it was chosen; nothing to ask Jira.
  if (!requested || current?.key === requested) return current;

  return findAccessibleProject(jira, session, requested);
}
