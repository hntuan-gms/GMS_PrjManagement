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
 * Cached per (cloudId, projectKey, accountId): membership changes rarely, and
 * resolving it costs one call per role plus one per group.
 */
import type { JiraClient, JiraUserLike, RoleActor } from "./jiraClient.js";
import { JiraApiError } from "./jiraClient.js";
import type { JiraUser } from "./types.js";

const TTL_MS = 5 * 60 * 1000;
/**
 * An "error" result (network, 5xx) is cached briefly instead: rolesReadable
 * gates the whole resource tab now, and a five-minute cache of one Jira blip
 * would lock a project admin out of it for five minutes.
 */
const ERROR_TTL_MS = 30 * 1000;

export type MemberSource = "project-roles" | "assignable";

/**
 * Why the role lookup produced nothing usable. Each of these used to collapse
 * into the same bare `null`, and the UI then blamed *Administer Projects* for
 * all of them — sending a user who plainly had that permission off to check
 * the one screen that was already right.
 */
export type FallbackReason =
  /** GET /project/{key}/role itself was refused: the permission really is missing. */
  | "roles-forbidden"
  /** Roles listed, but every role's actor list was refused. */
  | "actors-unreadable"
  /** Actors were only groups, and the user's Jira permissions hid their members. */
  | "groups-unreadable"
  /**
   * Actors were only groups, and the app's OAuth token lacks the scope to list
   * group members (GET /group/member needs manage:jira-configuration). No Jira
   * permission fixes this — only a scope change in the app, plus re-consent.
   */
  | "groups-out-of-scope"
  /** Everything was readable; the roles simply contain no people. */
  | "roles-empty"
  /** Anything else — network, 5xx, an unexpected status. Logged as a warning. */
  | "error";

export interface MemberFallback {
  reason: FallbackReason;
  /** HTTP status of the call that decided it, when there was one. */
  status?: number;
}

export interface ProjectMembers {
  users: JiraUser[];
  source: MemberSource;
  /** Roles that contributed, for the UI to explain where the list came from. */
  roles: string[];
  /** True when the assignable fallback may have been cut off at Jira's cap. */
  truncated: boolean;
  /**
   * Role groups whose members could not be listed, when source is still
   * "project-roles" — the list is then only the individually-added people, and
   * the UI must say so rather than present a partial team as the whole one.
   */
  skippedGroups: number;
  /**
   * Jira answered GET /project/{key}/role for this user — i.e. they hold
   * Administer Projects here. False for a refusal, and also for an unexplained
   * error (fail closed: it gates the resource tab, which is only accurate when
   * the roles are readable). True even when a later step failed and the list
   * fell back anyway — those are app or project-setup problems, not the user's.
   */
  rolesReadable: boolean;
  /** Present exactly when source is "assignable": what made the role lookup fail. */
  fallback?: MemberFallback;
}

type RolesResult = { ok: true; members: ProjectMembers } | { ok: false; fallback: MemberFallback };

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

/**
 * The role Jira creates by itself to give installed Marketplace apps project
 * access. Every app's bot account is added to it individually, so on a site
 * with a few dozen apps it contributes a few dozen "members" named things like
 * "Automation for Jira" — and role actors carry no accountType, so isPerson()
 * can't catch them the way it catches bots inside groups. It never holds a
 * person, so it is skipped outright rather than read and filtered.
 */
const APP_ACCESS_ROLE = "atlassian-addons-project-access";

/** Role URLs come back as site URLs; only the trailing id is usable here. */
function roleIdFrom(url: string): string | null {
  return /\/role\/(\d+)\s*$/.exec(url)?.[1] ?? null;
}

/** A refusal, not a failure. Includes Jira's 401 flavour — see configRefused. */
function isDenied(err: unknown): err is JiraApiError {
  return err instanceof JiraApiError && (err.status === 403 || err.status === 404 || err.configRefused);
}

async function fromRoles(jira: JiraClient, projectKey: string): Promise<RolesResult> {
  let roles: Record<string, string>;
  try {
    roles = await jira.getProjectRoles(projectKey);
  } catch (err) {
    if (isDenied(err)) return { ok: false, fallback: { reason: "roles-forbidden", status: err.status } };
    throw err;
  }

  const byAccount = new Map<string, JiraUser>();
  const contributing: string[] = [];
  // Groups are collected across all roles first and expanded once: the same
  // group is usually an actor in several roles, and expanding it per role would
  // multiply the request count for an identical answer.
  const groupIds = new Map<string, string>();

  let rolesTried = 0;
  let rolesDenied = 0;
  let lastActorStatus: number | undefined;

  for (const [roleName, url] of Object.entries(roles)) {
    if (roleName === APP_ACCESS_ROLE) continue;
    const roleId = roleIdFrom(url);
    if (!roleId) continue;
    rolesTried++;

    let actors: RoleActor[];
    try {
      actors = (await jira.getProjectRoleActors(projectKey, roleId)).actors ?? [];
    } catch (err) {
      // One unreadable role must not lose the others.
      if (isDenied(err)) {
        rolesDenied++;
        lastActorStatus = err.status;
        continue;
      }
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

  let groupsDenied = 0;
  let groupsOutOfScope = 0;
  let lastGroupStatus: number | undefined;
  for (const groupId of groupIds.keys()) {
    try {
      for (const member of await jira.getGroupMembers(groupId)) {
        if (!isPerson(member)) continue;
        // Role actors already carry a display name and avatar; a group member
        // record has the better avatar, so it wins on a re-add.
        byAccount.set(member.accountId, toUser(member));
      }
    } catch (err) {
      // Two ways a group stays closed, both skipped rather than thrown: the
      // user lacks "Browse users and groups" (403/404), or the app's token lacks
      // manage:jira-configuration (401 "scope does not match"). The second used
      // to be rethrown, which discarded the WHOLE role lookup — including people
      // added to roles individually who had already been collected above.
      if (err instanceof JiraApiError && err.scopeProblem) {
        groupsOutOfScope++;
        lastGroupStatus = err.status;
        continue;
      }
      if (isDenied(err)) {
        groupsDenied++;
        lastGroupStatus = err.status;
        continue;
      }
      throw err;
    }
  }
  const skippedGroups = groupsDenied + groupsOutOfScope;

  if (byAccount.size === 0) {
    // Most specific explanation first: which step actually lost the people.
    if (rolesTried > 0 && rolesDenied === rolesTried) {
      return { ok: false, fallback: { reason: "actors-unreadable", status: lastActorStatus } };
    }
    if (groupIds.size > 0 && skippedGroups === groupIds.size) {
      return {
        ok: false,
        fallback: {
          reason: groupsOutOfScope > 0 ? "groups-out-of-scope" : "groups-unreadable",
          status: lastGroupStatus,
        },
      };
    }
    return { ok: false, fallback: { reason: "roles-empty" } };
  }

  const users = [...byAccount.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, "vi"));
  return {
    ok: true,
    members: {
      users,
      source: "project-roles",
      roles: contributing,
      truncated: false,
      skippedGroups,
      rolesReadable: true,
    },
  };
}

async function fromAssignable(
  jira: JiraClient,
  projectKey: string,
  fallback: MemberFallback
): Promise<ProjectMembers> {
  const raw = await jira.getAssignableUsers(projectKey);
  const users = raw
    .filter(isPerson)
    .map(toUser)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "vi"));
  return {
    users,
    source: "assignable",
    roles: [],
    truncated: raw.length >= 100,
    skippedGroups: 0,
    rolesReadable: fallback.reason !== "roles-forbidden" && fallback.reason !== "error",
    fallback,
  };
}

function pruneExpired(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

export async function getProjectMembers(
  jira: JiraClient,
  cloudId: string,
  projectKey: string,
  accountId: string
): Promise<ProjectMembers> {
  // Keyed by the viewer too. This used to be (cloudId, projectKey) alone, and
  // with every user sharing one Cloud Run instance that meant whoever loaded the
  // tab first after expiry decided the list for everyone for five minutes — so
  // a colleague without Administer Projects getting there first served their
  // 403 fallback to a project admin, whose own lookup would have succeeded.
  // (It also leaked the other way: role data read with admin rights, served to
  // accounts Jira would have refused.)
  const key = `${cloudId}:${projectKey}:${accountId}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  let value: ProjectMembers;
  let result: RolesResult;
  try {
    result = await fromRoles(jira, projectKey);
  } catch (err) {
    console.warn(`[projectMembers] role lookup failed for ${projectKey}:`, err);
    result = {
      ok: false,
      fallback: { reason: "error", status: err instanceof JiraApiError ? err.status : undefined },
    };
  }

  if (result.ok) {
    value = result.members;
  } else {
    // One line per cache fill (per user, per project, per five minutes), so
    // Cloud Run logs show the real reason without warning on every page load.
    // A 403 on roles is the ordinary case for a non-admin, hence log not warn.
    console.log(
      `[projectMembers] ${projectKey}: roles unavailable (${result.fallback.reason}` +
        `${result.fallback.status ? `, HTTP ${result.fallback.status}` : ""}), using assignable users`
    );
    value = await fromAssignable(jira, projectKey, result.fallback);
  }

  pruneExpired(now);
  const ttl = value.fallback?.reason === "error" ? ERROR_TTL_MS : TTL_MS;
  cache.set(key, { value, expiresAt: now + ttl });
  return value;
}

/** Called after anything that could change membership: drops every viewer's copy. */
export function invalidateProjectMembers(cloudId: string, projectKey: string): void {
  const prefix = `${cloudId}:${projectKey}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
