/**
 * OAuth 2.0 (3LO) endpoints. Mounted at /api/auth, BEFORE requireAuth — the login
 * and callback routes are necessarily reachable while logged out.
 */
import { Router } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  AtlassianAuthError,
  buildAuthorizeUrl,
  exchangeCode,
  getAccessibleResources,
  getTokenOwner,
} from "../auth/atlassian.js";
import { loadAuthConfig } from "../auth/config.js";
import { clearAuthCookies, clearCookie, oauthCookieName } from "../auth/cookies.js";
import { requireAuth } from "../auth/middleware.js";
import { forgetProjectList, resolveProject } from "../auth/projectScope.js";
import {
  commitAccess,
  commitOAuthFlow,
  commitSession,
  readOAuthFlow,
  readSession,
  type SessionData,
} from "../auth/session.js";
import { deleteRefreshToken, saveRefreshToken } from "../auth/refreshTokenStore.js";
import { forgetTokens } from "../auth/tokens.js";
import { badRequest } from "../errors.js";
import type { SessionMeta } from "../types.js";

export const authRouter = Router();

const base64url = (buf: Buffer) => buf.toString("base64url");

/**
 * Only same-origin absolute paths survive. Rejecting "//host" and "/\host" matters:
 * both are protocol-relative and would redirect off-site.
 */
function safeReturnTo(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (/[\\\x00-\x1f]/.test(raw)) return "/";
  const beforeSlash = raw.slice(1).split("/")[0] ?? "";
  if (beforeSlash.includes(":")) return "/";
  return raw;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

authRouter.get("/login", (req, res) => {
  const state = base64url(randomBytes(32));
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());

  // State and PKCE verifier both ride in a sealed cookie rather than a module-level
  // Set: on Cloud Run the container can be replaced between /login and /callback,
  // which would break every in-flight login.
  commitOAuthFlow(res, {
    v: 1,
    state,
    codeVerifier,
    returnTo: safeReturnTo(req.query.returnTo),
    createdAt: Date.now(),
  });

  res.setHeader("Cache-Control", "no-store");
  res.redirect(buildAuthorizeUrl({ state, codeChallenge }));
});

authRouter.get("/callback", async (req, res, next) => {
  const cfg = loadAuthConfig();
  const fail = (code: string) => {
    clearAuthCookies(res);
    res.setHeader("Cache-Control", "no-store");
    res.redirect(`/?auth_error=${encodeURIComponent(code)}`);
  };

  try {
    if (typeof req.query.error === "string") {
      fail(req.query.error);
      return;
    }

    const returnedState = typeof req.query.state === "string" ? req.query.state : "";
    // Which of possibly several in-flight logins (one per tab/account the user
    // tried) this callback belongs to — each has its own cookie, so finding the
    // wrong one here would mean Atlassian sent back a state we never issued.
    const flow = returnedState ? readOAuthFlow(req, returnedState) : null;
    // Clear it immediately so a replayed callback URL cannot reuse the same code
    // — scoped to only THIS flow's cookie, so a login still in progress in
    // another tab is untouched.
    if (returnedState) clearCookie(res, oauthCookieName(returnedState), "/api/auth");
    if (!flow) {
      fail("invalid_state");
      return;
    }

    if (!constantTimeEquals(returnedState, flow.state)) {
      fail("invalid_state");
      return;
    }

    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) {
      fail("missing_code");
      return;
    }

    const bundle = await exchangeCode(code, flow.codeVerifier);
    const owner = await getTokenOwner(bundle.accessToken);

    const resources = await getAccessibleResources(bundle.accessToken);
    if (resources.length === 0) {
      fail("no_site_access");
      return;
    }

    // Pick OUR site by hostname, never resources[0]. External guests routinely
    // have their own company's Atlassian site too, and this list has no
    // documented order — taking the first one would drop a client guest into
    // their own Jira instead of ours.
    const site = resources.find((r) => {
      try {
        return cfg.allowedSiteHosts.includes(new URL(r.url).host.toLowerCase());
      } catch {
        return false;
      }
    });
    if (!site) {
      // Access is delegated to Jira: being invited to the site IS the permission.
      fail("site_not_allowed");
      return;
    }

    // Decided once, here, so the rest of the app never needs the email again.
    const email = owner.email?.toLowerCase() ?? "";
    const staff = cfg.staffEmailDomain ? email.endsWith(`@${cfg.staffEmailDomain}`) : true;

    // Written to Postgres, not the cookie: this is the one field with no size
    // ceiling (see refreshTokenStore.ts), and it's what SessionTooLargeError was
    // actually about for an account belonging to several Atlassian orgs.
    await saveRefreshToken(site.id, owner.accountId, bundle.refreshToken);

    const session: SessionData = {
      v: 2,
      cloudId: site.id,
      siteUrl: site.url.replace(/\/+$/, ""),
      siteName: site.name,
      accountId: owner.accountId,
      displayName: owner.displayName,
      avatarUrl: owner.avatarUrl,
      // Chosen on the next screen; the client routes to the picker while it is null.
      projectKey: null,
      projectName: null,
      staff,
    };
    commitSession(res, session);
    commitAccess(res, {
      v: 1,
      accessToken: bundle.accessToken,
      expiresAt: bundle.expiresAt,
      accountId: owner.accountId,
    });

    res.setHeader("Cache-Control", "no-store");
    res.redirect(safeReturnTo(flow.returnTo));
  } catch (err) {
    console.error("[auth] callback failed:", err);
    // This route is reached by a top-level browser navigation, so it must never
    // hand back JSON — that renders as a white page of error text with no way
    // forward. Always land the user back on the login screen with a message.
    fail(err instanceof AtlassianAuthError ? err.code : "login_failed");
  }
});

/** Session probe. Returns 401 when logged out — the client treats that as "show login". */
authRouter.get("/me", requireAuth, async (req, res, next) => {
  const { session, jira } = req.auth!;
  let project;
  try {
    // This tab's project (X-Project-Key) when it names one the account can browse, else the
    // session's — so a tab opened next to another one on a different project keeps its own.
    project = await resolveProject(req, jira, session);
  } catch (err) {
    next(err);
    return;
  }
  const meta: SessionMeta = {
    user: {
      accountId: session.accountId,
      displayName: session.displayName,
      avatarUrl: session.avatarUrl,
    },
    site: { cloudId: session.cloudId, url: session.siteUrl, name: session.siteName },
    project,
    startDateFieldId: req.auth!.startDateFieldId,
    // This is the copy the client actually reads — /api/meta returns the same
    // shape but nothing fetches it, so changing only that one left the warning
    // strip on screen after the move to Postgres.
    overlayEphemeral: false,
    staff: session.staff,
  };
  res.setHeader("Cache-Control", "no-store");
  res.json(meta);
});

/** Projects this user can browse — the picker's source. */
authRouter.get("/projects", requireAuth, async (req, res, next) => {
  try {
    res.json(await req.auth!.jira.listProjects());
  } catch (err) {
    next(err);
  }
});

/**
 * Binds a project to the session. The submitted key is validated against the live
 * accessible list, so this cannot be used to point a session at an arbitrary value.
 */
authRouter.post("/project", requireAuth, async (req, res, next) => {
  try {
    const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
    if (!key) {
      next(badRequest("Thiếu mã dự án."));
      return;
    }
    const projects = await req.auth!.jira.listProjects();
    const match = projects.find((p) => p.key === key);
    if (!match) {
      next(badRequest(`Bạn không có quyền truy cập dự án ${key}.`));
      return;
    }
    const session = { ...req.auth!.session, projectKey: match.key, projectName: match.name };
    commitSession(res, session);
    res.json({ key: match.key, name: match.name });
  } catch (err) {
    next(err);
  }
});

/**
 * Local logout only. Atlassian publishes no endpoint to revoke a 3LO refresh
 * token, so the grant stays live until it expires; the user must revoke it from
 * their Atlassian account settings. Do not claim otherwise in the UI.
 */
authRouter.post("/logout", async (req, res) => {
  // Read directly rather than via requireAuth: logging out must work even when the
  // session is already expired or unparseable.
  const session = readSession(req);
  if (session) {
    forgetTokens(session.cloudId, session.accountId);
    forgetProjectList(session.cloudId, session.accountId);
    // Best-effort: clearing the cookie is what actually logs the browser out,
    // so a DB hiccup here must not turn a clean logout into a 500.
    await deleteRefreshToken(session.cloudId, session.accountId).catch(() => {});
  }
  clearAuthCookies(res);
  res.setHeader("Cache-Control", "no-store");
  res.status(204).end();
});
