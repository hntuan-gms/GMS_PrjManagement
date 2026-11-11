/**
 * Who is who for booking and Clockwork: resource manager, project manager, member.
 *
 * Both answers are delegated to Jira, like login itself (ALLOWED_SITE_HOSTS): nobody keeps a list
 * of managers in this app.
 *  - A project manager is someone Jira lets read the project's roles (Administer Projects), the same
 *    test the Resource lens, SLA and the working calendar already use.
 *  - A resource manager belongs to the Jira group named in RESOURCE_MANAGER_GROUP, or is listed by
 *    account id in RESOURCE_MANAGER_ACCOUNT_IDS (semicolons). With neither set nobody has the role
 *    and project managers still book their own projects.
 *
 * Both are remembered briefly per account: they are asked on every booking read.
 */
import { decideManager, parseIdList, type Viewer } from "./booking.js";
import { JiraApiError, type JiraClient } from "./jiraClient.js";
import { listAccessibleProjects, type ProjectRef } from "./auth/projectScope.js";
import type { SessionData } from "./auth/session.js";

const MANAGER_TTL_MS = 10 * 60 * 1000;
const ADMIN_TTL_MS = 5 * 60 * 1000;
/** An unexplained failure is "no" for a minute, not for five: it may be Jira having a moment. */
const ADMIN_ERROR_TTL_MS = 60 * 1000;
/** A person on very many booked projects is checked on the first of them; the rest read as not managed. */
const MAX_ADMIN_CHECKS = 30;

function managerConfig(): { ids: string[]; group: string | null } {
  return {
    ids: parseIdList(process.env.RESOURCE_MANAGER_ACCOUNT_IDS),
    group: process.env.RESOURCE_MANAGER_GROUP?.trim() || null,
  };
}

const managers = new Map<string, { value: boolean; expiresAt: number }>();
const admins = new Map<string, { value: boolean; expiresAt: number }>();
const adminInFlight = new Map<string, Promise<boolean>>();

export async function isResourceManager(jira: JiraClient, session: Pick<SessionData, "cloudId" | "accountId">): Promise<boolean> {
  const cfg = managerConfig();
  if (cfg.ids.length === 0 && !cfg.group) return false;
  if (decideManager(session.accountId, null, cfg)) return true;
  if (!cfg.group) return false;

  const id = `${session.cloudId}:${session.accountId}`;
  const hit = managers.get(id);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  let value = false;
  try {
    value = decideManager(session.accountId, await jira.getMyGroups(), cfg);
  } catch (err) {
    // Fail closed, and say so once per window: a missing scope here would otherwise look like
    // "the group is configured and nobody is in it".
    console.warn(`[booking] could not read the groups of ${session.accountId}: ${err instanceof Error ? err.message : err}`);
  }
  managers.set(id, { value, expiresAt: Date.now() + MANAGER_TTL_MS });
  return value;
}

/** Does Jira let this account administer the project? One request, shared by concurrent askers. */
export async function isProjectAdmin(jira: JiraClient, cloudId: string, accountId: string, projectKey: string): Promise<boolean> {
  const id = `${cloudId}:${accountId}:${projectKey}`;
  const hit = admins.get(id);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  let pending = adminInFlight.get(id);
  if (!pending) {
    pending = jira
      .getProjectRoles(projectKey)
      .then(() => {
        admins.set(id, { value: true, expiresAt: Date.now() + ADMIN_TTL_MS });
        return true;
      })
      .catch((err) => {
        const refused = err instanceof JiraApiError && (err.status === 401 || err.status === 403 || err.status === 404);
        admins.set(id, { value: false, expiresAt: Date.now() + (refused ? ADMIN_TTL_MS : ADMIN_ERROR_TTL_MS) });
        return false;
      })
      .finally(() => adminInFlight.delete(id));
    adminInFlight.set(id, pending);
  }
  return pending;
}

export interface ResolvedViewer {
  viewer: Viewer;
  /** The projects the account can browse, for names. */
  projects: ProjectRef[];
}

/**
 * The viewer for one request. `candidates` are the projects worth asking "do you manage this?"
 * about: those with bookings in the window, plus the one the tab is on. A resource manager is not
 * asked at all.
 */
export async function resolveViewer(
  jira: JiraClient,
  session: SessionData,
  candidates: Iterable<string>
): Promise<ResolvedViewer> {
  const [manager, projects] = await Promise.all([isResourceManager(jira, session), listAccessibleProjects(jira, session)]);
  const accessible = new Set(projects.map((p) => p.key));
  const pmOf = new Set<string>();
  if (!manager) {
    const keys = [...new Set(candidates)].filter((k) => accessible.has(k)).slice(0, MAX_ADMIN_CHECKS);
    const answers = await Promise.all(keys.map((k) => isProjectAdmin(jira, session.cloudId, session.accountId, k)));
    keys.forEach((k, i) => {
      if (answers[i]) pmOf.add(k);
    });
  }
  return { viewer: { accountId: session.accountId, manager, pmOf, accessible }, projects };
}

/** Tests only. */
export function forgetRoles(): void {
  managers.clear();
  admins.clear();
}
