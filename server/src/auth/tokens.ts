/**
 * Access-token freshness, and the three mechanisms that make Atlassian's ROTATING
 * refresh tokens survive real browser traffic.
 *
 * Rotation means each refresh invalidates the token that produced it. A browser
 * firing three API calls at once would otherwise refresh three times, and the
 * second and third would present an already-consumed token and get invalid_grant
 * — i.e. a random logout mid-edit.
 */
import { createHash } from "node:crypto";
import { AtlassianAuthError, refreshTokens, type TokenBundle } from "./atlassian.js";
import type { AccessData, SessionData } from "./session.js";

/** Refresh this far ahead of expiry so a request never races the boundary. */
const FRESHNESS_MARGIN_MS = 120_000;
const GRACE_TTL_MS = 120_000;

const fingerprint = (token: string) => createHash("sha256").update(token).digest("base64url");

/** (1) In-flight dedupe: concurrent callers await one network round trip. */
const inFlight = new Map<string, Promise<TokenBundle>>();

/**
 * (2) Rotation grace cache. Covers the window where request A has refreshed and
 * its Set-Cookie is still travelling, while request B — dispatched before the
 * browser stored it — arrives carrying the already-consumed refresh token.
 */
const graceByOldToken = new Map<string, { bundle: TokenBundle; expiresAt: number }>();

/** Access tokens too large for the gms_at cookie live here instead. */
const accessCache = new Map<string, { accessToken: string; expiresAt: number }>();

function sweep(): void {
  const now = Date.now();
  for (const [k, v] of graceByOldToken) if (v.expiresAt <= now) graceByOldToken.delete(k);
  for (const [k, v] of accessCache) if (v.expiresAt <= now) accessCache.delete(k);
}

async function rotate(refreshToken: string): Promise<TokenBundle> {
  sweep();
  const key = fingerprint(refreshToken);

  const grace = graceByOldToken.get(key);
  if (grace && grace.expiresAt > Date.now()) return grace.bundle;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const pending = (async () => {
    const bundle = await refreshTokens(refreshToken);
    graceByOldToken.set(key, { bundle, expiresAt: Date.now() + GRACE_TTL_MS });
    accessCache.set(fingerprint(bundle.refreshToken), {
      accessToken: bundle.accessToken,
      expiresAt: bundle.expiresAt,
    });
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
  /** Same object when nothing changed; a new one when the refresh token rotated. */
  session: SessionData;
  access: AccessData;
  /** True when the caller must write both cookies back before responding. */
  rotated: boolean;
}

/**
 * Called from middleware BEFORE the route runs — never lazily mid-response.
 * res.cookie() after res.json() is a no-op, and silently dropping a rotated
 * refresh token logs the user out on their next request with no way to diagnose it.
 */
export async function ensureAccessToken(
  session: SessionData,
  cached: AccessData | null
): Promise<EnsureResult> {
  const now = Date.now();

  if (cached && cached.expiresAt - now > FRESHNESS_MARGIN_MS) {
    return { accessToken: cached.accessToken, session, access: cached, rotated: false };
  }

  const memo = accessCache.get(fingerprint(session.refreshToken));
  if (memo && memo.expiresAt - now > FRESHNESS_MARGIN_MS) {
    const access: AccessData = {
      v: 1,
      accessToken: memo.accessToken,
      expiresAt: memo.expiresAt,
      accountId: session.accountId,
    };
    return { accessToken: memo.accessToken, session, access, rotated: true };
  }

  const bundle = await rotate(session.refreshToken);
  const nextSession: SessionData = { ...session, refreshToken: bundle.refreshToken };
  const access: AccessData = {
    v: 1,
    accessToken: bundle.accessToken,
    expiresAt: bundle.expiresAt,
    accountId: session.accountId,
  };
  return { accessToken: bundle.accessToken, session: nextSession, access, rotated: true };
}

/** Best-effort eviction on logout. There is no Atlassian endpoint to revoke the grant. */
export function forgetTokens(refreshToken: string): void {
  const key = fingerprint(refreshToken);
  graceByOldToken.delete(key);
  accessCache.delete(key);
}

export { AtlassianAuthError };
