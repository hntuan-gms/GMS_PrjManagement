/**
 * Reading a whole project from Jira without waiting for it one page at a time.
 *
 * `/search/jql` pages by an opaque `nextPageToken`, so a project of 4000 issues is 41 requests
 * that cannot start before the previous one answered — about a second each, which was the entire
 * 40-second page load. A slice of the project by creation day is a query of its own, so the
 * slices run side by side and only the two or three pages inside one slice stay sequential.
 *
 * Slices are by `created`, not by issue key: key ranges (`key >= P-1 AND key <= P-300`) were
 * tried first and in production reached only 3513 of a project's 4044 issues, and neither did the
 * complement of the range — Jira simply does not match some issues by key number. Every issue has
 * a creation date, and day boundaries written as the same string on both sides of a cut partition
 * the project exactly, whatever time zone Jira reads them in.
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
/** A slice is split in two while it holds more than this: three pages of 100. */
export const SLICE_SIZE = 300;
/** Requests to Jira in flight at once (counts while planning, pages while reading). Jira answers 429 if pushed. */
export const CONCURRENCY = 6;

const DAY_MS = 86_400_000;

/** "2026-03-01" → UTC day number. */
const dayNumber = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const isoOfDay = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);

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

export interface Slice {
  /** First day, inclusive, as "yyyy-MM-dd". */
  from: string;
  /** Day after the last, exclusive. */
  to: string;
}

const sliceJql = (whole: string, s: Slice) => `${whole} AND created >= "${s.from}" AND created < "${s.to}"`;

export interface ProjectSearchResult {
  issues: any[];
  /** "parallel" when the slices were used, "sequential" otherwise (small project, or a check failed). */
  mode: "parallel" | "sequential";
  /** Slices read in parallel. */
  requests: number;
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
    const expected = await jira.countIssues(whole).catch(() => null);
    if (expected === null) return sequential("no count from Jira");
    if (expected < PARALLEL_MIN_ISSUES) return sequential(`small project (${expected} issues)`);

    // The span of creation days. Padded a day each side: the timestamps are read in one time zone
    // and the JQL below in another, so the ends must not depend on them agreeing.
    const [oldest, newest] = await Promise.all([
      jira.searchIssues(`${whole} ORDER BY created ASC`, ["created"], 1),
      jira.searchIssues(`${whole} ORDER BY created DESC`, ["created"], 1),
    ]);
    const first = createdDay(oldest[0]);
    const last = createdDay(newest[0]);
    if (!first || !last) return sequential("no creation dates");

    // Split the span in halves until each piece holds a few pages. Counts are cheap (no issue is
    // read) and the halves are counted side by side.
    const limited = limiter(CONCURRENCY);
    const plan = async (s: Slice): Promise<Slice[]> => {
      const days = dayNumber(s.to) - dayNumber(s.from);
      const count = await limited(() => jira.countIssues(sliceJql(whole, s)));
      if (count === null) throw new Error("no count for a slice");
      if (count === 0) return [];
      if (count <= SLICE_SIZE || days <= 1) return [s];
      const mid = isoOfDay(dayNumber(s.from) + Math.floor(days / 2));
      const halves = await Promise.all([plan({ from: s.from, to: mid }), plan({ from: mid, to: s.to })]);
      return halves.flat();
    };
    const slices = await plan({ from: isoOfDay(dayNumber(first) - 1), to: isoOfDay(dayNumber(last) + 2) });

    const pages = await Promise.all(
      slices.map((s) => limited(() => jira.searchIssues(`${sliceJql(whole, s)} ORDER BY created ASC`, fields)))
    );
    const issues = pages.flat();

    // Short of what Jira counts: an incomplete task list is worse than a slow one — read it the slow way.
    if (issues.length < expected) return sequential(`slices found ${issues.length} of ${expected} counted (${slices.length} slices)`);
    return { issues, mode: "parallel", requests: slices.length };
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
