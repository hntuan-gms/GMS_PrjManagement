/**
 * Cookie plumbing. `res.cookie()`/`res.clearCookie()` are Express core, so only
 * *reading* needs code — hence a ~20 line parser instead of a cookie-parser dep.
 */
import type { Request, Response } from "express";
import { loadAuthConfig } from "./config.js";
import { seal, type SealPurpose } from "./crypto.js";

export const SESSION_COOKIE = "gms_sess";
export const ACCESS_COOKIE = "gms_at";
export const OAUTH_COOKIE = "gms_oauth";

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
  name: SealPurpose,
  value: unknown,
  maxAgeMs: number,
  path = "/"
): boolean {
  const blob = seal(name, value);
  if (Buffer.byteLength(blob, "utf8") > MAX_COOKIE_VALUE_BYTES) {
    return false;
  }
  res.cookie(name, blob, baseOptions(path, maxAgeMs));
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

export function clearAuthCookies(res: Response): void {
  clearCookie(res, SESSION_COOKIE);
  clearCookie(res, ACCESS_COOKIE);
  clearCookie(res, OAUTH_COOKIE, "/api/auth");
}
