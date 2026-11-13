/**
 * Clockwork: the hours a person logged, on every project.
 *
 * The rail's places are about a person across projects; the project timesheet (routes/timesheet.ts)
 * stays for the writes, which Jira scopes to an issue anyway. Reads here are Jira worklogs found by
 * JQL with the caller's own token, so Jira decides what they may see. Who may read a team is decided
 * by viewerRoles.ts on facts from Jira (resourceRoles.ts).
 *
 *   GET /            my worklogs, every project            everyone
 *   GET /team        the worklogs of the projects I manage  project and resource managers
 */
import { Router, type Request } from "express";
import { resolveProject } from "../auth/projectScope.js";
import { badRequest, projectNotAccessible, teamForbidden } from "../errors.js";
import { HISTORY_DAYS, summarizeHistory } from "../clockworkHistory.js";
import { issuePickJql } from "../clockworkSearch.js";
import { namePeople } from "../peopleDirectory.js";
import { getProjectMembers } from "../projectMembers.js";
import { resolveViewer } from "../resourceRoles.js";
import * as resources from "../resourceStore.js";
import { readWorklogEntries, worklogDateJql, type TimesheetPerson } from "../timesheet.js";
import type { JiraUser } from "../types.js";
import { canManage, roleOf, validateRange } from "../viewerRoles.js";

export const clockworkRouter = Router();

const KEY_SHAPE = /^[A-Za-z][A-Za-z0-9_]{1,24}$/;
const DAY_MS = 86_400_000;
const MAX_MINE_DAYS = 62;
/** A team read spans projects: a month and a bit, no more. */
const MAX_TEAM_DAYS = 35;
/** My open work, read to rank and offer as rows in "Của tôi" (one page of Jira's search). */
const MAX_OPEN_WORK = 100;

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

function shiftDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const projectOf = (issueKey: string) => issueKey.slice(0, issueKey.lastIndexOf("-"));

/** My open work, wherever it is, the most recently touched first: rows to offer, and projects worth asking about. */
function readOpenWork(jira: NonNullable<Request["auth"]>["jira"]): Promise<any[]> {
  return jira
    .searchIssues("assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC", ["summary", "issuetype", "status"], MAX_OPEN_WORK)
    .catch(() => [] as any[]);
}

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
    // One read from 30 days before the period to its end: the period's worklogs are the grid, the ones before it
    // say what I am likely to log next (clockworkHistory.ts).
    const historyFrom = shiftDays(from, -HISTORY_DAYS);
    const [read, open, profiles, absences, home] = await Promise.all([
      readWorklogEntries(jira, `worklogAuthor = currentUser() AND ${worklogDateJql(historyFrom, to)}`, historyFrom, to, tz, session.accountId),
      // What I could log on next, wherever it is. Epics included: time is logged on them (15% of it in the worklog history).
      readOpenWork(jira),
      resources.listProfiles(session.cloudId),
      resources.listAbsences(session.cloudId, from),
      homeProject(req),
    ]);
    // Other people's worklogs on the same issues come back with the search: this page is mine only.
    const mineAll = read.entries.filter((e) => e.mine);
    // Whether "Cả nhóm" is offered: does this account manage the project the tab is on, or one it works on?
    const { viewer, projects } = await resolveViewer(jira, session, [
      ...(home ? [home] : []),
      ...mineAll.map((e) => projectOf(e.issueKey)),
      ...(open as any[]).map((i) => projectOf(String(i.key))),
    ]);
    const entries = mineAll.filter((e) => e.date >= from);
    const history = summarizeHistory(mineAll.filter((e) => e.date < from));
    const capacity = new Map(profiles.map((p) => [p.accountId, p.capacityHoursPerDay]));
    const me: JiraUser = { accountId: session.accountId, displayName: session.displayName ?? "", avatarUrl: null };
    const names = new Map(projects.map((p) => [p.key, p.name]));
    const used = new Set<string>(mineAll.map((e) => projectOf(e.issueKey)));
    const openWork = (open as any[]).map((i) => ({
      key: String(i.key),
      summary: String(i.fields?.summary ?? i.key),
      issueType: String(i.fields?.issuetype?.name ?? "Task"),
      inProgress: i.fields?.status?.statusCategory?.key === "indeterminate",
    }));
    for (const w of openWork) used.add(projectOf(w.key));
    console.log(
      `[perf] clockwork mine ${historyFrom}..${to}: ${read.issueCount} issues, ${entries.length} worklogs in period, ${history.length} issues before it, ` +
        `${read.extraCalls} extra worklog calls, total ${Date.now() - t0}ms`
    );
    res.json({
      role: roleOf(viewer),
      from,
      to,
      people: [personOf(me, capacity, absences, to, false)],
      entries,
      projects: [...used].filter((k) => names.has(k)).map((k) => ({ key: k, name: names.get(k)! })),
      // Every project I can browse: "Dự án khác" offers the ones with nothing on the page.
      allProjects: projects.map((p) => ({ key: p.key, name: p.name })),
      openWork,
      history,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Issues for "+ Thêm việc", by key or title (Epics and finished work included, 20 at most). `project` is the
 * project whose "+ Thêm việc" was pressed: it narrows a title search, and with nothing typed lists what is likely
 * next there (clockworkSearch.ts).
 */
clockworkRouter.get("/issues", async (req, res, next) => {
  const { jira } = req.auth!;
  try {
    const project = typeof req.query.project === "string" ? req.query.project.trim() : "";
    const jql = issuePickJql(String(req.query.q ?? ""), project || null);
    if (!jql) {
      res.json([]);
      return;
    }
    const found = await jira.searchIssues(jql, ["summary", "issuetype", "status"], 20);
    res.json(
      (found as any[]).map((i) => ({
        key: String(i.key),
        summary: String(i.fields?.summary ?? i.key),
        issueType: String(i.fields?.issuetype?.name ?? "Task"),
        inProgress: i.fields?.status?.statusCategory?.key === "indeterminate",
        done: i.fields?.status?.statusCategory?.key === "done",
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
      // The projects worth asking about: the tab's, the one picked, and those I have work on.
      const open = await readOpenWork(jira);
      const candidates = new Set((open as any[]).map((i) => projectOf(String(i.key))));
      if (home) candidates.add(home);
      if (scopeRaw) candidates.add(scopeRaw);
      const { viewer, projects } = await resolveViewer(jira, session, candidates);
      if (roleOf(viewer) === "member") throw teamForbidden("xem giờ của cả nhóm");
      if (scopeRaw && !viewer.accessible.has(scopeRaw)) throw projectNotAccessible(scopeRaw);
      if (scopeRaw && !canManage(viewer, scopeRaw)) throw teamForbidden("xem giờ của dự án này");

      // A resource manager with no project picked reads the whole site in one search; a project manager
      // their own projects.
      const keys = scopeRaw ? [scopeRaw] : viewer.manager ? null : [...viewer.pmOf];
      const jql = `${keys ? `project in (${keys.map((k) => `"${k}"`).join(", ")}) AND ` : ""}${worklogDateJql(from, to)}`;
      const teamKey = scopeRaw || home;
      const [read, team, profiles, absences] = await Promise.all([
        readWorklogEntries(jira, jql, from, to, tz, session.accountId),
        teamKey && canManage(viewer, teamKey)
          ? getProjectMembers(jira, session.cloudId, teamKey, session.accountId).then((m) => m.users)
          : Promise.resolve([] as JiraUser[]),
        resources.listProfiles(session.cloudId),
        resources.listAbsences(session.cloudId, from),
      ]);

      const shown = new Map<string, { user: JiraUser | null; outsider: boolean }>();
      for (const u of team) shown.set(u.accountId, { user: u, outsider: false });
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
      console.log(
        `[perf] clockwork team ${keys ? keys.join(",") : "site"} ${from}..${to}: ${read.issueCount} issues, ${read.entries.length} worklogs, ` +
          `${read.extraCalls} extra worklog calls, total ${Date.now() - t0}ms`
      );
      return {
        from,
        to,
        people,
        entries: read.entries,
        projects: [...used].filter((k) => names.has(k)).map((k) => ({ key: k, name: names.get(k)! })),
        // The projects this read covered, for the picker: "Tất cả" plus each one the viewer manages.
        managed: projects.filter((p) => canManage(viewer, p.key) && (viewer.manager ? used.has(p.key) || p.key === home : true)).map((p) => ({ key: p.key, name: p.name })),
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
