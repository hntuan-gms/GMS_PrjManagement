/**
 * Reading a whole project from Jira without waiting for it one page at a time.
 *
 * `/search/jql` pages by an opaque `nextPageToken`, so a project of 4000 issues is 41 requests
 * that cannot start before the previous one answered — about a second each, which was the entire
 * 40-second page load. A key range (`key >= X-1 AND key <= X-300`) is a query of its own, so the
 * ranges run side by side and only the three or four pages inside one range stay sequential.
 *
 * Small projects are read the old way: one query is already one or two round trips, and the
 * extra "what is the newest key" call would only make them slower.
 */

/** The part of JiraClient this needs, so the logic can be tested without Jira. */
export interface ProjectSearcher {
  searchIssues(jql: string, fields: string[], limit?: number): Promise<any[]>;
  /** Jira's approximate count of a query's matches; null when it cannot be had. */
  countIssues(jql: string): Promise<number | null>;
}

/** Below this many issues (by highest key) one sequential read is as fast. */
export const PARALLEL_MIN_ISSUES = 300;
/** Issues per range: three pages of 100 — enough to amortise a request, small enough to fan out. */
export const RANGE_SIZE = 300;
/** Ranges in flight at once. Jira's rate limiter answers 429 (and JiraClient retries) if pushed. */
export const RANGE_CONCURRENCY = 6;

export interface KeyRange {
  from: number;
  to: number;
}

/** [1..size], [size+1..2·size], … up to and including `max`. */
export function keyRanges(max: number, size = RANGE_SIZE): KeyRange[] {
  const ranges: KeyRange[] = [];
  for (let from = 1; from <= max; from += size) ranges.push({ from, to: Math.min(max, from + size - 1) });
  return ranges;
}

/** "ABC-123" → 123; null for anything else. */
export function issueNumber(key: unknown): number | null {
  const m = typeof key === "string" ? key.match(/-(\d+)$/) : null;
  return m ? Number(m[1]) : null;
}

/** Runs `worker` over `items`, at most `limit` at a time, keeping the results in input order. */
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}

export interface ProjectSearchResult {
  issues: any[];
  /** "parallel" when the key ranges were used, "sequential" otherwise (small project, or a check failed). */
  mode: "parallel" | "sequential";
  requests: number;
  /** Why the ordinary read was used, when the fast one was not — shown in the [perf] log line. */
  reason?: string;
}

/**
 * Every issue of the project, ordered by key. `projectKey` is already validated by the session
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
    // The newest key tells how far the numbers go; the count is what the result is checked against.
    const [newest, expected] = await Promise.all([
      jira.searchIssues(`${whole} ORDER BY key DESC`, ["summary"], 1),
      jira.countIssues(whole).catch(() => null),
    ]);
    const max = issueNumber(newest[0]?.key);
    if (max === null) return sequential(`no newest key (${newest[0]?.key ?? "none"})`);
    if (expected === null) return sequential("no count from Jira");
    if (max < PARALLEL_MIN_ISSUES) return sequential(`small project (max key ${max})`);

    const ranges = keyRanges(max);
    const pages = await mapLimit(ranges, RANGE_CONCURRENCY, (r) =>
      jira.searchIssues(`${whole} AND key >= ${projectKey}-${r.from} AND key <= ${projectKey}-${r.to} ORDER BY key ASC`, fields)
    );
    const issues = pages.flat();

    // Key ranges find an issue by its number under the project's current key. An issue Jira still
    // holds under an older key (a renamed project) would be missed — so a short result is not
    // trusted, and the slow, complete read is used instead.
    if (issues.length < expected) return sequential(`ranges found ${issues.length} of ${expected} counted (max key ${max})`);
    return { issues, mode: "parallel", requests: ranges.length };
  } catch (err) {
    // The fast path is an optimisation: if anything about it goes wrong (a query Jira will not
    // take, a rate limit that outlasted the retries) the ordinary read still has to work. An
    // expired session fails the same way there and is reported by it.
    console.warn(`[parallelSearch] ${projectKey}: falling back to the sequential read — ${(err as Error)?.message ?? err}`);
    return sequential(`fast path failed: ${(err as Error)?.message ?? err}`.slice(0, 200));
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
