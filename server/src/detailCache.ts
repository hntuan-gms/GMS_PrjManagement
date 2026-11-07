/**
 * What the task detail asks Jira for, kept in Postgres so one person's read serves the next.
 *
 * The app's Jira quota is one hourly pool for every user. Opening a task used to cost about eleven
 * requests, five of them lists that belong to the whole project, and every person opening the same task
 * paid again. Now:
 *
 *  - **The project's lists** (priorities, issue types, labels, components, versions, link types) are read
 *    once per ten minutes for everyone, and served stale for up to a day while Jira is refusing for rate.
 *  - **The description** comes from the issue copy (issueCache.ts), which already holds it.
 *  - **Comments and attachments** are kept per issue, as one row each.
 *
 * Nothing here decides who may see what. An issue's description, comments and attachments are served only
 * when (1) the issue copy is not stale and not under an issue security level, (2) the id list read with the
 * caller's OWN token names it and is recent, and (3) the project's "what changed" read has run lately, so a
 * change made in Jira is not missed. A comment or attachment row is also tied to the issue's `updated`: any
 * other value in the copy means it changed and the row is read again. Everything else (the history,
 * watchers, the moves a workflow allows, issue links) depends on who is asking, or on issues they may not
 * see, and is always read from Jira.
 *
 * Comments restricted to a group or role in Jira are never stored, and an issue that has one is read from
 * Jira every time (see `restricted`). A cache failure is never the caller's failure: any error here falls
 * back to the plain Jira read.
 */
import { isRateLimited } from "./parallelSearch.js";
import type { Visibility } from "./issueCache.js";

/** A project list is served from the copy this long. */
export const LIST_FRESH_MS = 10 * 60_000;
/** While Jira refuses for rate, a list this old is still better than an error. */
export const LIST_STALE_OK_MS = 24 * 60 * 60_000;
/** The caller's id list must be this recent for the copy to be served to them. */
export const DETAIL_VISIBILITY_MS = 10 * 60_000;
/** "What changed" must have run this recently for the project, or a change in Jira may not be in the copy yet. */
export const DELTA_FRESH_MS = 5 * 60_000;
/** A comments or attachments row is read again after this long even if the issue did not change. */
export const DETAIL_MAX_AGE_MS = 10 * 60_000;

export type ListKind = "priorities" | "issue-types" | "labels" | "components" | "versions" | "link-types";
export type DetailKind = "comments" | "attachments";

/** What the issue copy says about one issue, enough to decide whether it may be served and from what. */
export interface IssueCopy {
  issueId: string;
  /** Jira's description as stored (ADF), null when it has none. */
  description: unknown;
  secured: boolean;
  /** Set when this app wrote to the issue and has not re-read it since: the copy is behind. */
  staleAtMs: number | null;
  /** Jira's `updated` for the copy. */
  updatedMs: number | null;
}

export interface DetailRow {
  data: unknown;
  restricted: boolean;
  issueUpdatedMs: number | null;
  fetchedAtMs: number;
}

export interface DetailStore {
  getList(cloudId: string, projectKey: string, kind: ListKind): Promise<{ items: unknown; fetchedAtMs: number } | null>;
  putList(cloudId: string, projectKey: string, kind: ListKind, items: unknown): Promise<void>;
  getIssueCopy(cloudId: string, projectKey: string, key: string): Promise<IssueCopy | null>;
  getVisibility(cloudId: string, projectKey: string, accountId: string): Promise<Visibility | null>;
  getSync(cloudId: string, projectKey: string): Promise<{ lastDeltaMs: number | null; changedMs: number | null }>;
  /** A description Jira just gave exactly; only a row that is not stale is touched. */
  writeBackDescription(cloudId: string, issueId: string, description: unknown): Promise<void>;
  getDetail(cloudId: string, issueId: string, kind: DetailKind): Promise<DetailRow | null>;
  putDetail(cloudId: string, issueId: string, kind: DetailKind, data: unknown, restricted: boolean, issueUpdatedMs: number | null): Promise<void>;
  /** Forget what is held about one issue (by key) after this app wrote to it. */
  dropDetail(cloudId: string, issueKey: string, kinds: DetailKind[]): Promise<void>;
}

/** Off only when ISSUE_CACHE=off, like the issue copy it leans on. */
export function detailCacheEnabled(): boolean {
  return process.env.ISSUE_CACHE?.trim().toLowerCase() !== "off";
}

const inflight = new Map<string, Promise<unknown>>();

function share<T>(key: string, run: () => Promise<T>): Promise<T> {
  const held = inflight.get(key);
  if (held) return held as Promise<T>;
  const p = run().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function warn(what: string, err: unknown): void {
  console.warn(`[detailCache] ${what}: ${(err as Error)?.message ?? err}`);
}

/* ------------------------------------------------------------------ lists */

/**
 * A project list: from the copy while it is younger than ten minutes, else read from Jira (once, however
 * many callers ask at once) and kept. A refusal for rate serves an older copy; any other failure is the
 * caller's.
 */
export async function cachedList<T>(
  store: DetailStore,
  scope: { cloudId: string; projectKey: string },
  kind: ListKind,
  read: () => Promise<T>,
  now: number = Date.now()
): Promise<T> {
  if (!detailCacheEnabled()) return read();
  let held: { items: unknown; fetchedAtMs: number } | null = null;
  try {
    held = await store.getList(scope.cloudId, scope.projectKey, kind);
  } catch (err) {
    warn(`reading the ${kind} list`, err);
  }
  if (held && now - held.fetchedAtMs < LIST_FRESH_MS) return held.items as T;
  try {
    return await share(`${scope.cloudId}|${scope.projectKey}|${kind}`, async () => {
      const items = await read();
      try {
        await store.putList(scope.cloudId, scope.projectKey, kind, items);
      } catch (err) {
        warn(`keeping the ${kind} list`, err);
      }
      return items;
    });
  } catch (err) {
    if (held && isRateLimited(err) && now - held.fetchedAtMs < LIST_STALE_OK_MS) return held.items as T;
    throw err;
  }
}

/* ----------------------------------------------------------------- issues */

export interface Who {
  cloudId: string;
  projectKey: string;
  accountId: string;
  key: string;
}

interface Resolved {
  /** The copy row, whoever it may be served to; null when the project's copy has no such issue. */
  copy: IssueCopy | null;
  /** The copy may be served to THIS caller as it stands. */
  serve: boolean;
}

/**
 * The permission and freshness gate. `serve` is true only when the copy is complete and current for the
 * caller: not stale, not secured, named by the caller's own recent id list, and the project's "what changed"
 * read has run lately without a webhook reporting something newer.
 */
export async function resolveIssue(store: DetailStore, who: Who, now: number = Date.now()): Promise<Resolved> {
  const copy = await store.getIssueCopy(who.cloudId, who.projectKey, who.key);
  if (!copy) return { copy: null, serve: false };
  if (copy.secured || copy.staleAtMs !== null) return { copy, serve: false };
  const [visibility, sync] = await Promise.all([
    store.getVisibility(who.cloudId, who.projectKey, who.accountId),
    store.getSync(who.cloudId, who.projectKey),
  ]);
  if (!visibility || now - visibility.checkedAtMs > DETAIL_VISIBILITY_MS || !visibility.ids.includes(copy.issueId)) return { copy, serve: false };
  if (sync.lastDeltaMs === null || now - sync.lastDeltaMs > DELTA_FRESH_MS) return { copy, serve: false };
  if (sync.changedMs !== null && sync.changedMs > sync.lastDeltaMs) return { copy, serve: false };
  return { copy, serve: true };
}

/**
 * The description (Jira's ADF, or null for none): from the issue copy when the gate allows, else from Jira,
 * and what Jira said is written back into the copy so the next reader gets it from there.
 */
export async function cachedDescription(
  store: DetailStore,
  who: Who,
  read: () => Promise<unknown>,
  now: number = Date.now()
): Promise<unknown> {
  if (!detailCacheEnabled()) return read();
  let resolved: Resolved = { copy: null, serve: false };
  try {
    resolved = await resolveIssue(store, who, now);
  } catch (err) {
    warn("checking the copy for a description", err);
  }
  if (resolved.serve && resolved.copy) return resolved.copy.description ?? null;
  const value = await read();
  const copy = resolved.copy;
  if (copy && copy.staleAtMs === null) {
    try {
      await store.writeBackDescription(who.cloudId, copy.issueId, value ?? null);
    } catch (err) {
      warn("writing a description back", err);
    }
  }
  return value;
}

/** How a kind of detail is stored: what part is kept and whether Jira showed this caller something the copy must not hold. */
export interface DetailShape<T> {
  /** What to store for `fresh`, and whether the copy must stand aside for this issue. */
  split(fresh: T): { data: unknown; restricted: boolean };
  /** The stored data as the caller sees it (per-person fields are filled here). */
  join(data: unknown): T;
}

/**
 * Comments or attachments of one issue: from the copy while the gate allows and the row is the one read at
 * the issue's current `updated`; else from Jira, kept for the next reader. An issue flagged `restricted`
 * is always read from Jira, and the flag follows what Jira shows.
 */
export async function cachedDetail<T>(
  store: DetailStore,
  who: Who,
  kind: DetailKind,
  read: () => Promise<T>,
  shape: DetailShape<T>,
  now: number = Date.now()
): Promise<T> {
  if (!detailCacheEnabled()) return read();
  let resolved: Resolved = { copy: null, serve: false };
  let held: DetailRow | null = null;
  try {
    resolved = await resolveIssue(store, who, now);
    if (resolved.copy) held = await store.getDetail(who.cloudId, resolved.copy.issueId, kind);
  } catch (err) {
    warn(`checking the copy for ${kind}`, err);
  }
  if (
    resolved.serve &&
    resolved.copy &&
    held &&
    !held.restricted &&
    held.issueUpdatedMs === resolved.copy.updatedMs &&
    now - held.fetchedAtMs < DETAIL_MAX_AGE_MS
  ) {
    return shape.join(held.data);
  }
  const fresh = await read();
  // Kept for the next reader only when the copy row is current: a stale one's `updated` is not the one just read.
  const copy = resolved.copy;
  if (copy && copy.staleAtMs === null) {
    try {
      const s = shape.split(fresh);
      await store.putDetail(who.cloudId, copy.issueId, kind, s.restricted ? [] : s.data, s.restricted, copy.updatedMs);
    } catch (err) {
      warn(`keeping ${kind}`, err);
    }
  }
  return fresh;
}

/** This app wrote to the issue: what is held about it is no longer true. Never throws. */
export async function forgetDetail(store: DetailStore, cloudId: string, key: string, kinds: DetailKind[]): Promise<void> {
  try {
    await store.dropDetail(cloudId, key, kinds);
  } catch (err) {
    warn("forgetting what was held", err);
  }
}
