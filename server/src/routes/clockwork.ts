/**
 * Clockwork: the hours a person logged, on every project, beside what they were booked for.
 *
 * The rail's places are about a person across projects; the project timesheet (routes/timesheet.ts)
 * stays for the writes, which Jira scopes to an issue anyway. Reads here are Jira worklogs found by
 * JQL with the caller's own token, so Jira decides what they may see; bookings come from our table
 * through the same rules as the Booking view (booking.ts).
 *
 *   GET /            my worklogs, every project            everyone
 *   GET /team        the worklogs of the projects I manage  project and resource managers
 */
import { Router, type Request } from "express";
import { resolveProject } from "../auth/projectScope.js";
import { canWrite, roleOf, shapeForViewer, validateRange, visibleAccounts } from "../booking.js";
import * as bookings from "../bookingStore.js";
import { badRequest, bookingForbidden, projectNotAccessible } from "../errors.js";
import { issuePickJql } from "../clockworkSearch.js";
import { namePeople } from "../peopleDirectory.js";
import { getProjectMembers } from "../projectMembers.js";
import { resolveViewer } from "../resourceRoles.js";
import * as resources from "../resourceStore.js";
import { readWorklogEntries, worklogDateJql, type TimesheetPerson } from "../timesheet.js";
import type { JiraUser } from "../types.js";

export const clockworkRouter = Router();

const KEY_SHAPE = /^[A-Za-z][A-Za-z0-9_]{1,24}$/;
const DAY_MS = 86_400_000;
const MAX_MINE_DAYS = 62;
/** A team read spans projects: a month and a bit, no more. */
const MAX_TEAM_DAYS = 35;
/** Open work offered as empty rows in "Của tôi". */
const MAX_OPEN_WORK = 30;

function tzOf(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && Math.abs(n) <= 14 * 60 ? n : 0;
}

function rangeOf(req: Request, maxDays: number): { from: string; to: string } {
  const { from, to } = validateRange(req.query.from, req.query.to);
  if ((Date.parse(to) - Date.parse(from)) / DAY_MS > maxDays) throw badRequest(`Mỗi lần xem tối đa ${maxDays} ngày.`);
  return { from, to };
}

async function homeProject(req: Request): Promise<string | null> {
  const { jira, session } = req.auth!;
  try {
    return (await resolveProject(req, jira, session))?.key ?? null;
  } catch {
    return null;
  }
}

const projectOf = (issueKey: string) => issueKey.slice(0, issueKey.lastIndexOf("-"));

function personOf(
  u: JiraUser,
  capacity: Map<string, number>,
  absences: Array<{ accountId: string; from: string; to: string }>,
  to: string,
  outsider: boolean
): TimesheetPerson {
  return {
    accountId: u.accountId,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    capacityHoursPerDay: capacity.get(u.accountId) ?? resources.DEFAULT_CAPACITY_HOURS,
    absences: absences.filter((a) => a.accountId === u.accountId && a.from <= to).map((a) => ({ from: a.from, to: a.to })),
    outsider,
  };
}

clockworkRouter.get("/", async (req, res, next) => {
  const { jira, session } = req.auth!;
  try {
    const { from, to } = rangeOf(req, MAX_MINE_DAYS);
    const tz = tzOf(req.query.tz);
    const t0 = Date.now();
    const [read, open, booked, profiles, absences] = await Promise.all([
      readWorklogEntries(jira, `worklogAuthor = currentUser() AND ${worklogDateJql(from, to)}`, from, to, tz, session.accountId),
      // What I could log on next, wherever it is: my open work, the most recently touched first.
      jira
        .searchIssues("assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC", ["summary", "issuetype", "status"], MAX_OPEN_WORK)
        .catch(() => [] as any[]),
      bookings.listInRange(session.cloudId, from, to),
      resources.listProfiles(session.cloudId),
      resources.listAbsences(session.cloudId, from),
    ]);
    const mineBooked = booked.filter((b) => b.accountId === session.accountId);
    // Whether "Cả nhóm" is offered: does this account manage the project the tab is on, or one it is booked on?
    const home = await homeProject(req);
    const { viewer, projects } = await resolveViewer(jira, session, [...(home ? [home] : []), ...mineBooked.map((b) => b.projectKey)]);
    // Other people's worklogs on the same issues come back with the search: this page is mine only.
    const entries = read.entries.filter((e) => e.mine);
    const capacity = new Map(profiles.map((p) => [p.accountId, p.capacityHoursPerDay]));
    const me: JiraUser = { accountId: session.accountId, displayName: session.displayName ?? "", avatarUrl: null };
    const names = new Map(projects.map((p) => [p.key, p.name]));
    const used = new Set<string>([...entries.map((e) => projectOf(e.issueKey)), ...mineBooked.map((b) => b.projectKey)]);
    const openWork = (open as any[])
      .filter((i) => (i.fields?.issuetype?.name ?? "") !== "Epic")
      .map((i) => ({
        key: String(i.key),
        summary: String(i.fields?.summary ?? i.key),
        issueType: String(i.fields?.issuetype?.name ?? "Task"),
        inProgress: i.fields?.status?.statusCategory?.key === "indeterminate",
      }));
    for (const w of openWork) used.add(projectOf(w.key));
    console.log(
      `[perf] clockwork mine ${from}..${to}: ${read.issueCount} issues, ${entries.length} worklogs, ${read.extraCalls} extra worklog calls, total ${Date.now() - t0}ms`
    );
    res.json({
      role: roleOf(viewer),
      from,
      to,
      people: [personOf(me, capacity, absences, to, false)],
      entries,
      bookings: shapeForViewer(viewer, mineBooked, "all"),
      projects: [...used].filter((k) => names.has(k)).map((k) => ({ key: k, name: names.get(k)! })),
      openWork,
    });
  } catch (err) {
    next(err);
  }
});

/** Issues of any project by key or title, for "+ Thêm việc" (open work, no Epics, 15 at most). */
clockworkRouter.get("/issues", async (req, res, next) => {
  const { jira } = req.auth!;
  try {
    const jql = issuePickJql(String(req.query.q ?? ""));
    if (!jql) {
      res.json([]);
      return;
    }
    const found = await jira.searchIssues(jql, ["summary", "issuetype", "status"], 15);
    res.json(
      (found as any[]).map((i) => ({
        key: String(i.key),
        summary: String(i.fields?.summary ?? i.key),
        issueType: String(i.fields?.issuetype?.name ?? "Task"),
        inProgress: i.fields?.status?.statusCategory?.key === "indeterminate",
      }))
    );
  } catch (err) {
    next(err);
  }
});

// The team read is the heavy one (every managed project): the same question within half a minute is one read.
const teamCache = new Map<string, { at: number; body: Promise<unknown> }>();
const TEAM_CACHE_MS = 30 * 1000;

clockworkRouter.get("/team", async (req, res, next) => {
  const { jira, session } = req.auth!;
  try {
    const { from, to } = rangeOf(req, MAX_TEAM_DAYS);
    const tz = tzOf(req.query.tz);
    const scopeRaw = typeof req.query.project === "string" ? req.query.project.trim() : "";
    if (scopeRaw && !KEY_SHAPE.test(scopeRaw)) throw badRequest("Mã dự án không hợp lệ.");
    const home = await homeProject(req);
    const cacheKey = `${session.cloudId}:${session.accountId}:${from}:${to}:${tz}:${scopeRaw}:${home ?? ""}`;
    const hit = teamCache.get(cacheKey);
    if (hit && Date.now() - hit.at < TEAM_CACHE_MS && req.query.fresh !== "1") {
      res.json(await hit.body);
      return;
    }

    const body = (async () => {
      const t0 = Date.now();
      const all = await bookings.listInRange(session.cloudId, from, to);
      const candidates = new Set(all.map((b) => b.projectKey));
      if (home) candidates.add(home);
      if (scopeRaw) candidates.add(scopeRaw);
      const { viewer, projects } = await resolveViewer(jira, session, candidates);
      if (roleOf(viewer) === "member") throw bookingForbidden("xem giờ của cả nhóm");
      if (scopeRaw && !viewer.accessible.has(scopeRaw)) throw projectNotAccessible(scopeRaw);
      if (scopeRaw && !canWrite(viewer, scopeRaw)) throw bookingForbidden("xem giờ của dự án này");

      // A resource manager with no project picked reads the whole site in one search; a project manager
      // their own projects.
      const keys = scopeRaw ? [scopeRaw] : viewer.manager ? null : [...viewer.pmOf];
      const jql = `${keys ? `project in (${keys.map((k) => `"${k}"`).join(", ")}) AND ` : ""}${worklogDateJql(from, to)}`;
      const teamKey = scopeRaw || home;
      const [read, team, profiles, absences] = await Promise.all([
        readWorklogEntries(jira, jql, from, to, tz, session.accountId),
        teamKey && canWrite(viewer, teamKey)
          ? getProjectMembers(jira, session.cloudId, teamKey, session.accountId).then((m) => m.users)
          : Promise.resolve([] as JiraUser[]),
        resources.listProfiles(session.cloudId),
        resources.listAbsences(session.cloudId, from),
      ]);

      const inScope = (projectKey: string) => !keys || keys.includes(projectKey);
      const visible = visibleAccounts(viewer, all, team.map((u) => u.accountId));
      const shown = new Map<string, { user: JiraUser | null; outsider: boolean }>();
      for (const u of team) shown.set(u.accountId, { user: u, outsider: false });
      for (const b of all) if (inScope(b.projectKey) && !shown.has(b.accountId)) shown.set(b.accountId, { user: null, outsider: false });
      for (const [accountId, a] of read.authors) {
        if (!shown.has(accountId)) shown.set(accountId, { user: { accountId, ...a }, outsider: team.length > 0 });
      }
      if (!shown.has(session.accountId)) shown.set(session.accountId, { user: null, outsider: false });

      const named = await namePeople(
        jira,
        session.cloudId,
        [...shown].filter(([, v]) => !v.user).map(([id]) => id),
        [...shown.values()].map((v) => v.user).filter((u): u is JiraUser => !!u)
      );
      const capacity = new Map(profiles.map((p) => [p.accountId, p.capacityHoursPerDay]));
      const people = [...shown].map(([accountId, v]) =>
        personOf(v.user ?? named.get(accountId) ?? { accountId, displayName: "Không rõ", avatarUrl: null }, capacity, absences, to, v.outsider)
      );
      people.sort((a, b) => Number(a.outsider) - Number(b.outsider) || a.displayName.localeCompare(b.displayName, "vi"));

      const names = new Map(projects.map((p) => [p.key, p.name]));
      const used = new Set<string>(read.entries.map((e) => projectOf(e.issueKey)));
      const views = shapeForViewer(viewer, all, visible).filter((b) => shown.has(b.accountId));
      for (const b of views) if (b.projectKey) used.add(b.projectKey);
      console.log(
        `[perf] clockwork team ${keys ? keys.join(",") : "site"} ${from}..${to}: ${read.issueCount} issues, ${read.entries.length} worklogs, ` +
          `${read.extraCalls} extra worklog calls, total ${Date.now() - t0}ms`
      );
      return {
        from,
        to,
        people,
        entries: read.entries,
        bookings: views,
        projects: [...used].filter((k) => names.has(k)).map((k) => ({ key: k, name: names.get(k)! })),
        // The projects this read covered, for the picker: "Tất cả" plus each one the viewer manages.
        managed: projects.filter((p) => canWrite(viewer, p.key) && (viewer.manager ? used.has(p.key) || p.key === home : true)).map((p) => ({ key: p.key, name: p.name })),
      };
    })();
    teamCache.set(cacheKey, { at: Date.now(), body });
    body.catch(() => teamCache.delete(cacheKey));
    if (teamCache.size > 200) for (const [k, v] of teamCache) if (Date.now() - v.at > TEAM_CACHE_MS) teamCache.delete(k);
    res.json(await body);
  } catch (err) {
    next(err);
  }
});
