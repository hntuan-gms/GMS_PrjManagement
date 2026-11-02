/**
 * A project's issues kept in Postgres, so a page load asks Jira only what changed.
 *
 * The app's Jira quota is one hourly pool for every user, and the whole project used to be read
 * on every load and every refresh after a drag — ~42 requests for a 4000-issue project, times
 * the number of people. With the copy, a load is:
 *
 *  1. **The ids this user can see** (`fields: ["id"]`, one request for thousands), read with the
 *     user's own token. It is the permission filter: an issue is served only if this list names
 *     it, so issue security and "browse: reporter only" schemes still decide what each person
 *     sees. Reused for a minute, and for up to an hour when Jira is refusing for rate.
 *  2. **What changed** (`updated >= "-Nm"`), at most every 30 s per project — usually one request
 *     and a handful of issues. Relative minutes, because an absolute JQL time is read in each
 *     user's Jira timezone.
 *  3. **What this app wrote** since the last load: a write marks the row stale (and patches it with
 *     the values sent), and a stale row is re-read by id with bulkfetch, not by search — the
 *     search index lags a write by seconds, and a stale due date read back would make
 *     `reconcile()` shift the overlay to match it.
 *  4. **What the copy lacks**: on first sight of a project, all of it — in groups of 100 ids,
 *     each group saved as it lands, so a 429 halfway through is resumed, not restarted. One fill
 *     per project at a time across instances (an advisory lock), a few at once per instance.
 *  5. **A little refreshing**: rows read with another field list, secured rows after 5 minutes
 *     and anything not re-read for a day, at most 1500 per load — so adding a field never
 *     re-reads every project at once, and drift `updated` does not show (a sprint's state, a
 *     renamed status) heals by itself.
 *
 * Rows are kept indefinitely: storage is cheap and a re-read costs quota. A row goes only when
 * Jira no longer lists the issue to someone who sees the whole project.
 */
import { chunks, FIRST_PAGE, ID_CHUNK, ID_PAGE_SIZE, isRateLimited, limiter, named, READ_CONCURRENCY } from "./parallelSearch.js";

/** An id list this recent is used again without asking Jira. */
export const VISIBILITY_REUSE_MS = 60_000;
/** While Jira refuses for rate, an id list up to this old still decides what may be shown. */
export const VISIBILITY_GRACE_MS = 60 * 60_000;
/** "What changed" is asked at most this often per project, whoever is loading it. */
export const DELTA_INTERVAL_MS = 30_000;
/** Minutes of overlap on each "what changed" window: the search index lags, and JQL minutes are coarse. */
export const DELTA_OVERLAP_MIN = 2;
/** A secured row is re-read this often: a change to it is invisible to the deltas of users who cannot see it. */
export const SECURED_REFRESH_MS = 5 * 60_000;
/** Any row not re-read for this long is refreshed, within the budget below. */
export const REFRESH_AFTER_MS = 24 * 60 * 60_000;
/** Rows refreshed per load at most (fifteen reads of 100, one round at READ_CONCURRENCY): a board opened on a big project gets its fields in a few loads, for the same total of requests. */
export const BACKFILL_MAX = 1500;
/** A fill bigger than this takes the per-project lock and a slot among the few allowed at once. */
export const BIG_FILL = 300;
export const MAX_BIG_FILLS = 2;
/** A user who sees at least this share of the project's unsecured issues sees "the whole project". */
export const FULL_VIEW_SHARE = 0.95;
/** Never remove more than this share of a project's rows in one go: a short id list is a bug, not a purge. */
export const MAX_REMOVE_SHARE = 0.5;
const MIN_REMOVE_ALWAYS = 20;
/** Exact re-reads (bulkfetch) take at most this many issues per call. */
export const BULK_FETCH_MAX = 100;

export interface CachedIssue {
  /** `{ id, key, fields }` as Jira returned it. Without `fields.description` when loaded without it. */
  issue: any;
  sig: string;
  secured: boolean;
  updatedMs: number | null;
  /** When this app last wrote to the issue; null = the copy is what Jira last said. */
  staleAtMs: number | null;
  syncedAtMs: number;
}

export interface SyncState {
  deltaFromMs: number | null;
  lastDeltaMs: number | null;
  /** Fields the project's board needs beyond the task list (rank, estimate, flag). */
  extraFields: string[];
  /** A webhook said something changed at this instant: "what changed" is asked at once. */
  changedMs: number | null;
}

export interface Visibility {
  ids: string[];
  checkedAtMs: number;
  reusable: boolean;
}

/**
 * Where the copy lives. Postgres in production (issueCacheStore.ts), memory in the tests. The
 * replace rule is `shouldReplace` in both.
 */
export interface IssueCacheStore {
  load(cloudId: string, projectKey: string, withDescription: boolean): Promise<{ rows: Map<string, CachedIssue>; sync: SyncState }>;
  loadVisibility(cloudId: string, projectKey: string, accountId: string): Promise<Visibility | null>;
  saveVisibility(cloudId: string, projectKey: string, accountId: string, ids: string[]): Promise<void>;
  /** `exactSinceMs` set = read by id after that instant (bulkfetch); unset = read through search. */
  upsert(cloudId: string, projectKey: string, issues: any[], sig: string, exactSinceMs?: number): Promise<void>;
  remove(cloudId: string, issueIds: string[]): Promise<void>;
  saveSync(cloudId: string, projectKey: string, patch: Partial<SyncState>): Promise<void>;
  /** Runs `fn` while no other instance fills this project; gives up waiting after a while and runs anyway. */
  withFillLock<T>(cloudId: string, projectKey: string, fn: () => Promise<T>): Promise<T>;
}

/** The part of JiraClient this needs. */
export interface CacheJira {
  searchIssues(
    jql: string,
    fields: string[],
    limit?: number,
    opts?: { pageSize?: number; onPage?: (issues: number, more: boolean) => boolean | void }
  ): Promise<any[]>;
  bulkFetchIssues(idsOrKeys: string[], fields: string[]): Promise<any[]>;
  getIssue(key: string, fields?: string[]): Promise<any>;
}

export interface CacheQuery {
  cloudId: string;
  projectKey: string;
  accountId: string;
  /** What a full read asks for; see `cacheFields`. */
  fields: string[];
  /** Whether the caller wants descriptions in what is returned. */
  description: boolean;
  /** Fields this caller needs on top (the board's rank, estimate and flag): kept for the project from now on. */
  extraFields?: string[];
  /** How often "what changed" is asked; longer while a webhook reports changes as they happen. */
  deltaIntervalMs?: number;
  /** The app's Jira quota (jiraQuota.ts). */
  quota?: { deferBackground: boolean; limitedUntilMs: number | null };
}

export interface CachedRead {
  /** Oldest first, as the one-query read returned them. */
  issues: any[];
  requests: number;
  detail: string;
  /** Set when Jira refused for rate and what is returned may lag behind it. */
  rateLimited: { retryAfter?: string } | null;
  /** Visible rows still read with an older field list (being refreshed a few hundred per load). */
  outdated: number;
}

/** The cache cannot be used for this project (its id list pages at 100): read Jira directly. */
export class CacheUnavailable extends Error {}

/** The field list the copy is read with: the caller's, plus what the copy itself needs. */
export function cacheFields(fields: string[]): string[] {
  return [...new Set([...fields, "description", "updated", "security"])];
}

export function fieldsSignature(fields: string[]): string {
  return [...new Set(fields)].sort().join(",");
}

/** Jira writes "2026-03-01T10:00:00.000+0700"; Date.parse wants a colon in the offset. */
export function jiraTimeMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(ms) ? null : ms;
}

/** Never kept: people's email and timezone (privacy.html §2 promises no email is stored), and Jira's links to itself. */
const DROP_KEYS = new Set(["self", "iconUrl", "emailAddress", "timeZone", "expand", "avatarId", "accountType"]);

function slimValue(value: any): any {
  if (Array.isArray(value)) return value.map(slimValue);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (DROP_KEYS.has(k)) continue;
    // Four sizes of every avatar; the app shows the 24px one.
    if (k === "avatarUrls" && v && typeof v === "object") out[k] = { "24x24": (v as Record<string, unknown>)["24x24"] };
    else out[k] = slimValue(v);
  }
  return out;
}

/** A parent keeps what the board shows of it (is it an Epic, and its title), not its whole status and type. */
function slimParent(v: any): any {
  if (!v || typeof v !== "object") return v;
  const f = v.fields;
  const type = f?.issuetype;
  return {
    id: v.id,
    key: v.key,
    ...(f
      ? {
          fields: {
            summary: f.summary,
            ...(type ? { issuetype: { name: type.name, subtask: type.subtask, hierarchyLevel: type.hierarchyLevel } } : {}),
          },
        }
      : {}),
  };
}

/**
 * What is stored of an issue: everything the app reads, without what it does not. Jira's raw
 * answer was ~3.4 KB an issue — a parent carries its own summary, status and type, a person four
 * avatar sizes and their email — and the whole project is read back on every load.
 */
export function slimIssue(issue: any): any {
  if (!issue?.fields) return issue;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(issue.fields)) {
    if (k === "description") fields[k] = v;
    else if (k === "parent") fields[k] = slimParent(v);
    else fields[k] = slimValue(v);
  }
  return { id: issue.id, key: issue.key, fields };
}

export function toCached(issue: any, sig: string, atMs: number): CachedIssue {
  return {
    issue,
    sig,
    secured: !!issue?.fields?.security,
    updatedMs: jiraTimeMs(issue?.fields?.updated),
    staleAtMs: null,
    syncedAtMs: atMs,
  };
}

/**
 * Whether a copy just read from Jira replaces the one held. Read by id after the row went stale:
 * yes, unless this app wrote to it again while the read was out. Read through search: only a
 * row nobody here wrote to since, and never with an older `updated` — the index lags.
 */
export function shouldReplace(held: CachedIssue, incoming: CachedIssue, exactSinceMs?: number): boolean {
  if (exactSinceMs !== undefined) return held.staleAtMs === null || held.staleAtMs <= exactSinceMs;
  if (held.staleAtMs !== null) return false;
  return held.updatedMs === null || incoming.updatedMs === null || incoming.updatedMs >= held.updatedMs;
}

/** Every id a JQL matches, in one request; null when Jira pages the list at 100 (listing would be a chain). */
async function listIds(jira: CacheJira, label: string, jql: string): Promise<string[] | null> {
  let clamped = false;
  const listed = await named(label, () =>
    jira.searchIssues(jql, ["id"], undefined, {
      pageSize: ID_PAGE_SIZE,
      onPage: (n, more) => {
        if (more && n <= 100) {
          clamped = true;
          return false;
        }
      },
    })
  );
  if (clamped) return null;
  return listed.map((i) => (i?.id === undefined || i?.id === null ? "" : String(i.id))).filter(Boolean);
}

/** The issues of `ids`, in groups of 100 read together; each group is handed to `onGroup` as it lands. */
async function readIds(
  jira: CacheJira,
  whole: string,
  ids: string[],
  fields: string[],
  label: string,
  onGroup: (issues: any[]) => Promise<void>
): Promise<number> {
  const reading = limiter(READ_CONCURRENCY);
  let found = 0;
  await Promise.all(
    chunks(ids, ID_CHUNK).map((group, i) =>
      reading(async () => {
        const issues = await named(`${label} ${i}`, () => jira.searchIssues(`${whole} AND id in (${group.join(",")})`, fields));
        found += issues.length;
        await onGroup(issues);
      })
    )
  );
  return found;
}

/** Issues by id from the issue store itself: bulkfetch, or one by one where bulkfetch is refused. */
async function readExact(jira: CacheJira, ids: string[], fields: string[]): Promise<any[]> {
  const out: any[] = [];
  for (const group of chunks(ids, BULK_FETCH_MAX)) {
    try {
      out.push(...(await jira.bulkFetchIssues(group, fields)));
    } catch (err) {
      if (isRateLimited(err)) throw err;
      const one = limiter(8);
      const each = await Promise.all(
        group.map((id) =>
          one(() =>
            jira.getIssue(id, fields).catch((e) => {
              if (isRateLimited(e)) throw e;
              // Gone, or no longer visible to this user: not this row's business to decide here.
              return null;
            })
          )
        )
      );
      out.push(...each.filter(Boolean));
    }
  }
  return out;
}

/** Shared by every request of this instance: a few first-time reads of big projects at once, not dozens. */
const bigFills = limiter(MAX_BIG_FILLS);

export async function readCachedProject(
  jira: CacheJira,
  store: IssueCacheStore,
  q: CacheQuery,
  now: () => number = Date.now
): Promise<CachedRead> {
  const { cloudId, projectKey, accountId } = q;
  const whole = `project = ${projectKey}`;
  const t = now();
  const notes: string[] = [];
  const state: { requests: number; limited: { retryAfter?: string } | null; limitErr: unknown } = {
    requests: 0,
    limited: null,
    limitErr: null,
  };
  const onLimit = (err: unknown) => {
    state.limited = { retryAfter: (err as { retryAfter?: string } | null)?.retryAfter };
    state.limitErr = err;
  };
  const counted = <T>(fn: () => Promise<T>): Promise<T> => {
    state.requests++;
    return fn();
  };
  const cj: CacheJira = {
    searchIssues: (...a) => counted(() => jira.searchIssues(...a)),
    bulkFetchIssues: (...a) => counted(() => jira.bulkFetchIssues(...a)),
    getIssue: (...a) => counted(() => jira.getIssue(...a)),
  };

  const [{ rows, sync }, seen] = await Promise.all([
    store.load(cloudId, projectKey, q.description),
    store.loadVisibility(cloudId, projectKey, accountId),
  ]);
  const cachedAtStart = rows.size;

  // The field list is the project's, not the caller's: a board once opened adds its fields for every reader,
  // so the task list and the board read the same rows instead of each refreshing them to its own list.
  const newExtras = (q.extraFields ?? []).filter((f) => !q.fields.includes(f) && !sync.extraFields.includes(f));
  if (newExtras.length > 0) await store.saveSync(cloudId, projectKey, { extraFields: [...sync.extraFields, ...newExtras] });
  const fields = [...new Set([...q.fields, ...sync.extraFields, ...newExtras])];
  const sig = fieldsSignature(fields);

  // Saved two at a time: sixteen groups landing together must not take every pooled connection.
  const saving = limiter(2);
  const put = (raw: any[], exactSinceMs?: number) =>
    saving(async () => {
      if (raw.length === 0) return;
      const issues = raw.map(slimIssue);
      await store.upsert(cloudId, projectKey, issues, sig, exactSinceMs);
      const at = now();
      for (const issue of issues) {
        const id = String(issue.id);
        const held = rows.get(id);
        const next = toCached(issue, sig, at);
        if (!held || shouldReplace(held, next, exactSinceMs)) rows.set(id, next);
      }
    });

  // Jira already refused for longer than this request will live: ask it nothing the copy can answer.
  if (q.quota?.limitedUntilMs && q.quota.limitedUntilMs > t) {
    onLimit(Object.assign(new Error("Jira API error 429"), { status: 429, retryAfter: String(Math.ceil((q.quota.limitedUntilMs - t) / 1000)) }));
  }

  // 1. What this user may see.
  let ids: string[];
  let idsFresh = false;
  if (state.limited) {
    if (!seen || t - seen.checkedAtMs > VISIBILITY_GRACE_MS) throw state.limitErr;
    ids = seen.ids;
    notes.push(`quota spent, ids from ${Math.round((t - seen.checkedAtMs) / 60_000)} min ago`);
  } else if (seen && seen.reusable && t - seen.checkedAtMs < VISIBILITY_REUSE_MS) {
    ids = seen.ids;
    notes.push("ids reused");
  } else {
    try {
      const listed = await listIds(cj, "ids", `${whole} ORDER BY created ASC`);
      if (!listed) throw new CacheUnavailable("the id list pages at 100");
      ids = listed;
      idsFresh = true;
      await store.saveVisibility(cloudId, projectKey, accountId, ids);
    } catch (err) {
      if (!isRateLimited(err) || !seen || t - seen.checkedAtMs > VISIBILITY_GRACE_MS) throw err;
      onLimit(err);
      ids = seen.ids;
      notes.push(`rate limited, ids from ${Math.round((t - seen.checkedAtMs) / 60_000)} min ago`);
    }
  }
  const visible = new Set(ids);

  // Someone who sees (nearly) every unsecured issue sees the project as it is: only their reads
  // move the shared "changed since" mark, and only their id list may remove rows.
  let unsecured = 0;
  let unsecuredSeen = 0;
  for (const [id, row] of rows) {
    if (row.secured) continue;
    unsecured++;
    if (visible.has(id)) unsecuredSeen++;
  }
  const fullView = unsecured === 0 || unsecuredSeen >= unsecured * FULL_VIEW_SHARE;

  // 2. What changed in Jira since the last look (made here or anywhere else).
  const interval = q.deltaIntervalMs ?? DELTA_INTERVAL_MS;
  const webhookSaidSo = sync.changedMs !== null && (sync.lastDeltaMs === null || sync.changedMs >= sync.lastDeltaMs);
  const deltaDue = cachedAtStart > 0 && (webhookSaidSo || !(sync.lastDeltaMs !== null && t - sync.lastDeltaMs < interval));
  if (!state.limited && deltaDue) {
    let from = sync.deltaFromMs;
    if (from === null) for (const row of rows.values()) from = from === null ? row.syncedAtMs : Math.min(from, row.syncedAtMs);
    const minutes = Math.max(1, Math.ceil((t - (from ?? t)) / 60_000)) + DELTA_OVERLAP_MIN;
    const jql = `${whole} AND updated >= "-${minutes}m" ORDER BY updated ASC`;
    try {
      let more = false;
      const page = await named("delta", () =>
        cj.searchIssues(jql, fields, FIRST_PAGE, {
          onPage: (_n, m) => {
            more = m;
            return false;
          },
        })
      );
      await put(page);
      let changed = page.length;
      if (more) {
        // A long absence: list the rest of what changed by id and read it in groups.
        const listed = await listIds(cj, "delta ids", jql);
        if (!listed) throw new Error("the delta's id list pages at 100");
        const have = new Set(page.map((i) => String(i.id)));
        changed += await readIds(cj, whole, listed.filter((id) => !have.has(id)), fields, "delta", (g) => put(g));
      }
      notes.push(`delta ${minutes}m: ${changed}`);
      await store.saveSync(cloudId, projectKey, fullView ? { lastDeltaMs: t, deltaFromMs: t } : { lastDeltaMs: t });
    } catch (err) {
      if (!isRateLimited(err)) throw err;
      onLimit(err);
    }
  } else if (cachedAtStart > 0) {
    notes.push("delta skipped");
  }

  // 3. What this app wrote: re-read by id, which a lagging search index cannot answer with an old copy.
  const staleIds = ids.filter((id) => rows.get(id)?.staleAtMs != null);
  if (!state.limited && staleIds.length > 0) {
    const since = now();
    try {
      await put(await readExact(cj, staleIds, fields), since);
      notes.push(`re-read ${staleIds.length}`);
    } catch (err) {
      if (!isRateLimited(err)) throw err;
      onLimit(err);
    }
  }

  // 4. What the copy does not have at all.
  const absent = ids.filter((id) => !rows.has(id));
  if (absent.length > 0) {
    // Without these the list is incomplete, which is worse than the browser's own older copy.
    if (state.limited) throw state.limitErr;
    const fill = async (): Promise<number> => {
      let todo = absent;
      if (absent.length > BIG_FILL) {
        // Another request may have filled it while this one waited for the lock.
        const again = await store.load(cloudId, projectKey, q.description);
        for (const [id, row] of again.rows) if (!rows.has(id)) rows.set(id, row);
        todo = ids.filter((id) => !rows.has(id));
      }
      if (todo.length > 0) await readIds(cj, whole, todo, fields, "fill", (g) => put(g));
      return todo.length;
    };
    const filled = absent.length > BIG_FILL ? await bigFills(() => store.withFillLock(cloudId, projectKey, fill)) : await fill();
    notes.push(`filled ${filled}`);
    if (cachedAtStart === 0 && fullView) await store.saveSync(cloudId, projectKey, { lastDeltaMs: t, deltaFromMs: t });
  }

  // 5. A little refreshing, never at the cost of a rate limit — nor while the quota is nearly spent.
  if (!state.limited && !q.quota?.deferBackground) {
    const outdated = ids
      .filter((id) => {
        const row = rows.get(id);
        if (!row || row.staleAtMs !== null) return false;
        const age = t - row.syncedAtMs;
        return row.sig !== sig || age > REFRESH_AFTER_MS || (row.secured && age > SECURED_REFRESH_MS);
      })
      .slice(0, BACKFILL_MAX);
    if (outdated.length > 0) {
      try {
        await readIds(cj, whole, outdated, fields, "refresh", (g) => put(g));
        notes.push(`refreshed ${outdated.length}`);
      } catch (err) {
        if (!isRateLimited(err)) throw err;
        onLimit(err);
      }
    }
  }

  // Gone from Jira (deleted, or moved to another project): only a fresh, whole-project id list says so.
  if (!state.limited && idsFresh && fullView) {
    const gone = [...rows.entries()].filter(([id, row]) => !visible.has(id) && !row.secured && row.staleAtMs === null).map(([id]) => id);
    if (gone.length > 0 && gone.length <= Math.max(MIN_REMOVE_ALWAYS, rows.size * MAX_REMOVE_SHARE)) {
      await store.remove(cloudId, gone);
      for (const id of gone) rows.delete(id);
      notes.push(`removed ${gone.length}`);
    } else if (gone.length > 0) {
      console.warn(`[issueCache] ${projectKey}: ${gone.length} of ${rows.size} rows not in the id list; not removing that many at once`);
    }
  }

  let outdated = 0;
  for (const id of ids) if (rows.get(id) && rows.get(id)!.sig !== sig) outdated++;
  if (outdated > 0) notes.push(`${outdated} on an older field list`);

  const issues: any[] = [];
  let missing = 0;
  for (const id of ids) {
    const row = rows.get(id);
    if (!row) {
      // Listed, then not found by id (created a moment ago, or moved meanwhile): left for the next load.
      missing++;
      continue;
    }
    if (q.description || row.issue?.fields?.description === undefined) issues.push(row.issue);
    else {
      const { description: _omit, ...rest } = row.issue.fields;
      issues.push({ ...row.issue, fields: rest });
    }
  }
  if (missing > 0) notes.push(`${missing} listed but not read`);

  return {
    issues,
    requests: state.requests,
    detail: `cache: ${cachedAtStart} rows${fullView ? "" : " (partial view)"}, ${notes.join(", ")}`,
    rateLimited: state.limited,
    outdated,
  };
}

/** What one Jira write means for the copy. */
export interface WriteEffect {
  /** Fields sent in a plain `PUT /issue/{key}`, laid over the copy until it is re-read. */
  patch: { key: string; fields: Record<string, unknown> } | null;
  /** Issues (keys or ids) to re-read by id on the next load. */
  stale: string[];
  deleted: string[];
  /** Sprints whose name or state changed: every issue carrying one holds a copy of it. */
  sprints: number[];
  /** An issue was created: this user's id list is listed again on the next load. */
  created: boolean;
}

const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
const ISSUE_ID = /^\d+$/;

/** Pure: which issues a Jira request just changed, from its method, path and body. */
export function writeEffect(method: string, path: string, body?: string): WriteEffect {
  const effect: WriteEffect = { patch: null, stale: [], deleted: [], sprints: [], created: false };
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD") return effect;
  const p = path.split("?")[0];
  const parsed = (): any => {
    try {
      return body ? JSON.parse(body) : null;
    } catch {
      return null;
    }
  };

  if (verb === "POST" && /^\/rest\/api\/[23]\/issue(\/bulk)?$/.test(p)) {
    effect.created = true;
    return effect;
  }
  const issue = p.match(/^\/rest\/api\/[23]\/issue\/([^/]+)(\/.*)?$/);
  if (issue) {
    const key = decodeURIComponent(issue[1]);
    if (!ISSUE_KEY.test(key) && !ISSUE_ID.test(key)) return effect;
    if (!issue[2] && verb === "DELETE") effect.deleted.push(key);
    else {
      effect.stale.push(key);
      const fields = !issue[2] && verb === "PUT" ? parsed()?.fields : null;
      if (fields && typeof fields === "object" && !Array.isArray(fields)) effect.patch = { key, fields };
    }
    return effect;
  }
  const estimation = p.match(/^\/rest\/agile\/1\.0\/issue\/([^/]+)\/estimation$/);
  if (estimation) {
    effect.stale.push(decodeURIComponent(estimation[1]));
    return effect;
  }
  if (/^\/rest\/agile\/1\.0\/(sprint\/\d+|backlog)\/issue$/.test(p)) {
    const issues = parsed()?.issues;
    if (Array.isArray(issues)) effect.stale.push(...issues.map(String).filter((k) => ISSUE_KEY.test(k) || ISSUE_ID.test(k)));
    return effect;
  }
  const sprint = p.match(/^\/rest\/agile\/1\.0\/sprint\/(\d+)$/);
  if (sprint) effect.sprints.push(Number(sprint[1]));
  return effect;
}

export function isEmptyEffect(e: WriteEffect): boolean {
  return !e.patch && e.stale.length === 0 && e.deleted.length === 0 && e.sprints.length === 0 && !e.created;
}

/** Off only when ISSUE_CACHE=off: then every load reads Jira directly, as before. */
export function issueCacheEnabled(): boolean {
  return process.env.ISSUE_CACHE?.trim().toLowerCase() !== "off";
}
