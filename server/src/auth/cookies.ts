/**
 * Cookie plumbing. `res.cookie()`/`res.clearCookie()` are Express core, so only
 * *reading* needs code — hence a ~20 line parser instead of a cookie-parser dep.
 */
import type { Request, Response } from "express";
import { loadAuthConfig } from "./config.js";
import { seal, type SealPurpose } from "./crypto.js";

export const SESSION_COOKIE = "gms_sess";
export const ACCESS_COOKIE = "gms_at";

/**
 * A prefix, not a cookie name — see `oauthCookieName`. A single fixed name here
 * used to mean exactly one login could be in flight per browser at a time. That
 * broke on a machine with more than one Atlassian account: starting a second
 * /login (a new tab, "try a different account") overwrote the first attempt's
 * state before its callback ran, so the first tab came back to /callback with a
 * state the (now-overwritten) cookie no longer held — an `invalid_state` error,
 * and unrecoverable since the redirect back to Atlassian had already happened.
 */
export const OAUTH_COOKIE = "gms_oauth";

/**
 * Each /login gets its own cookie, named after its own `state`. The callback
 * reads `state` off the query string Atlassian echoes back and looks up that
 * exact cookie, so N concurrent logins in N tabs each carry their own slot
 * instead of sharing one — no tab can clobber another's in-flight attempt.
 * `state` is already unguessable (32 random bytes) and base64url-safe, so it
 * doubles as the lookup key with no extra hashing; the sealed cookie VALUE is
 * still what proves authenticity, this only decides which value to read.
 */
export function oauthCookieName(state: string): string {
  return `${OAUTH_COOKIE}_${state}`;
}

/**
 * Browsers cap a cookie at 4KB including name and attributes. Atlassian access
 * tokens are JWTs whose size scales with the granted scopes, so gms_at can
 * legitimately exceed this; when it does we skip the cookie and fall back to the
 * in-memory cache, costing one extra refresh per cold start.
 */
export const MAX_COOKIE_VALUE_BYTES = 3900;

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[name] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

function baseOptions(path: string, maxAgeMs: number) {
  return {
    httpOnly: true,
    // Gated on NODE_ENV: Safari drops Secure cookies on http://localhost entirely.
    secure: loadAuthConfig().cookieSecure,
    // Lax, NEVER Strict. The OAuth callback is a top-level cross-site navigation
    // from auth.atlassian.com; Strict withholds the cookie on it and the state
    // check then fails on every single login.
    sameSite: "lax" as const,
    path,
    maxAge: maxAgeMs,
  };
}

/** Returns false when the sealed value was too large to store (caller may care). */
export function setSealedCookie(
  res: Response,
  purpose: SealPurpose,
  value: unknown,
  maxAgeMs: number,
  path = "/",
  // Distinct from `purpose` only for the OAuth flow cookie, which is named per
  // `state` (see oauthCookieName) while still sealed under the fixed "gms_oauth"
  // AAD — the cookie's NAME is a lookup key, its sealed VALUE is what Express
  // and the browser never get to see or tamper with.
  cookieName: string = purpose
): boolean {
  const blob = seal(purpose, value);
  if (Buffer.byteLength(blob, "utf8") > MAX_COOKIE_VALUE_BYTES) {
    return false;
  }
  res.cookie(cookieName, blob, baseOptions(path, maxAgeMs));
  return true;
}

export function clearCookie(res: Response, name: string, path = "/"): void {
  res.clearCookie(name, {
    httpOnly: true,
    secure: loadAuthConfig().cookieSecure,
    sameSite: "lax",
    path,
  });
}

/**
 * Logs the user out: session + access only. Deliberately does NOT touch any
 * in-flight OAuth flow cookie — since those are now per-state (oauthCookieName),
 * there is no single fixed name to clear, and an abandoned one is harmless: it
 * expires on its own in OAUTH_MAX_AGE_MS and can't be used without the matching
 * state round-tripping through Atlassian first.
 */
export function clearAuthCookies(res: Response): void {
  clearCookie(res, SESSION_COOKIE);
  clearCookie(res, ACCESS_COOKIE);
}
