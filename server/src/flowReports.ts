import { badRequest } from "./errors.js";
import {
  addDays,
  controlStats,
  createdVsResolved,
  cumulativeFlow,
  cycleTimes,
  eachDate,
  rollingMean,
  toFlowIssue,
  type ControlStats,
  type CumulativeFlow,
  type CyclePoint,
  type FlowBucket,
  type FlowStatus,
  type StatusCategory,
} from "./flowMetrics.js";
import type { JiraClient } from "./jiraClient.js";

/**
 * The flow charts (cumulative flow, control chart, created vs resolved) for one project.
 *
 * One Jira search with `expand=changelog` feeds all three. That is the expensive part — each
 * issue carries its history — so it is bounded three ways: a window of at most 90 days, at most
 * FLOW_LIMIT issues (and the response says when it was cut), and a ten-minute memory cache per
 * (site, account, project, window). Calling an issue at a time instead would be N+1 against a
 * rate-limited API.
 */

export const FLOW_DAYS = [30, 60, 90] as const;
const FLOW_LIMIT = 1000;
const TTL_MS = 10 * 60_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface FlowReport {
  from: string;
  to: string;
  days: number;
  issueCount: number;
  /** The search hit the cap, so the oldest-created open work may be missing. */
  truncated: boolean;
  cfd: CumulativeFlow;
  created: { bucket: "day" | "week"; buckets: FlowBucket[] };
  control: {
    points: CyclePoint[];
    lead: ControlStats | null;
    cycle: ControlStats | null;
    /** Moving average aligned to `points`; `cycleRolling` is null where an issue has no cycle time. */
    leadRolling: number[];
    cycleRolling: Array<number | null>;
  };
}

const cache = new Map<string, { at: number; report: FlowReport }>();

function category(key: string | undefined): StatusCategory {
  return key === "done" ? "done" : key === "indeterminate" ? "indeterminate" : "new";
}

export class FlowService {
  constructor(
    private readonly jira: JiraClient,
    private readonly ctx: { cloudId: string; projectKey: string; accountId: string }
  ) {}

  async read(days: number, tz: number, today: string): Promise<FlowReport> {
    if (!(FLOW_DAYS as readonly number[]).includes(days)) throw badRequest("Chỉ xem được 30, 60 hoặc 90 ngày.");
    if (!ISO_DATE.test(today)) throw badRequest("Ngày không hợp lệ.");
    const cacheKey = `${this.ctx.cloudId}:${this.ctx.accountId}:${this.ctx.projectKey}:${days}:${tz}:${today}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.report;

    const t0 = Date.now();
    const to = today;
    const from = addDays(today, -(days - 1));
    // Open work, plus whatever finished inside the window (one day wider than it, for timezones).
    const jql =
      `project = "${this.ctx.projectKey}" AND (statusCategory != Done OR resolutiondate >= "${addDays(from, -1)}") ORDER BY created DESC`;
    const [raw, statuses] = await Promise.all([
      this.jira.searchIssues(jql, ["created", "resolutiondate", "status"], FLOW_LIMIT + 1, { expand: "changelog" }),
      this.statuses(),
    ]);
    const truncated = raw.length > FLOW_LIMIT;
    const issues = raw
      .slice(0, FLOW_LIMIT)
      .map(toFlowIssue)
      .filter((i): i is NonNullable<typeof i> => i !== null);

    const points = cycleTimes(issues, statuses, from, to, tz);
    const cycleValues = points.map((p) => p.cycleDays).filter((v): v is number => v !== null);
    const cycleRollingValues = rollingMean(cycleValues);
    let seen = 0;
    const bucket = days <= 30 ? "day" : "week";
    const report: FlowReport = {
      from,
      to,
      days,
      issueCount: issues.length,
      truncated,
      cfd: cumulativeFlow(issues, statuses, eachDate(from, to), tz),
      created: { bucket, buckets: createdVsResolved(issues, from, to, tz, bucket) },
      control: {
        points,
        lead: controlStats(points.map((p) => p.leadDays)),
        cycle: controlStats(cycleValues),
        leadRolling: rollingMean(points.map((p) => p.leadDays)),
        cycleRolling: points.map((p) => (p.cycleDays === null ? null : cycleRollingValues[seen++])),
      },
    };
    cache.set(cacheKey, { at: Date.now(), report });
    console.log(
      `[perf] flow ${this.ctx.projectKey} ${days}d: ${issues.length} issues${truncated ? " (truncated)" : ""}, total ${Date.now() - t0}ms`
    );
    return report;
  }

  private async statuses(): Promise<FlowStatus[]> {
    const byType = await this.jira.getProjectStatuses(this.ctx.projectKey);
    const seen = new Map<string, FlowStatus>();
    for (const type of byType) {
      for (const s of type.statuses ?? []) {
        if (!seen.has(s.id)) seen.set(s.id, { id: String(s.id), name: s.name, category: category(s.statusCategory?.key) });
      }
    }
    return [...seen.values()];
  }
}
