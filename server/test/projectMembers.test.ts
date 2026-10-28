import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JiraApiError, type JiraClient } from "../src/jiraClient.js";
import { getProjectMembers } from "../src/projectMembers.js";

const roleUrl = (id: number) => `https://site.atlassian.net/rest/api/3/project/P/role/${id}`;

/** A JiraClient answering only what the role lookup asks, each answer after a short delay, counting overlap. */
function fakeJira(opts: {
  roles: Record<string, number>;
  actors: Record<number, Array<{ accountId?: string; groupId?: string; name: string }>>;
  groups?: Record<string, Array<{ accountId: string; displayName: string; avatar?: string; accountType?: string }>>;
  deniedRoles?: Set<number>;
  assignable?: Array<{ accountId: string; displayName: string }>;
}) {
  let active = 0;
  let peak = 0;
  const calls: string[] = [];
  const slow = async <T>(label: string, fn: () => T): Promise<T> => {
    calls.push(label);
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 15));
    active--;
    return fn();
  };
  const jira = {
    getProjectRoles: () => slow("roles", () => Object.fromEntries(Object.entries(opts.roles).map(([n, id]) => [n, roleUrl(id)]))),
    getProjectRoleActors: (_key: string, roleId: string) =>
      slow(`role ${roleId}`, () => {
        if (opts.deniedRoles?.has(Number(roleId))) throw new JiraApiError(403, "no");
        return {
          actors: (opts.actors[Number(roleId)] ?? []).map((a) => ({
            type: a.groupId ? "atlassian-group-role-actor" : "atlassian-user-role-actor",
            displayName: a.name,
            ...(a.groupId ? { actorGroup: { groupId: a.groupId, name: a.name } } : { actorUser: { accountId: a.accountId! } }),
          })),
        };
      }),
    getGroupMembers: (groupId: string) =>
      slow(`group ${groupId}`, () =>
        (opts.groups?.[groupId] ?? []).map((m) => ({
          accountId: m.accountId,
          displayName: m.displayName,
          accountType: m.accountType ?? "atlassian",
          avatarUrls: m.avatar ? { "24x24": m.avatar } : undefined,
        }))
      ),
    getAssignableUsers: () => slow("assignable", () => (opts.assignable ?? []).map((u) => ({ ...u, accountType: "atlassian" }))),
  } as unknown as JiraClient;
  return { jira, calls, peak: () => peak };
}

let n = 0;
/** Each test its own site and account: the lookup is cached per (site, project, account). */
const ids = () => ({ cloud: `cloud-${++n}`, account: `acct-${n}` });

describe("getProjectMembers — roles and groups are asked for at once", () => {
  it("asks every role together, then every group together, and merges them", async () => {
    const { jira, peak, calls } = fakeJira({
      roles: { Administrators: 1, Developers: 2, Viewers: 3, "atlassian-addons-project-access": 9 },
      actors: {
        1: [{ accountId: "u-anh", name: "Anh" }],
        2: [{ accountId: "u-binh", name: "Bình" }, { groupId: "g1", name: "devs" }],
        3: [{ groupId: "g2", name: "viewers" }],
      },
      groups: {
        g1: [{ accountId: "u-chi", displayName: "Chi" }, { accountId: "u-bot", displayName: "Bot", accountType: "app" }],
        g2: [{ accountId: "u-dung", displayName: "Dũng" }],
      },
    });
    const { cloud, account } = ids();
    const res = await getProjectMembers(jira, cloud, "P", account);
    assert.equal(res.source, "project-roles");
    assert.deepEqual(res.users.map((u) => u.displayName), ["Anh", "Bình", "Chi", "Dũng"], "sorted by name, bots left out");
    assert.deepEqual(res.roles.sort(), ["Administrators", "Developers", "Viewers"]);
    assert.ok(!calls.some((c) => c === "role 9"), "the apps' role is never read");
    // 3 roles at once, then 2 groups at once: the old loops had a peak of 1.
    assert.ok(peak() >= 3, `peak concurrency ${peak()}`);
  });

  it("a group member's record wins over the role actor's for the same person (the better avatar)", async () => {
    const { jira } = fakeJira({
      roles: { Developers: 2 },
      actors: { 2: [{ accountId: "u-chi", name: "Chi" }, { groupId: "g1", name: "devs" }] },
      groups: { g1: [{ accountId: "u-chi", displayName: "Chi", avatar: "https://a/chi.png" }] },
    });
    const { cloud, account } = ids();
    const res = await getProjectMembers(jira, cloud, "P", account);
    assert.equal(res.users.length, 1);
    assert.equal(res.users[0].avatarUrl, "https://a/chi.png");
  });

  it("one unreadable role does not lose the others", async () => {
    const { jira } = fakeJira({
      roles: { Admin: 1, Developers: 2 },
      actors: { 2: [{ accountId: "u-binh", name: "Bình" }] },
      deniedRoles: new Set([1]),
    });
    const { cloud, account } = ids();
    const res = await getProjectMembers(jira, cloud, "P", account);
    assert.equal(res.source, "project-roles");
    assert.deepEqual(res.users.map((u) => u.displayName), ["Bình"]);
  });

  it("every role unreadable: falls back to the assignable users and says why", async () => {
    const { jira } = fakeJira({
      roles: { Admin: 1, Developers: 2 },
      actors: {},
      deniedRoles: new Set([1, 2]),
      assignable: [{ accountId: "u-x", displayName: "X" }],
    });
    const { cloud, account } = ids();
    const res = await getProjectMembers(jira, cloud, "P", account);
    assert.equal(res.source, "assignable");
    assert.equal(res.fallback?.reason, "actors-unreadable");
    assert.deepEqual(res.users.map((u) => u.displayName), ["X"]);
  });

  it("concurrent callers share one lookup (the page asks /users and /resources together)", async () => {
    const { jira, calls } = fakeJira({ roles: { Developers: 2 }, actors: { 2: [{ accountId: "u-binh", name: "Bình" }] } });
    const { cloud, account } = ids();
    const [a, b] = await Promise.all([getProjectMembers(jira, cloud, "P", account), getProjectMembers(jira, cloud, "P", account)]);
    assert.deepEqual(a, b);
    assert.equal(calls.filter((c) => c === "roles").length, 1, "the lookup ran twice");
    // And a later call is served from the cache.
    await getProjectMembers(jira, cloud, "P", account);
    assert.equal(calls.filter((c) => c === "roles").length, 1);
  });
});
