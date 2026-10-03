/**
 * Timesheet: who logged how many hours, on which day, against which issue.
 *
 * Jira's worklogs are the only record — there is no table of ours here, for the
 * same reason the board has none: a second copy of logged time would drift from
 * what Jira's own reports and invoicing tools read. Capacity and absences come
 * from resource_profile / resource_absence, the two things Jira has no field for.
 *
 * Days are calendar days in the *browser's* timezone (`tzOffsetMinutes`), like
 * the sprint metrics: a worklog started 08:00 in Hanoi is 01:00Z, and bucketing
 * it by UTC would still be right, but one started 06:00 local would land on the
 * previous day.
 */
import { adfToText } from "./adf.js";
import { JiraApiError, type JiraClient } from "./jiraClient.js";
import { getProjectMembers } from "./projectMembers.js";
import * as resources from "./resourceStore.js";
import { badRequest } from "./errors.js";

export interface WorklogEntry {
  id: string;
  issueKey: string;
  summary: string;
  issueType: string;
  authorAccountId: string | null;
  authorName: string;
  /** Local calendar date the work was done. */
  date: string;
  hours: number;
  comment: string | null;
  /** Logged by the viewer — the only entries the UI offers to delete. */
  mine: boolean;
}

export interface TimesheetPerson {
  accountId: string;
  displayName: string;
  avatarUrl: string | null;
  capacityHoursPerDay: number;
  absences: Array<{ from: string; to: string }>;
  /** Logged time here but isn't on the project's member list (left, or a helper from elsewhere). */
  outsider: boolean;
}

export interface Timesheet {
  from: string;
  to: string;
  people: TimesheetPerson[];
  entries: WorklogEntry[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 62;

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** UTC instant of local midnight at the start of `iso`. */
function localMidnightMs(iso: string, tz: number): number {
  return Date.parse(iso + "T00:00:00Z") - tz * 60_000;
}

function localDateOf(started: string, tz: number): string | null {
  const t = Date.parse(started);
  return Number.isNaN(t) ? null : new Date(t + tz * 60_000).toISOString().slice(0, 10);
}

/** 420 → "+0700": the offset form Jira's `started` field insists on. */
function jiraOffset(tz: number): string {
  const sign = tz >= 0 ? "+" : "-";
  const abs = Math.abs(Math.round(tz));
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}${String(abs % 60).padStart(2, "0")}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export class TimesheetService {
  constructor(
    private readonly jira: JiraClient,
    private readonly ctx: { cloudId: string; projectKey: string; accountId: string }
  ) {}

  private assertKey(key: string): void {
    if (!new RegExp(`^${this.ctx.projectKey}-\\d+$`).test(key)) {
      throw badRequest(`Chỉ ghi giờ được cho công việc của dự án ${this.ctx.projectKey}.`);
    }
  }

  async read(from: string, to: string, tz: number): Promise<Timesheet> {
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || to < from) throw badRequest("Khoảng ngày không hợp lệ.");
    if ((Date.parse(to) - Date.parse(from)) / DAY_MS > MAX_RANGE_DAYS) {
      throw badRequest(`Mỗi lần xem tối đa ${MAX_RANGE_DAYS} ngày.`);
    }
    const afterMs = localMidnightMs(from, tz);
    const beforeMs = localMidnightMs(addDays(to, 1), tz);

    // worklogDate is evaluated in the Jira profile's timezone, which need not be
    // the browser's — so the JQL is widened a day each side and the exact cut is
    // made below, on each worklog's own `started` instant.
    const jql =
      `project = "${this.ctx.projectKey}" AND worklogDate >= "${addDays(from, -1)}" ` +
      `AND worklogDate <= "${addDays(to, 1)}"`;
    const [issues, members, profiles, absences] = await Promise.all([
      this.jira.searchIssues(jql, ["summary", "issuetype", "worklog"]),
      getProjectMembers(this.jira, this.ctx.cloudId, this.ctx.projectKey, this.ctx.accountId),
      resources.listProfiles(this.ctx.cloudId),
      resources.listAbsences(this.ctx.cloudId, from),
    ]);

    const entries: WorklogEntry[] = [];
    const authors = new Map<string, { displayName: string; avatarUrl: string | null }>();
    // An issue's search hit carries at most 20 worklogs; past that, ask for the
    // window explicitly. Most issues in a week's window are under the cap.
    const perIssue = await Promise.all(
      issues.map(async (issue) => {
        const embedded = issue.fields?.worklog;
        const complete = embedded && (embedded.total ?? 0) <= (embedded.worklogs?.length ?? 0);
        const logs: any[] = complete ? embedded.worklogs : await this.jira.getWorklogs(issue.key, afterMs, beforeMs);
        return { issue, logs };
      })
    );
    for (const { issue, logs } of perIssue) {
      for (const w of logs) {
        const date = localDateOf(String(w.started ?? ""), tz);
        if (!date || date < from || date > to) continue;
        const accountId: string | null = w.author?.accountId ?? null;
        const name: string = w.author?.displayName ?? "Không rõ";
        if (accountId) authors.set(accountId, { displayName: name, avatarUrl: w.author?.avatarUrls?.["24x24"] ?? null });
        entries.push({
          id: String(w.id),
          issueKey: issue.key,
          summary: issue.fields?.summary ?? issue.key,
          issueType: issue.fields?.issuetype?.name ?? "Task",
          authorAccountId: accountId,
          authorName: name,
          date,
          hours: round2((Number(w.timeSpentSeconds) || 0) / 3600),
          comment: w.comment ? adfToText(w.comment).trim() || null : null,
          mine: accountId === this.ctx.accountId,
        });
      }
    }
    entries.sort((a, b) => (a.date === b.date ? a.issueKey.localeCompare(b.issueKey) : a.date.localeCompare(b.date)));

    const capacity = new Map(profiles.map((p) => [p.accountId, p.capacityHoursPerDay]));
    const person = (accountId: string, displayName: string, avatarUrl: string | null, outsider: boolean): TimesheetPerson => ({
      accountId,
      displayName,
      avatarUrl,
      capacityHoursPerDay: capacity.get(accountId) ?? resources.DEFAULT_CAPACITY_HOURS,
      absences: absences.filter((a) => a.accountId === accountId && a.from <= to).map((a) => ({ from: a.from, to: a.to })),
      outsider,
    });
    // Every member gets a row, logged or not: "who hasn't logged this week" is
    // half of what a timesheet is for.
    const people = members.users.map((u) => person(u.accountId, u.displayName, u.avatarUrl, false));
    const known = new Set(people.map((p) => p.accountId));
    for (const [accountId, a] of authors) {
      if (!known.has(accountId)) people.push(person(accountId, a.displayName, a.avatarUrl, true));
    }
    people.sort((a, b) => Number(a.outsider) - Number(b.outsider) || a.displayName.localeCompare(b.displayName, "vi"));

    return { from, to, people, entries };
  }

  /** Logs time as the signed-in user — Jira records the token's owner as author, always. */
  async log(input: { issueKey: string; date: string; hours: number; comment?: string | null; tz: number }): Promise<WorklogEntry> {
    this.assertKey(input.issueKey);
    if (!ISO_DATE.test(input.date)) throw badRequest("Ngày ghi giờ phải ở dạng YYYY-MM-DD.");
    const seconds = Math.round(input.hours * 3600);
    if (!Number.isFinite(seconds) || seconds < 60) throw badRequest("Số giờ phải từ 1 phút trở lên.");
    if (seconds > 24 * 3600) throw badRequest("Một lần ghi không quá 24 giờ.");
    // 09:00 local: a worklog needs a start instant, and the morning of the chosen
    // day keeps it on that day in every view, Jira's included.
    const started = `${input.date}T09:00:00.000${jiraOffset(input.tz)}`;
    let w: any;
    try {
      w = await this.jira.addWorklog(input.issueKey, { seconds, started, comment: input.comment?.trim() || null });
    } catch (err) {
      if (err instanceof JiraApiError && err.status === 400) {
        throw badRequest(`Jira không nhận ghi giờ cho ${input.issueKey}: ${err.summary || "có thể dự án chưa bật Time tracking"}.`);
      }
      throw err;
    }
    const issue = await this.jira.getIssue(input.issueKey);
    return {
      id: String(w.id),
      issueKey: input.issueKey,
      summary: issue.fields?.summary ?? input.issueKey,
      issueType: issue.fields?.issuetype?.name ?? "Task",
      authorAccountId: w.author?.accountId ?? this.ctx.accountId,
      authorName: w.author?.displayName ?? "",
      date: input.date,
      hours: round2(seconds / 3600),
      comment: input.comment?.trim() || null,
      mine: true,
    };
  }

  async remove(issueKey: string, worklogId: string): Promise<void> {
    this.assertKey(issueKey);
    await this.jira.deleteWorklog(issueKey, worklogId);
  }
}
