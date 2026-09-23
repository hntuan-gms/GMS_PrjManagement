/**
 * Who is on this project's team.
 *
 * `/user/assignable/search` — the only source this used to have — answers a
 * different question than it looks like it does. It returns everyone holding the
 * *Assignable User* permission, and on a company-managed site that permission is
 * granted to a site-wide group, so a five-person project lists two hundred
 * strangers. It is also capped at 100 with no paging.
 *
 * Jira's declared answer is the project's **roles** (Administrators, Members,
 * Developers...), which is what a Jira admin actually edits under "Project
 * settings → People". That is what this prefers.
 *
 * The catch, and the reason the fallback is not optional: reading project roles
 * requires the *Administer Projects* permission on that project. Every user here
 * logs in as themselves (there is no service account), so an ordinary developer
 * gets a 403 and must still see a usable list. A 403 is therefore an expected
 * outcome, not an error — it degrades to assignable users and says so in
 * `source`, so the UI can tell the user which list they are looking at.
 *
 * Cached per (cloudId, projectKey): membership changes rarely, and resolving it
 * costs one call per role plus one per group.
 */
import type { JiraClient, JiraUserLike, RoleActor } from "./jiraClient.js";
import { JiraApiError } from "./jiraClient.js";
import type { JiraUser } from "./types.js";

const TTL_MS = 5 * 60 * 1000;

export type MemberSource = "project-roles" | "assignable";

export interface ProjectMembers {
  users: JiraUser[];
  source: MemberSource;
  /** Roles that contributed, for the UI to explain where the list came from. */
  roles: string[];
  /** True when the assignable fallback may have been cut off at Jira's cap. */
  truncated: boolean;
}

const cache = new Map<string, { value: ProjectMembers; expiresAt: number }>();

/** Bots are not team members and would otherwise get a capacity row of their own. */
function isPerson(u: { accountType?: string; active?: boolean }): boolean {
  return u.accountType !== "app" && u.active !== false;
}

function toUser(u: JiraUserLike): JiraUser {
  return {
    accountId: u.accountId,
    displayName: u.displayName,
    avatarUrl: u.avatarUrls?.["24x24"] ?? null,
  };
}

/** Role URLs come back as site URLs; only the trailing id is usable here. */
function roleIdFrom(url: string): string | null {
  return /\/role\/(\d+)\s*$/.exec(url)?.[1] ?? null;
}

async function fromRoles(jira: JiraClient, projectKey: string): Promise<ProjectMembers | null> {
  const roles = await jira.getProjectRoles(projectKey);

  const byAccount = new Map<string, JiraUser>();
  const contributing: string[] = [];
  // Groups are collected across all roles first and expanded once: the same
  // group is usually an actor in several roles, and expanding it per role would
  // multiply the request count for an identical answer.
  const groupIds = new Map<string, string>();

  for (const [roleName, url] of Object.entries(roles)) {
    const roleId = roleIdFrom(url);
    if (!roleId) continue;

    let actors: RoleActor[];
    try {
      actors = (await jira.getProjectRoleActors(projectKey, roleId)).actors ?? [];
    } catch (err) {
      // One unreadable role must not lose the others.
      if (err instanceof JiraApiError && (err.status === 403 || err.status === 404)) continue;
      throw err;
    }
    if (actors.length === 0) continue;
    contributing.push(roleName);

    for (const actor of actors) {
      if (actor.actorUser?.accountId) {
        byAccount.set(actor.actorUser.accountId, {
          accountId: actor.actorUser.accountId,
          displayName: actor.displayName ?? actor.actorUser.accountId,
          avatarUrl: actor.avatarUrl ?? null,
        });
      } else if (actor.actorGroup?.groupId) {
        groupIds.set(actor.actorGroup.groupId, actor.actorGroup.displayName ?? actor.actorGroup.name ?? "");
      }
    }
  }

  for (const groupId of groupIds.keys()) {
    try {
      for (const member of await jira.getGroupMembers(groupId)) {
        if (!isPerson(member)) continue;
        // Role actors already carry a display name and avatar; a group member
        // record has the better avatar, so it wins on a re-add.
        byAccount.set(member.accountId, toUser(member));
      }
    } catch (err) {
      // Expanding a group needs "Browse users and groups" globally. Without it
      // the role's people are simply invisible — better a shorter list than a
      // failed one, and the caller's fallback covers a fully empty result.
      if (err instanceof JiraApiError && (err.status === 403 || err.status === 404)) continue;
      throw err;
    }
  }

  if (byAccount.size === 0) return null;

  const users = [...byAccount.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, "vi"));
  return { users, source: "project-roles", roles: contributing, truncated: false };
}

async function fromAssignable(jira: JiraClient, projectKey: string): Promise<ProjectMembers> {
  const raw = await jira.getAssignableUsers(projectKey);
  const users = raw
    .filter(isPerson)
    .map(toUser)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "vi"));
  return { users, source: "assignable", roles: [], truncated: raw.length >= 100 };
}

export async function getProjectMembers(
  jira: JiraClient,
  cloudId: string,
  projectKey: string
): Promise<ProjectMembers> {
  const key = `${cloudId}:${projectKey}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  let value: ProjectMembers | null = null;
  try {
    value = await fromRoles(jira, projectKey);
  } catch (err) {
    // 403 here is the ordinary case for a non-admin, so it is logged at debug
    // level rather than warned about on every single page load.
    if (!(err instanceof JiraApiError) || (err.status !== 403 && err.status !== 404)) {
      console.warn(`[projectMembers] role lookup failed for ${projectKey}:`, err);
    }
  }

  value ??= await fromAssignable(jira, projectKey);
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

/** Called after anything that could change membership; cheap and rarely needed. */
export function invalidateProjectMembers(cloudId: string, projectKey: string): void {
  cache.delete(`${cloudId}:${projectKey}`);
}
