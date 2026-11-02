/**
 * What Jira last said about the app's quota, so the app stops spending it before it is gone.
 *
 * The quota is the app's, one hourly pool for every user (RateLimit-Reason
 * jira-quota-global-based), so one instance hearing "near the limit" must slow every instance
 * down: the state lives in Postgres (jira_quota_state) and each instance re-reads it every few
 * seconds. Two signals, from JiraClient.onRateSignal:
 *  - **near** — a response carried `X-RateLimit-NearLimit: true`. Background reads stop (the issue
 *    cache's refreshing, the tabs warmed before they are opened) so what is left goes to what
 *    people actually do: open a project, move a card, write a comment.
 *  - **limited** — a 429 with a Retry-After too long to wait out. Until it passes nothing asks
 *    Jira for reads it can answer from the copy, rather than collecting the same refusal again.
 * A burst limit (per second, per endpoint) is short and JiraClient waits it out; it is not noted.
 *
 * Everything here fails open: without the table (or the database) the app behaves as before.
 */
import { db } from "./db/pool.js";

/** How long "near the limit" holds after the last response that said so. */
export const NEAR_HOLD_MS = 10 * 60_000;
/** Each instance re-reads the shared state at most this often. */
const REFRESH_MS = 5_000;
/** The same signal is written at most this often per scope (every response near the limit carries it). */
const WRITE_EVERY_MS = 30_000;

export interface QuotaState {
  nearLimitUntilMs: number | null;
  limitedUntilMs: number | null;
}

export interface QuotaView {
  /** Background reads should not run. */
  deferBackground: boolean;
  /** Reads the copy can answer should not be sent to Jira before this instant. */
  limitedUntilMs: number | null;
}

/** "app" for the app-wide pool; a site's own quota is that site's alone. */
export function scopeFor(cloudId: string, reason: string | null | undefined): string {
  return reason && /tenant/i.test(reason) ? `site:${cloudId}` : "app";
}

/** Pure: what the states of the app and of this site mean right now. */
export function viewOf(states: QuotaState[], now: number): QuotaView {
  let near = false;
  let limited: number | null = null;
  for (const s of states) {
    if (s.nearLimitUntilMs !== null && s.nearLimitUntilMs > now) near = true;
    if (s.limitedUntilMs !== null && s.limitedUntilMs > now) limited = Math.max(limited ?? 0, s.limitedUntilMs);
  }
  return { deferBackground: near || limited !== null, limitedUntilMs: limited };
}

let snapshot: { at: number; states: Map<string, QuotaState> } | null = null;
let loading: Promise<Map<string, QuotaState>> | null = null;
const lastWrite = new Map<string, number>();

async function loadStates(): Promise<Map<string, QuotaState>> {
  if (snapshot && Date.now() - snapshot.at < REFRESH_MS) return snapshot.states;
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await db().query<{ scope: string; near_limit_until: Date | null; limited_until: Date | null }>(
        `SELECT scope, near_limit_until, limited_until FROM jira_quota_state`
      );
      const states = new Map<string, QuotaState>();
      for (const r of res.rows) {
        states.set(r.scope, { nearLimitUntilMs: r.near_limit_until?.getTime() ?? null, limitedUntilMs: r.limited_until?.getTime() ?? null });
      }
      snapshot = { at: Date.now(), states };
      return states;
    } catch {
      snapshot = { at: Date.now(), states: snapshot?.states ?? new Map() };
      return snapshot.states;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** The quota as it stands for requests to this site. */
export async function quotaView(cloudId: string): Promise<QuotaView> {
  const states = await loadStates();
  return viewOf([states.get("app"), states.get(`site:${cloudId}`)].filter((s): s is QuotaState => !!s), Date.now());
}

function remember(scope: string, patch: Partial<QuotaState>): void {
  const held = snapshot?.states.get(scope) ?? { nearLimitUntilMs: null, limitedUntilMs: null };
  const next = { ...held, ...patch };
  if (snapshot) snapshot.states.set(scope, next);
  else snapshot = { at: Date.now(), states: new Map([[scope, next]]) };
}

async function write(scope: string, column: "near_limit_until" | "limited_until", untilMs: number, reason: string | null): Promise<void> {
  const key = `${scope}|${column}`;
  const last = lastWrite.get(key) ?? 0;
  if (Date.now() - last < WRITE_EVERY_MS && column === "near_limit_until") return;
  lastWrite.set(key, Date.now());
  try {
    await db().query(
      `INSERT INTO jira_quota_state (scope, ${column}, reason, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (scope) DO UPDATE SET ${column} = GREATEST(coalesce(jira_quota_state.${column}, $2), $2),
         reason = coalesce($3, jira_quota_state.reason), updated_at = now()`,
      [scope, new Date(untilMs).toISOString(), reason]
    );
  } catch (err) {
    console.warn(`[quota] could not record ${column} for ${scope}: ${(err as Error)?.message ?? err}`);
  }
}

/** A response said the quota is nearly spent. */
export function noteNearLimit(cloudId: string, reason: string | null): void {
  const scope = scopeFor(cloudId, reason);
  const until = Date.now() + NEAR_HOLD_MS;
  remember(scope, { nearLimitUntilMs: until });
  void write(scope, "near_limit_until", until, reason);
}

/** A 429 whose Retry-After is too long to wait out. */
export function noteLimited(cloudId: string, retryAfterSec: number, reason: string | null): void {
  if (!Number.isFinite(retryAfterSec) || retryAfterSec <= 0) return;
  const scope = scopeFor(cloudId, reason);
  const until = Date.now() + retryAfterSec * 1000;
  remember(scope, { limitedUntilMs: until });
  void write(scope, "limited_until", until, reason);
  console.warn(`[quota] ${scope} rate limited for ${Math.round(retryAfterSec)} s (${reason ?? "no reason given"})`);
}
