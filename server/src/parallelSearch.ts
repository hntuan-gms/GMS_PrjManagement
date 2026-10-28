/**
 * Reading a whole project from Jira without waiting for it one page at a time.
 *
 * `/search/jql` pages by an opaque `nextPageToken`, so a project of 4000 issues is 41 requests
 * that cannot start before the previous one answered — about a second each, which was the entire
 * 40-second page load. Two ways to break that chain, tried in this order:
 *
 *  1. **By id.** Ask for the project's issue ids alone — Jira hands out far bigger pages when
 *     only the id is requested (and then returns nothing else, not even the key), so the whole
 *     list is one request — and, in the same breath, the first page of full issues. A project of
 *     100 or fewer is done when that page lands: no count, no second round. A bigger one reads the
 *     rest in groups of 100 ids (`id in (…)`), all groups at once, as soon as the id list is back.
 *     The groups are cut from the list itself, so nothing falls between them, and anything the
 *     list names that did not come back is asked for by id once more before giving up.
 *  2. **By creation time.** If Jira pages the id list at 100 too (so listing it would be the
 *     very chain being avoided), the project is cut by `created`, to the minute, into slices of
 *     a page or two each, counted with `search/approximate-count`, and the slices run together.
 *
 * Each way is verified, and anything unexpected — a refused query, a short result, a rate limit
 * that outlasted the retries — falls back to the next, ending at the ordinary single query, with
 * the reason in the `[perf]` line. An incomplete task list is worse than a slow one.
 *
 * Why not key RANGES (`key >= P-1 AND key <= P-300`): tried first, they reached 3513 of a
 * project's 4044 issues in production, and so did the complement — Jira does not match some
 * issues by key number. And why `created` slices are cut by an explicit time rather than halved:
 * halving cost one round of counts per level, about twenty from a year down to a dense minute.
 */

export interface SearchOptions {
  /** Page size to ask for; see JiraClient.searchIssues. */
  pageSize?: number;
  /** Called with how many issues each page really held and whether more follow; returning `false` stops paging. */
  onPage?: (issues: number, more: boolean) => boolean | void;
}

/** The part of JiraClient this needs, so the logic can be tested without Jira. */
export interface ProjectSearcher {
  searchIssues(jql: string, fields: string[], limit?: number, opts?: SearchOptions): Promise<any[]>;
  /** Jira's approximate count of a query's matches; null when it cannot be had. */
  countIssues(jql: string): Promise<number | null>;
}

/** Below this many issues the count-based way (time slices) is not worth its round trips; the single query does. */
export const PARALLEL_MIN_ISSUES = 300;
/** Issues per page of full fields: Jira clamps it to 100 whatever is asked. A project this small is one request. */
export const FIRST_PAGE = 100;
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
      // Rate limited (JiraClient already waited out what could be waited out): passed on as it is, so the
      // caller can tell, and so the API answers with Jira's own refusal rather than a wrapped one.
      if (status === 429) throw err;
      if (status >= 500 && attempt < RETRIES_ON_5XX) {
        await sleep(300 * (attempt + 1));
        continue;
      }
      const body = typeof err?.body === "string" ? err.body.replace(/\s+/g, " ").trim().slice(0, 160) : "";
      throw new Error(`${label}: ${err?.message ?? err}${body ? ` (${body})` : ""}`);
    }
  }
}

/** Jira refused for rate: the same refusal awaits any other way, so none is tried. */
export const isRateLimited = (err: unknown): boolean => (err as { status?: number } | null)?.status === 429;

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
  /** "single" = one page held everything; "parallel" = one of the fast ways; "sequential" = the ordinary read after a way failed. */
  mode: "single" | "parallel" | "sequential";
  /** Requests made to read the issues themselves. */
  requests: number;
  /** Which fast way and where the time went, for the [perf] line. */
  detail?: string;
  /** Why the ordinary read was used, when the fast one was not — shown in the [perf] line. */
  reason?: string;
}

/** A way that does not apply is `null` with a reason; one that fails throws; one that works returns the issues. */
type Attempt = { issues: any[]; requests: number; detail: string; single?: boolean } | { skip: string };

/** Way 1: the id list and the first page together, then the rest in groups, all groups at once. */
async function readByIds(jira: ProjectSearcher, whole: string, fields: string[]): Promise<Attempt> {
  const t0 = Date.now();
  // What a project of 100 or fewer needs, started at once. Never rejects (its failure is handled below),
  // so it cannot be "unhandled" while the id list is still being waited for.
  const firstPage = named("page 1", () => jira.searchIssues(`${whole} ORDER BY created ASC`, fields, FIRST_PAGE)).then(
    (issues) => ({ issues: issues as any[] | null }),
    () => ({ issues: null as any[] | null })
  );

  let page = 0;
  let clamped = false;
  const listed = await named("ids", () =>
    jira.searchIssues(`${whole} ORDER BY created ASC`, ["id"], undefined, {
      pageSize: ID_PAGE_SIZE,
      onPage: (n, more) => {
        page = Math.max(page, n);
        // A page of 100 or fewer with more to come: listing the ids is the chain this avoids. Stop at once.
        if (more && n <= 100) {
          clamped = true;
          return false;
        }
      },
    })
  );
  const tIds = Date.now() - t0;
  if (clamped) return { skip: `id list pages at ${page} (${tIds}ms)` };
  // An issue is only its id here: a keys-only listing carries no key.
  const ids = listed.map((i) => (i.id === undefined || i.id === null ? "" : String(i.id))).filter(Boolean);

  // One page held it all: nothing to count, nothing more to ask.
  if (ids.length <= FIRST_PAGE) {
    const first = await firstPage;
    if (first.issues && first.issues.length >= ids.length) {
      return {
        issues: first.issues,
        requests: 1,
        single: true,
        detail: `by id: ${ids.length} ids in ${tIds}ms, one page by ${Date.now() - t0}ms`,
      };
    }
  }

  // The first page covers the oldest FIRST_PAGE ids; the groups cover the rest and start now, not when it lands.
  const reading = limiter(READ_CONCURRENCY);
  const readGroups = (list: string[], label: string): Promise<any[]> =>
    Promise.all(
      chunks(list, ID_CHUNK).map((group, i) =>
        reading(() => named(`${label} ${i}`, () => jira.searchIssues(`${whole} AND id in (${group.join(",")})`, fields)))
      )
    ).then((pages) => pages.flat());
  const restGroups = readGroups(ids.slice(FIRST_PAGE), "ids");
  restGroups.catch(() => {});

  const first = await firstPage;
  const byId = new Map<string, any>();
  for (const issue of [...(first.issues ?? []), ...(await restGroups)]) byId.set(String(issue.id), issue);

  // Whatever the list names that did not come back (the first page failed, an issue was created meanwhile and
  // shifted the pages) is asked for by id once more — and only then given up on.
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) for (const issue of await readGroups(missing, "missing")) byId.set(String(issue.id), issue);
  const stillMissing = ids.filter((id) => !byId.has(id));
  if (stillMissing.length > 0) return { skip: `id list named ${ids.length}, ${stillMissing.length} not found by id` };

  // `id in` answers in no particular order; the list's own order (oldest first) is kept.
  const issues = ids.map((id) => byId.get(id));
  const groups = Math.ceil(Math.max(0, ids.length - FIRST_PAGE) / ID_CHUNK);
  return {
    issues,
    requests: 1 + groups,
    detail: `by id: ${ids.length} ids in ${tIds}ms (page ${page}), first page + ${groups} groups read by ${Date.now() - t0}ms${missing.length ? ` (${missing.length} asked for again)` : ""}`,
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
    // Way 1 needs no count: the id list IS the count, and a project it shows to be small is already read.
    try {
      const attempt = await readByIds(jira, whole, fields);
      if (!("skip" in attempt)) {
        return {
          issues: attempt.issues,
          mode: attempt.single ? "single" : "parallel",
          requests: attempt.requests,
          detail: attempt.detail,
        };
      }
      skipped.push(`readByIds: ${attempt.skip}`);
    } catch (err) {
      // Rate limited: the other ways would only be refused too, and each costs more requests — stop here.
      if (isRateLimited(err)) throw err;
      // A way that fails (a query Jira will not take) does not end the attempt: the next one is tried,
      // and the ordinary read is the last resort.
      skipped.push(`readByIds failed: ${(err as Error)?.message ?? err}`);
    }

    // Way 2 sizes its slices with Jira's count, and is only worth it for a project that is big.
    const expected = await named("count", () => jira.countIssues(whole)).catch(() => null);
    if (expected === null) return sequential(`no count from Jira; ${skipped.join("; ")}`.slice(0, 400));
    if (expected < PARALLEL_MIN_ISSUES) return sequential(`small project (${expected} issues); ${skipped.join("; ")}`.slice(0, 400));
    try {
      const attempt = await readByTime(jira, whole, fields, expected);
      if ("skip" in attempt) skipped.push(`readByTime: ${attempt.skip}`);
      else if (attempt.issues.length < expected) {
        // Short of what Jira counts: an incomplete task list is worse than a slow one.
        skipped.push(`readByTime found ${attempt.issues.length} of ${expected} counted (${attempt.detail})`);
      } else {
        return {
          issues: attempt.issues,
          mode: "parallel",
          requests: attempt.requests,
          detail: `${attempt.detail} [after: ${skipped.join("; ")}]`,
        };
      }
    } catch (err) {
      if (isRateLimited(err)) throw err;
      skipped.push(`readByTime failed: ${(err as Error)?.message ?? err}`);
    }
    console.warn(`[parallelSearch] ${projectKey}: falling back to the sequential read — ${skipped.join("; ")}`);
    return sequential(skipped.join("; ").slice(0, 400));
  } catch (err) {
    if (isRateLimited(err)) throw err;
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
