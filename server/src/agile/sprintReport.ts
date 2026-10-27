/**
 * Sprint report and burnup, rebuilt from each issue's own changelog.
 *
 * Jira's sprint report knows what was *committed* and what was *added* mid-sprint, but that comes
 * from Greenhopper's private sprint-report endpoint, which has no public REST API. The same facts
 * are recoverable from the issues themselves: every move into or out of a sprint is a changelog
 * entry on the Sprint field. This file turns those entries into membership intervals and counts.
 *
 * Pure — no Jira calls — so the rules (who counts as committed, when a burnup step happens) are
 * testable with hand-built changelogs. `boardService.sprintReport` fetches and hands them in.
 *
 * Two honest limits, both shown on the page:
 * - weights are each issue's *current* estimate; a re-estimate mid-sprint is not replayed;
 * - an issue taken out of the sprint and never returned is no longer found by `sprint = X`, so
 *   "removed" counts only issues that left and came back.
 */

const DAY_MS = 86_400_000;

export interface ChangelogItem {
  field?: string;
  from?: string | null;
  to?: string | null;
}

export interface History {
  created: string;
  items?: ChangelogItem[];
}

export interface SprintReportIssue {
  key: string;
  summary: string;
  issueType: string;
  subtask: boolean;
  /** Current status, with its category. */
  statusName: string;
  statusCategory: "new" | "indeterminate" | "done";
  created: string;
  resolutionDate: string | null;
  /** Estimate in the board's unit; null = none (counted as 1 only when the board has no estimate field). */
  estimate: number | null;
  histories: History[];
}

export interface SprintReportInput {
  sprint: { id: number; name: string; state: "active" | "future" | "closed"; startDate: string | null; endDate: string | null; completeDate: string | null };
  issues: SprintReportIssue[];
  /** Whether the board estimates at all; when not, every issue weighs 1. */
  estimated: boolean;
  /** Minutes east of UTC — sprint days are calendar days where the team is. */
  tz: number;
  /** Local date "today", to stop the burnup at the present for a running sprint. */
  today: string;
}

export interface ReportLine {
  key: string;
  summary: string;
  issueType: string;
  statusName: string;
  statusCategory: SprintReportIssue["statusCategory"];
  weight: number;
  /** committed: in at the start · added: joined later · removed: left (and came back, or the sprint closed without it). */
  origin: "committed" | "added";
}

export interface SprintReport {
  sprint: SprintReportInput["sprint"];
  start: string | null;
  end: string | null;
  /** Everything that was in the sprint at some point during it. */
  committed: ReportLine[];
  added: ReportLine[];
  completed: ReportLine[];
  notCompleted: ReportLine[];
  /** Left the sprint and came back — scope churn worth a look. */
  churned: string[];
  totals: { committed: number; added: number; completed: number; notCompleted: number };
  /** One point per calendar day, start → min(end, today). */
  burnup: Array<{ date: string; scope: number; completed: number }>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function localDate(ms: number, tz: number): string {
  return new Date(ms + tz * 60_000).toISOString().slice(0, 10);
}

/** UTC instant of the end of local day `iso`. */
function endOfDayMs(iso: string, tz: number): number {
  return Date.parse(iso + "T00:00:00Z") + DAY_MS - tz * 60_000 - 1;
}

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);
}

/** The ids in a Sprint changelog value ("12, 13" or "12"). */
function idsOf(value: string | null | undefined): Set<string> {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/**
 * The [from, to) stretches of time the issue was in the sprint. An issue with no Sprint entry in
 * its changelog at all was in the sprint from creation (it was created there, or the field was
 * set before history began). `to` is Infinity while it is still in.
 */
export function membership(issue: SprintReportIssue, sprintId: number): Array<{ from: number; to: number }> {
  const id = String(sprintId);
  const created = Date.parse(issue.created);
  const events = issue.histories
    .flatMap((h) => (h.items ?? []).filter((i) => i.field === "Sprint").map((i) => ({ at: Date.parse(h.created), from: idsOf(i.from), to: idsOf(i.to) })))
    .filter((e) => Number.isFinite(e.at))
    .sort((a, b) => a.at - b.at);

  const intervals: Array<{ from: number; to: number }> = [];
  // Before the first Sprint entry the issue was in the sprint iff that entry says it was leaving it
  // (it had it in `from`) — or there is no entry at all and it is found by `sprint = X`, so it was in.
  let inside = events.length === 0 ? true : events[0].from.has(id);
  let since = created;
  for (const e of events) {
    const nowIn = e.to.has(id);
    if (nowIn && !inside) {
      inside = true;
      since = e.at;
    } else if (!nowIn && inside) {
      intervals.push({ from: since, to: e.at });
      inside = false;
    }
  }
  if (inside) intervals.push({ from: since, to: Infinity });
  return intervals;
}

export function buildSprintReport(input: SprintReportInput): SprintReport {
  const { sprint, tz } = input;
  const startMs = sprint.startDate ? Date.parse(sprint.startDate) : null;
  const endIso = sprint.completeDate ?? sprint.endDate;
  const endMs = endIso ? Date.parse(endIso) : null;
  const weightOf = (i: SprintReportIssue) => (input.estimated ? i.estimate ?? 0 : 1);

  // Sub-tasks travel with their parent and carry no estimate of their own on most boards.
  const issues = input.issues.filter((i) => !i.subtask);
  const rows = issues.map((issue) => ({ issue, spans: membership(issue, sprint.id) }));

  const inAt = (spans: Array<{ from: number; to: number }>, t: number) => spans.some((s) => s.from <= t && t < s.to);
  const committed: ReportLine[] = [];
  const added: ReportLine[] = [];
  const completed: ReportLine[] = [];
  const notCompleted: ReportLine[] = [];
  const churned: string[] = [];

  const line = (issue: SprintReportIssue, origin: ReportLine["origin"]): ReportLine => ({
    key: issue.key,
    summary: issue.summary,
    issueType: issue.issueType,
    statusName: issue.statusName,
    statusCategory: issue.statusCategory,
    weight: weightOf(issue),
    origin,
  });

  for (const { issue, spans } of rows) {
    if (spans.length === 0) continue;
    if (spans.length > 1) churned.push(issue.key);
    const wasThereAtStart = startMs !== null && inAt(spans, startMs);
    // With no start yet (a future sprint) nothing is "added later": everything is the plan.
    const origin: ReportLine["origin"] = startMs === null || wasThereAtStart ? "committed" : "added";
    (origin === "committed" ? committed : added).push(line(issue, origin));

    const resolved = issue.resolutionDate ? Date.parse(issue.resolutionDate) : null;
    // A running sprint has no close yet: whatever is done now counts. A closed one is judged at its close.
    const cutoff = sprint.state === "closed" ? endMs : null;
    const doneInTime = issue.statusCategory === "done" && (resolved === null || cutoff === null || resolved <= cutoff);
    (doneInTime ? completed : notCompleted).push(line(issue, origin));
  }

  // Burnup: scope = weight in the sprint at the end of each day, completed = those of them resolved by then.
  const start = startMs !== null ? localDate(startMs, tz) : null;
  const lastDay = endMs !== null ? localDate(endMs, tz) : input.today;
  const stop = lastDay < input.today || sprint.state === "closed" ? lastDay : input.today;
  const burnup: SprintReport["burnup"] = [];
  if (start && stop >= start) {
    for (let d = start; d <= stop && burnup.length < 120; d = addDays(d, 1)) {
      const t = endOfDayMs(d, tz);
      let scope = 0;
      let done = 0;
      for (const { issue, spans } of rows) {
        if (!inAt(spans, t)) continue;
        const w = weightOf(issue);
        scope += w;
        const resolved = issue.resolutionDate ? Date.parse(issue.resolutionDate) : null;
        // Done with no resolution date (a workflow without one) counts from today, so it is not invisible.
        if (issue.statusCategory === "done" && (resolved === null ? d >= input.today : resolved <= t)) done += w;
      }
      burnup.push({ date: d, scope: round1(scope), completed: round1(done) });
    }
  }

  const sum = (list: ReportLine[]) => round1(list.reduce((s, l) => s + l.weight, 0));
  return {
    sprint,
    start,
    end: endMs !== null ? localDate(endMs, tz) : null,
    committed,
    added,
    completed,
    notCompleted,
    churned,
    totals: { committed: sum(committed), added: sum(added), completed: sum(completed), notCompleted: sum(notCompleted) },
    burnup,
  };
}
