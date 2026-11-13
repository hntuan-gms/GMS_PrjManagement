/**
 * Names for account ids that did not come with a member list: a worklog names a
 * person by id only, and the person may belong to no project the viewer has open.
 *
 * Nothing is stored. Jira is asked once per id (GET /user/bulk) and the answer kept in memory for
 * an hour; a failure leaves the id unnamed rather than failing the page.
 */
import type { JiraClient } from "./jiraClient.js";
import type { JiraUser } from "./types.js";

const TTL_MS = 60 * 60 * 1000;
const known = new Map<string, { user: JiraUser; expiresAt: number }>();

export function rememberPeople(cloudId: string, users: readonly JiraUser[]): void {
  const expiresAt = Date.now() + TTL_MS;
  for (const u of users) known.set(`${cloudId}:${u.accountId}`, { user: u, expiresAt });
}

export async function namePeople(
  jira: JiraClient,
  cloudId: string,
  accountIds: readonly string[],
  alreadyKnown: readonly JiraUser[] = []
): Promise<Map<string, JiraUser>> {
  rememberPeople(cloudId, alreadyKnown);
  const out = new Map<string, JiraUser>();
  const missing: string[] = [];
  const now = Date.now();
  for (const id of accountIds) {
    const hit = known.get(`${cloudId}:${id}`);
    if (hit && hit.expiresAt > now) out.set(id, hit.user);
    else missing.push(id);
  }
  if (missing.length > 0) {
    try {
      const found = (await jira.getUsersBulk(missing)).map((u) => ({
        accountId: u.accountId,
        displayName: u.displayName,
        avatarUrl: u.avatarUrls?.["24x24"] ?? null,
      }));
      rememberPeople(cloudId, found);
      for (const u of found) out.set(u.accountId, u);
    } catch (err) {
      console.warn(`[people] could not name ${missing.length} account(s): ${err instanceof Error ? err.message : err}`);
    }
  }
  return out;
}
