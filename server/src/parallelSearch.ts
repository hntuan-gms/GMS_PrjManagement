/**
 * Reading a whole project from Jira without waiting for it one page at a time.
 *
 * `/search/jql` pages by an opaque `nextPageToken`, so a project of 4000 issues is 41 requests
 * that cannot start before the previous one answered — about a second each, which was the entire
 * 40-second page load. A slice of the project by creation time is a query of its own, so the
 * slices run side by side and only the page or two inside one slice stay sequential.
 *
 * Slices are by `created`, not by issue key: key ranges (`key >= P-1 AND key <= P-300`) were
 * tried first and in production reached only 3513 of a project's 4044 issues, and neither did the
 * complement of the range — Jira simply does not match some issues by key number. Every issue has
 * a creation time, and a boundary written as the same string on both sides of a cut partitions the
 * project exactly, whatever time zone Jira reads it in. Boundaries are to the minute, the finest
 * JQL takes: a day on which a thousand issues were bulk-created would otherwise be one slice that
 * a single request chain has to read page after page.
 *
 * Small projects are read the old way: one query is already one or two round trips, and the
 * extra bookkeeping would only make them slower.
 */

/** The part of JiraClient this needs, so the logic can be tested without Jira. */
export interface ProjectSearcher {
  searchIssues(jql: string, fields: string[], limit?: number): Promise<any[]>;
  /** Jira's approximate count of a query's matches; null when it cannot be had. */
  countIssues(jql: string): Promise<number | null>;
}

/** Below this many issues one sequential read is as fast. */
export const PARALLEL_MIN_ISSUES = 300;
/** A slice is split in two while it holds more than this: two pages of 100. */
export const SLICE_SIZE = 200;
/** Requests to Jira in flight at once (counts while planning, pages while reading). Jira answers 429 if pushed. */
export const CONCURRENCY = 8;

const MINUTE_MS = 60_000;
const DAY_MIN = 1440;

/** "2026-03-01 10:30" (or a bare day) → minutes since the epoch, UTC arithmetic only. */
const minuteNumber = (stamp: string): number =>
  Math.floor(Date.parse(stamp.length > 10 ? `${stamp.replace(" ", "T")}:00Z` : `${stamp}T00:00:00Z`) / MINUTE_MS);
/** → "2026-03-01 10:30", the form JQL takes. */
const stampOfMinute = (n: number): string => new Date(n * MINUTE_MS).toISOString().slice(0, 16).replace("T", " ");

/** The day part of a Jira timestamp ("2026-03-01T10:00:00.000+0700"), as Jira itself wrote it. */
export function createdDay(issue: any): string | null {
  const created = issue?.fields?.created;
  return typeof created === "string" && /^\d{4}-\d{2}-\d{2}/.test(created) ? created.slice(0, 10) : null;
}

/** At most `limit` of the calls run at once; each call still gets its own result. */
export function limiter(limit: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  const next = () => {
    active--;
    waiting.shift()?.();
  };
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Attempts per request on a server-side (5xx) answer: Atlassian's gateway returns the odd 502 under load. */
const RETRIES_ON_5XX = 2;

/**
 * One request, named. A 5xx is tried again a couple of times; any failure that remains says WHICH
 * call it was and what Jira answered, because "Jira API error 502" alone cannot tell a bad query
 * from a busy gateway — and the only place this runs is production.
 */
export async function named<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = typeof err?.status === "number" ? err.status : 0;
      if (status >= 500 && attempt < RETRIES_ON_5XX) {
        await sleep(300 * (attempt + 1));
        continue;
      }
      const body = typeof err?.body === "string" ? err.body.replace(/\s+/g, " ").trim().slice(0, 160) : "";
      throw new Error(`${label}: ${err?.message ?? err}${body ? ` (${body})` : ""}`);
    }
  }
}

export interface Slice {
  /** First minute, inclusive, as "yyyy-MM-dd HH:mm". */
  from: string;
  /** Minute after the last, exclusive. */
  to: string;
}

const sliceJql = (whole: string, s: Slice) => `${whole} AND created >= "${s.from}" AND created < "${s.to}"`;

export interface ProjectSearchResult {
  issues: any[];
  /** "parallel" when the slices were used, "sequential" otherwise (small project, or a check failed). */
  mode: "parallel" | "sequential";
  /** Slices read in parallel. */
  requests: number;
  /** Where the time went, for the [perf] line: planning the slices, reading them, the biggest slice. */
  detail?: string;
  /** Why the ordinary read was used, when the fast one was not — shown in the [perf] log line. */
  reason?: string;
}

/**
 * Every issue of the project, oldest first. `projectKey` is already validated by the session
 * (it is interpolated into JQL exactly as `listTasks` always did).
 */
export async function searchProjectIssues(
  jira: ProjectSearcher,
  projectKey: string,
  fields: string[]
): Promise<ProjectSearchResult> {
  const whole = `project = ${projectKey}`;
  const sequential = async (reason: string): Promise<ProjectSearchResult> => ({
    issues: await jira.searchIssues(`${whole} ORDER BY created ASC`, fields),
    mode: "sequential",
    requests: 0,
    reason,
  });

  try {
    const expected = await named("count", () => jira.countIssues(whole)).catch(() => null);
    if (expected === null) return sequential("no count from Jira");
    if (expected < PARALLEL_MIN_ISSUES) return sequential(`small project (${expected} issues)`);

    // The span of creation days. Padded a day each side: the timestamps are read in one time zone
    // and the JQL below in another, so the ends must not depend on them agreeing.
    const [oldest, newest] = await Promise.all([
      named("oldest", () => jira.searchIssues(`${whole} ORDER BY created ASC`, ["created"], 1)),
      named("newest", () => jira.searchIssues(`${whole} ORDER BY created DESC`, ["created"], 1)),
    ]);
    const first = createdDay(oldest[0]);
    const last = createdDay(newest[0]);
    if (!first || !last) return sequential("no creation dates");

    // Split the span in halves until each piece holds a couple of pages. Counts are cheap (no issue
    // is read) and the halves are counted side by side.
    const limited = limiter(CONCURRENCY);
    const tPlan = Date.now();
    let biggest = 0;
    const plan = async (s: Slice): Promise<Slice[]> => {
      const minutes = minuteNumber(s.to) - minuteNumber(s.from);
      const count = await limited(() => named(`count ${s.from}..${s.to}`, () => jira.countIssues(sliceJql(whole, s))));
      if (count === null) throw new Error("no count for a slice");
      if (count === 0) return [];
      if (count <= SLICE_SIZE || minutes <= 1) {
        biggest = Math.max(biggest, count);
        return [s];
      }
      const mid = stampOfMinute(minuteNumber(s.from) + Math.floor(minutes / 2));
      const halves = await Promise.all([plan({ from: s.from, to: mid }), plan({ from: mid, to: s.to })]);
      return halves.flat();
    };
    const slices = await plan({
      from: stampOfMinute(minuteNumber(first) - DAY_MIN),
      to: stampOfMinute(minuteNumber(last) + 2 * DAY_MIN),
    });
    const tRead = Date.now();

    const pages = await Promise.all(
      slices.map((s) =>
        limited(() => named(`slice ${s.from}..${s.to}`, () => jira.searchIssues(`${sliceJql(whole, s)} ORDER BY created ASC`, fields)))
      )
    );
    const issues = pages.flat();
    const detail = `plan ${tRead - tPlan}ms, read ${Date.now() - tRead}ms, biggest slice ${biggest}`;

    // Short of what Jira counts: an incomplete task list is worse than a slow one — read it the slow way.
    if (issues.length < expected) return sequential(`slices found ${issues.length} of ${expected} counted (${slices.length} slices; ${detail})`);
    return { issues, mode: "parallel", requests: slices.length, detail };
  } catch (err) {
    // The fast path is an optimisation: if anything about it goes wrong (a query Jira will not
    // take, a rate limit that outlasted the retries) the ordinary read still has to work. An
    // expired session fails the same way there and is reported by it.
    console.warn(`[parallelSearch] ${projectKey}: falling back to the sequential read — ${(err as Error)?.message ?? err}`);
    return sequential(`fast path failed: ${(err as Error)?.message ?? err}`.slice(0, 320));
  }
}

/**
 * Concurrent callers asking for the same read share one request. A page load asks for the task
 * list and the progress figures at once, and both used to walk the whole project separately.
 * Keyed by whoever is asking as well as what, since what an account may see is its own.
 */
const inflight = new Map<string, Promise<unknown>>();

export function shareInflight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = run().finally(() => {
    if (inflight.get(key) === p) inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}
