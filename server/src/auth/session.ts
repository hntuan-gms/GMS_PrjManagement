/**
 * Session shape and cookie round-tripping.
 *
 * The session is stateless: everything needed to act on the user's behalf is in
 * the sealed gms_sess cookie. A server-side map would be simpler but Cloud Run
 * replaces the container on every deploy and scales to zero after ~15 minutes
 * idle, so in-memory sessions would log people out several times a day.
 */
import type { Request, Response } from "express";
import {
  ACCESS_COOKIE,
  SESSION_COOKIE,
  oauthCookieName,
  parseCookies,
  setSealedCookie,
} from "./cookies.js";
import { unseal } from "./crypto.js";

export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const ACCESS_MAX_AGE_MS = 55 * 60 * 1000; // just under the ~1h token life
export const OAUTH_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Durable half — survives redeploys. Kept small so it never nears the 4KB cap:
 * the refresh token, the one field here with no size ceiling, lives in Postgres
 * instead (auth/refreshTokenStore.ts) and is looked up by (cloudId, accountId)
 * when a route actually needs it, rather than carried on every request.
 */
export interface SessionData {
  v: 1;
  cloudId: string;
  /** Human site URL; browse links must use this, never api.atlassian.com. */
  siteUrl: string;
  siteName: string;
  accountId: string;
  displayName: string;
  avatarUrl: string | null;
  /** Chosen by the user after login; null until then. */
  projectKey: string | null;
  projectName: string | null;
}

/** Volatile half — a cache, never authoritative. */
export interface AccessData {
  v: 1;
  accessToken: string;
  expiresAt: number;
  /** Ties the blob to one session so a stale gms_at can't ride along. */
  accountId: string;
}

export interface OAuthFlowData {
  v: 1;
  state: string;
  codeVerifier: string;
  returnTo: string;
  createdAt: number;
}

export function readSession(req: Request): SessionData | null {
  const cookies = parseCookies(req);
  const session = unseal<SessionData>(SESSION_COOKIE, cookies[SESSION_COOKIE]);
  // accountId matters as much as cloudId now — together they're the lookup key
  // for the refresh token in Postgres, not just a display value.
  if (!session || session.v !== 1 || !session.cloudId || !session.accountId) return null;
  return session;
}

export function readAccess(req: Request, session: SessionData): AccessData | null {
  const cookies = parseCookies(req);
  const access = unseal<AccessData>(ACCESS_COOKIE, cookies[ACCESS_COOKIE]);
  if (!access || access.v !== 1) return null;
  // A gms_at left over from a different login must not be used.
  if (access.accountId !== session.accountId) return null;
  return access;
}

/**
 * `state` is what Atlassian echoes back on the callback query string — the
 * caller must extract it from `req.query.state` itself before this can run,
 * since it picks which of possibly several concurrent flows' cookies to read.
 */
export function readOAuthFlow(req: Request, state: string): OAuthFlowData | null {
  const cookies = parseCookies(req);
  const flow = unseal<OAuthFlowData>("gms_oauth", cookies[oauthCookieName(state)]);
  if (!flow || flow.v !== 1) return null;
  if (Date.now() - flow.createdAt > OAUTH_MAX_AGE_MS) return null;
  return flow;
}

/**
 * Thrown when the sealed session blob won't fit in a cookie (setSealedCookie
 * returned false). This must never be swallowed: silently skipping the
 * Set-Cookie here means OAuth "succeeded" but the user has no session at all,
 * which looks identical to — and used to be mistaken for — a SameSite bug.
 */
export class SessionTooLargeError extends Error {
  constructor() {
    super(
      "Không thể lưu phiên đăng nhập: dữ liệu phiên vượt quá giới hạn cookie (~3900 bytes)."
    );
    this.name = "SessionTooLargeError";
  }
}

export function commitSession(res: Response, session: SessionData): void {
  const stored = setSealedCookie(res, SESSION_COOKIE, session, SESSION_MAX_AGE_MS);
  if (!stored) {
    throw new SessionTooLargeError();
  }
}

export function commitAccess(res: Response, access: AccessData): void {
  // Best effort: an oversized token simply isn't cached, costing one refresh on
  // the next cold start. setSealedCookie already enforces the size guard.
  setSealedCookie(res, ACCESS_COOKIE, access, ACCESS_MAX_AGE_MS);
}

export function commitOAuthFlow(res: Response, flow: OAuthFlowData): void {
  // Named after this flow's own state (see oauthCookieName) so starting another
  // login elsewhere — a second tab, a different Atlassian account — gets its own
  // cookie instead of overwriting this one.
  setSealedCookie(res, "gms_oauth", flow, OAUTH_MAX_AGE_MS, "/api/auth", oauthCookieName(flow.state));
}
