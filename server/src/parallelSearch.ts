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

export interface SearchOptions {
  /** Page size to ask for; see JiraClient.searchIssues. */
  pageSize?: number;
  /** Called with how many issues each page really held. */
  onPage?: (issues: number) => void;
  /** Stop after this many pages. */
  maxPages?: number;
}

/** The part of JiraClient this needs, so the logic can be tested without Jira. */
export interface ProjectSearcher {
  searchIssues(jql: string, fields: string[], limit?: number, opts?: SearchOptions): Promise<any[]>;
  /** Jira's approximate count of a query's matches; null when it cannot be had. */
  countIssues(jql: string): Promise<number | null>;
}

/** Below this many issues one sequential read is as fast. */
export const PARALLEL_MIN_ISSUES = 300;
/** A slice is cut further while it holds more than this, when Jira only gives 100 per page: two pages. */
export const SLICE_SIZE = 200;
/** …and this, when Jira hands out bigger pages: one page. */
export const SLICE_SIZE_BIG_PAGES = 500;
/** The page size asked for. Jira clamps it to what it allows; the first read of a run finds out what that is. */
export const WANTED_PAGE_SIZE = 1000;
/** Counts in flight at once while planning the slices. Jira answers 429 if pushed. */
export const COUNT_CONCURRENCY = 6;
/** Page reads in flight at once; they are limited apart from the counts. */
export const READ_CONCURRENCY = 6;
/** The most pieces a slice is cut into at once. */
export const MAX_WAYS = 32;
/** Pieces are sized to hold about this share of a slice's limit, so most come out under it and need no second cut. */
const TARGET_FILL = 0.7;

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

/** How many pieces a slice of `count` issues is cut into at once: enough that each holds ~TARGET_FILL of `limit`. */
export function waysFor(count: number, limit: number): number {
  return Math.max(2, Math.min(MAX_WAYS, Math.ceil(count / Math.max(1, limit * TARGET_FILL))));
}

export interface ProjectSearchResult {
  issues: any[];
  /** "parallel" when the slices were used, "sequential" otherwise (small project, or a check failed). */
  mode: "parallel" | "sequential";
  /** Slices read in parallel. */
  requests: number;
  /** Where the time went, for the [perf] line. */
  detail?: string;
  /** Why the ordinary read was used, when the fast one was not — shown in the [perf] line. */
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
    // Four requests at once: a small project wastes three cheap ones, a big one saves their round trips.
    // The last asks for a page far bigger than 100 and reports what Jira gave — that decides how big a slice may be.
    let page = 0;
    const [expected, oldest, newest] = await Promise.all([
      named("count", () => jira.countIssues(whole)).catch(() => null),
      named("oldest", () => jira.searchIssues(`${whole} ORDER BY created ASC`, ["created"], 1)),
      named("newest", () => jira.searchIssues(`${whole} ORDER BY created DESC`, ["created"], 1)),
      named("page size", () =>
        jira.searchIssues(`${whole} ORDER BY created ASC`, fields, undefined, {
          pageSize: WANTED_PAGE_SIZE,
          maxPages: 1,
          onPage: (n) => (page = Math.max(page, n)),
        })
      ).catch(() => []),
    ]);
    if (expected === null) return sequential("no count from Jira");
    if (expected < PARALLEL_MIN_ISSUES) return sequential(`small project (${expected} issues)`);

    // The span of creation days. Padded a day each side: the timestamps are read in one time zone
    // and the JQL below in another, so the ends must not depend on them agreeing.
    const first = createdDay(oldest[0]);
    const last = createdDay(newest[0]);
    if (!first || !last) return sequential("no creation dates");

    const bigPages = page > 120;
    const sliceLimit = bigPages ? Math.min(SLICE_SIZE_BIG_PAGES, page) : SLICE_SIZE;
    const pageSize = bigPages ? WANTED_PAGE_SIZE : 100;

    // Cut the span until each piece holds a page or two. Counts are cheap (no issue is read). A piece
    // that is small enough is read AT ONCE, while the rest is still being counted.
    const counting = limiter(COUNT_CONCURRENCY);
    const reading = limiter(READ_CONCURRENCY);
    const t0 = Date.now();
    let biggest = 0;
    let counts = 0;
    const reads: Array<{ slice: Slice; issues: Promise<any[]> }> = [];
    const plan = async (s: Slice): Promise<void> => {
      const start = minuteNumber(s.from);
      const minutes = minuteNumber(s.to) - start;
      counts++;
      const count = await counting(() => named(`count ${s.from}..${s.to}`, () => jira.countIssues(sliceJql(whole, s))));
      if (count === null) throw new Error("no count for a slice");
      if (count === 0) return;
      if (count <= sliceLimit || minutes <= 1) {
        biggest = Math.max(biggest, count);
        const issues = reading(() =>
          named(`slice ${s.from}..${s.to}`, () =>
            jira.searchIssues(`${sliceJql(whole, s)} ORDER BY created ASC`, fields, undefined, { pageSize })
          )
        );
        // Settled by Promise.all below; this only stops an early failure being "unhandled" meanwhile.
        issues.catch(() => {});
        reads.push({ slice: s, issues });
        return;
      }
      // Equal cuts, none empty: fewer pieces than asked for just means the slice is a few minutes long.
      const ways = waysFor(count, sliceLimit);
      const edges = new Set<number>();
      for (let i = 0; i <= ways; i++) edges.add(start + Math.floor((minutes * i) / ways));
      const cuts = [...edges];
      await Promise.all(cuts.slice(0, -1).map((from, i) => plan({ from: stampOfMinute(from), to: stampOfMinute(cuts[i + 1]) })));
    };
    await plan({
      from: stampOfMinute(minuteNumber(first) - DAY_MIN),
      to: stampOfMinute(minuteNumber(last) + 2 * DAY_MIN),
    });
    const tPlanned = Date.now();

    // Oldest first, as the one-query read returns them; leaves finished planning in no particular order.
    reads.sort((a, b) => (a.slice.from < b.slice.from ? -1 : a.slice.from > b.slice.from ? 1 : 0));
    const issues = (await Promise.all(reads.map((r) => r.issues))).flat();
    const detail = `page ${page}, ${counts} counts planned in ${tPlanned - t0}ms, all read at ${Date.now() - t0}ms, biggest slice ${biggest}`;

    // Short of what Jira counts: an incomplete task list is worse than a slow one — read it the slow way.
    if (issues.length < expected) return sequential(`slices found ${issues.length} of ${expected} counted (${reads.length} slices; ${detail})`);
    return { issues, mode: "parallel", requests: reads.length, detail };
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
