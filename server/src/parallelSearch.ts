/**
 * Reading a whole project from Jira without waiting for it one page at a time.
 *
 * `/search/jql` pages by an opaque `nextPageToken`, so a project of 4000 issues is 41 requests
 * that cannot start before the previous one answered — about a second each, which was the entire
 * 40-second page load. Two ways to break that chain, tried in this order:
 *
 *  1. **By id.** Ask for the project's issue ids alone — Jira hands out far bigger pages when
 *     only the id is requested (and then returns nothing else, not even the key), so the whole
 *     list is one or two requests — then read the issues in groups of 100 ids (`id in (…)`), all
 *     groups at once. The groups are cut from the list itself, so nothing can fall between them,
 *     and there is nothing to count.
 *  2. **By creation time.** If Jira pages the id list at 100 too (so listing it would be the
 *     very chain being avoided), the project is cut by `created`, to the minute, into slices of
 *     a page or two each, counted with `search/approximate-count`, and the slices run together.
 *
 * Both are verified against Jira's own count, and anything unexpected — a refused query, a short
 * result, a rate limit that outlasted the retries — falls back to the ordinary single query, with
 * the reason in the `[perf]` line. An incomplete task list is worse than a slow one.
 *
 * Why not key RANGES (`key >= P-1 AND key <= P-300`): tried first, they reached 3513 of a
 * project's 4044 issues in production, and so did the complement — Jira does not match some
 * issues by key number. And why `created` slices are cut by an explicit time rather than halved:
 * halving cost one round of counts per level, about twenty from a year down to a dense minute.
 *
 * Small projects are read the old way: one query is already one or two round trips.
 */

export interface SearchOptions {
  /** Page size to ask for; see JiraClient.searchIssues. */
  pageSize?: number;
  /** Called with how many issues each page really held; returning `false` stops paging. */
  onPage?: (issues: number) => boolean | void;
}

/** The part of JiraClient this needs, so the logic can be tested without Jira. */
export interface ProjectSearcher {
  searchIssues(jql: string, fields: string[], limit?: number, opts?: SearchOptions): Promise<any[]>;
  /** Jira's approximate count of a query's matches; null when it cannot be had. */
  countIssues(jql: string): Promise<number | null>;
}

/** Below this many issues one sequential read is as fast. */
export const PARALLEL_MIN_ISSUES = 300;
/** The page size asked for when listing ids; Jira clamps it to what it allows. */
export const ID_PAGE_SIZE = 5000;
/** Ids per `id in (…)` read: one page of full issues. */
export const ID_CHUNK = 100;
/** Page reads in flight at once. Jira answers 429 if pushed (JiraClient retries those). */
export const READ_CONCURRENCY = 16;
/** Counts in flight at once while planning time slices. */
export const COUNT_CONCURRENCY = 6;
/** A time slice is cut further while it holds more than this: two pages of 100. */
export const SLICE_SIZE = 200;
/** The most pieces a slice is cut into at once. */
export const MAX_WAYS = 32;
/** Pieces are sized to hold about this share of the limit, so most come out under it and need no second cut. */
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

/** Consecutive groups of at most `size`. */
export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface ProjectSearchResult {
  issues: any[];
  /** "parallel" when one of the fast ways was used, "sequential" otherwise (small project, or a check failed). */
  mode: "parallel" | "sequential";
  /** Requests made to read the issues themselves. */
  requests: number;
  /** Which fast way and where the time went, for the [perf] line. */
  detail?: string;
  /** Why the ordinary read was used, when the fast one was not — shown in the [perf] line. */
  reason?: string;
}

/** A way that does not apply is `null` with a reason; one that fails throws; one that works returns the issues. */
type Attempt = { issues: any[]; requests: number; detail: string } | { skip: string };

/** Way 1: list the ids, then read them in groups, all groups at once. */
async function readByIds(jira: ProjectSearcher, whole: string, fields: string[], expected: number): Promise<Attempt> {
  const t0 = Date.now();
  let page = 0;
  let clamped = false;
  const listed = await named("ids", () =>
    jira.searchIssues(`${whole} ORDER BY created ASC`, ["id"], undefined, {
      pageSize: ID_PAGE_SIZE,
      onPage: (n) => {
        page = Math.max(page, n);
        // A page of 100 or fewer with more to come: listing the ids is the chain this avoids. Stop at once.
        if (n <= 100) {
          clamped = true;
          return false;
        }
      },
    })
  );
  const tIds = Date.now() - t0;
  if (clamped && listed.length < expected) return { skip: `id list pages at ${page} (${tIds}ms)` };
  // An issue is only its id here: a keys-only listing carries no key.
  const ids = listed.map((i) => (i.id === undefined || i.id === null ? "" : String(i.id))).filter(Boolean);
  if (ids.length < expected) return { skip: `id list found ${ids.length} of ${expected} counted` };

  const reading = limiter(READ_CONCURRENCY);
  const groups = chunks(ids, ID_CHUNK);
  const order = new Map(ids.map((id, i) => [id, i]));
  const pages = await Promise.all(
    groups.map((group, i) =>
      reading(async () => {
        const found = await named(`ids ${i}`, () => jira.searchIssues(`${whole} AND id in (${group.join(",")})`, fields));
        // `id in` answers in no particular order; the list's own order (oldest first) is kept.
        return found.sort((a, b) => (order.get(String(a.id)) ?? 0) - (order.get(String(b.id)) ?? 0));
      })
    )
  );
  const issues = pages.flat();
  return {
    issues,
    requests: groups.length,
    detail: `by id: ${ids.length} ids in ${tIds}ms (page ${page}), ${groups.length} groups read by ${Date.now() - t0}ms`,
  };
}

/** Way 2: cut the project by creation time, count the pieces, read them together. */
async function readByTime(jira: ProjectSearcher, whole: string, fields: string[], expected: number): Promise<Attempt> {
  void expected;
  const [oldest, newest] = await Promise.all([
    named("oldest", () => jira.searchIssues(`${whole} ORDER BY created ASC`, ["created"], 1)),
    named("newest", () => jira.searchIssues(`${whole} ORDER BY created DESC`, ["created"], 1)),
  ]);
  // Padded a day each side: the timestamps are read in one time zone and the JQL below in another,
  // so the ends must not depend on them agreeing.
  const first = createdDay(oldest[0]);
  const last = createdDay(newest[0]);
  if (!first || !last) return { skip: "no creation dates" };

  const counting = limiter(COUNT_CONCURRENCY);
  const reading = limiter(READ_CONCURRENCY);
  const t0 = Date.now();
  let counts = 0;
  const reads: Array<{ slice: Slice; issues: Promise<any[]> }> = [];
  const plan = async (s: Slice): Promise<void> => {
    const start = minuteNumber(s.from);
    const minutes = minuteNumber(s.to) - start;
    counts++;
    const count = await counting(() => named(`count ${s.from}..${s.to}`, () => jira.countIssues(sliceJql(whole, s))));
    if (count === null) throw new Error("no count for a slice");
    if (count === 0) return;
    if (count <= SLICE_SIZE || minutes <= 1) {
      // Read at once, while the rest is still being counted.
      const issues = reading(() =>
        named(`slice ${s.from}..${s.to}`, () => jira.searchIssues(`${sliceJql(whole, s)} ORDER BY created ASC`, fields))
      );
      // Settled by Promise.all below; this only stops an early failure being "unhandled" meanwhile.
      issues.catch(() => {});
      reads.push({ slice: s, issues });
      return;
    }
    // Equal cuts, none empty: fewer pieces than asked for just means the slice is a few minutes long.
    const ways = waysFor(count, SLICE_SIZE);
    const edges = new Set<number>();
    for (let i = 0; i <= ways; i++) edges.add(start + Math.floor((minutes * i) / ways));
    const cuts = [...edges];
    await Promise.all(cuts.slice(0, -1).map((from, i) => plan({ from: stampOfMinute(from), to: stampOfMinute(cuts[i + 1]) })));
  };
  await plan({
    from: stampOfMinute(minuteNumber(first) - DAY_MIN),
    to: stampOfMinute(minuteNumber(last) + 2 * DAY_MIN),
  });
  const tPlanned = Date.now() - t0;

  // Oldest first, as the one-query read returns them; leaves finished planning in no particular order.
  reads.sort((a, b) => (a.slice.from < b.slice.from ? -1 : a.slice.from > b.slice.from ? 1 : 0));
  const issues = (await Promise.all(reads.map((r) => r.issues))).flat();
  return {
    issues,
    requests: reads.length,
    detail: `by time: ${reads.length} slices, ${counts} counts planned in ${tPlanned}ms, all read by ${Date.now() - t0}ms`,
  };
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

  const skipped: string[] = [];
  try {
    const expected = await named("count", () => jira.countIssues(whole)).catch(() => null);
    if (expected === null) return sequential("no count from Jira");
    if (expected < PARALLEL_MIN_ISSUES) return sequential(`small project (${expected} issues)`);

    for (const way of [readByIds, readByTime]) {
      let attempt: Attempt;
      try {
        attempt = await way(jira, whole, fields, expected);
      } catch (err) {
        // A way that fails (a query Jira will not take, a rate limit that outlasted the retries) does not
        // end the attempt: the next one is tried, and the ordinary read is the last resort.
        skipped.push(`${way.name} failed: ${(err as Error)?.message ?? err}`);
        continue;
      }
      if ("skip" in attempt) {
        skipped.push(`${way.name}: ${attempt.skip}`);
        continue;
      }
      // Short of what Jira counts: an incomplete task list is worse than a slow one.
      if (attempt.issues.length < expected) {
        skipped.push(`${way.name} found ${attempt.issues.length} of ${expected} counted (${attempt.detail})`);
        continue;
      }
      return {
        issues: attempt.issues,
        mode: "parallel",
        requests: attempt.requests,
        detail: attempt.detail + (skipped.length ? ` [after: ${skipped.join("; ")}]` : ""),
      };
    }
    console.warn(`[parallelSearch] ${projectKey}: falling back to the sequential read — ${skipped.join("; ")}`);
    return sequential(skipped.join("; ").slice(0, 400));
  } catch (err) {
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
