/**
 * Access-token freshness, and the three mechanisms that make Atlassian's ROTATING
 * refresh tokens survive real browser traffic.
 *
 * Rotation means each refresh invalidates the token that produced it. A browser
 * firing three API calls at once would otherwise refresh three times, and the
 * second and third would present an already-consumed token and get invalid_grant
 * — i.e. a random logout mid-edit.
 */
import { AtlassianAuthError, refreshTokens, type TokenBundle } from "./atlassian.js";
import { loadRefreshToken, saveRefreshToken } from "./refreshTokenStore.js";
import type { AccessData, SessionData } from "./session.js";

/** Refresh this far ahead of expiry so a request never races the boundary. */
const FRESHNESS_MARGIN_MS = 120_000;
const GRACE_TTL_MS = 120_000;

/**
 * Every in-memory cache here is keyed by (cloudId, accountId) — the identity a
 * session cookie carries — rather than by the refresh token string itself. The
 * token now lives in Postgres and rotates there; a cache keyed on its value
 * would mean re-deriving that value (a DB read) just to compute a cache key,
 * defeating the point of caching it at all.
 */
const identityKey = (cloudId: string, accountId: string) => `${cloudId}:${accountId}`;

/** (1) In-flight dedupe: concurrent callers await one network round trip. */
const inFlight = new Map<string, Promise<TokenBundle>>();

/**
 * (2) Rotation grace cache. Covers the window where request A has refreshed and
 * Postgres now holds the new token, while request B — already under way,
 * having read the old token before A's write landed — arrives and would
 * otherwise present an already-consumed refresh token to Atlassian.
 */
const graceByIdentity = new Map<string, { bundle: TokenBundle; expiresAt: number }>();

/** Access tokens too large for the gms_at cookie live here instead. */
const accessCache = new Map<string, { accessToken: string; expiresAt: number }>();

function sweep(): void {
  const now = Date.now();
  for (const [k, v] of graceByIdentity) if (v.expiresAt <= now) graceByIdentity.delete(k);
  for (const [k, v] of accessCache) if (v.expiresAt <= now) accessCache.delete(k);
}

async function rotate(cloudId: string, accountId: string): Promise<TokenBundle> {
  sweep();
  const key = identityKey(cloudId, accountId);

  const grace = graceByIdentity.get(key);
  if (grace && grace.expiresAt > Date.now()) return grace.bundle;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const pending = (async () => {
    const refreshToken = await loadRefreshToken(cloudId, accountId);
    if (!refreshToken) {
      // Nothing to refresh with — a stored token that was deleted (logout on
      // another device, a wiped table) or a pre-migration session cookie that
      // never had a Postgres row to begin with. Same effect as a dead grant:
      // the only way forward is a full re-login, so it's reported the same way.
      throw new AtlassianAuthError("invalid_grant", "No stored refresh token for this session.");
    }
    const bundle = await refreshTokens(refreshToken);
    await saveRefreshToken(cloudId, accountId, bundle.refreshToken);
    graceByIdentity.set(key, { bundle, expiresAt: Date.now() + GRACE_TTL_MS });
    accessCache.set(key, { accessToken: bundle.accessToken, expiresAt: bundle.expiresAt });
    return bundle;
  })();

  inFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    inFlight.delete(key);
  }
}

export interface EnsureResult {
  accessToken: string;
  access: AccessData;
  /**
   * True when the caller must write the access cookie back before responding.
   * The refresh token itself rotating no longer touches the session cookie at
   * all — it's persisted straight to Postgres — so this is about `gms_at` only.
   */
  rotated: boolean;
}

/**
 * Called from middleware BEFORE the route runs — never lazily mid-response.
 * res.cookie() after res.json() is a no-op, and silently dropping a rotated
 * access token logs the user out on their next request with no way to diagnose it.
 */
export async function ensureAccessToken(
  session: SessionData,
  cached: AccessData | null
): Promise<EnsureResult> {
  const now = Date.now();

  if (cached && cached.expiresAt - now > FRESHNESS_MARGIN_MS) {
    return { accessToken: cached.accessToken, access: cached, rotated: false };
  }

  const key = identityKey(session.cloudId, session.accountId);
  const memo = accessCache.get(key);
  if (memo && memo.expiresAt - now > FRESHNESS_MARGIN_MS) {
    const access: AccessData = {
      v: 1,
      accessToken: memo.accessToken,
      expiresAt: memo.expiresAt,
      accountId: session.accountId,
    };
    return { accessToken: memo.accessToken, access, rotated: true };
  }

  const bundle = await rotate(session.cloudId, session.accountId);
  const access: AccessData = {
    v: 1,
    accessToken: bundle.accessToken,
    expiresAt: bundle.expiresAt,
    accountId: session.accountId,
  };
  return { accessToken: bundle.accessToken, access, rotated: true };
}

/** Best-effort in-memory eviction on logout. The Postgres row is dropped separately (refreshTokenStore.deleteRefreshToken) — there is no Atlassian endpoint to revoke the grant itself. */
export function forgetTokens(cloudId: string, accountId: string): void {
  const key = identityKey(cloudId, accountId);
  graceByIdentity.delete(key);
  accessCache.delete(key);
}

export { AtlassianAuthError };
