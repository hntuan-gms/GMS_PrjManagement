/**
 * Raw HTTP against Atlassian's OAuth endpoints. Knows nothing about cookies or
 * sessions so it stays trivially testable with curl.
 */
import {
  ACCESSIBLE_RESOURCES_URL,
  AUTHORIZE_URL,
  SCOPES,
  TOKEN_URL,
  loadAuthConfig,
} from "./config.js";

export interface TokenBundle {
  accessToken: string;
  /** Atlassian rotates this on every use; the previous value dies immediately. */
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  scope: string;
}

export interface AccessibleResource {
  id: string; // cloudId
  url: string; // human site URL, e.g. https://gimasys.atlassian.net
  name: string;
  avatarUrl?: string;
  scopes?: string[];
}

export class AtlassianAuthError extends Error {
  constructor(
    /** Atlassian's machine-readable code, e.g. "invalid_grant". */
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AtlassianAuthError";
  }

  /** True when the refresh token is genuinely dead and re-login is the only fix. */
  get isDeadGrant(): boolean {
    return this.code === "invalid_grant";
  }
}

export function buildAuthorizeUrl(opts: { state: string; codeChallenge: string }): string {
  const cfg = loadAuthConfig();
  const params = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: cfg.clientId,
    scope: SCOPES,
    redirect_uri: cfg.redirectUri,
    state: opts.state,
    response_type: "code",
    prompt: "consent",
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function postToken(body: Record<string, string>): Promise<TokenBundle> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  if (!res.ok) {
    throw new AtlassianAuthError(
      parsed.error ?? `http_${res.status}`,
      parsed.error_description ?? `Atlassian token endpoint returned ${res.status}`
    );
  }
  if (!parsed.access_token || !parsed.refresh_token) {
    throw new AtlassianAuthError(
      "missing_tokens",
      "Atlassian token response did not include both an access token and a refresh token. " +
        "Check that offline_access is enabled on the app."
    );
  }
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresAt: Date.now() + Number(parsed.expires_in ?? 3600) * 1000,
    scope: parsed.scope ?? "",
  };
}

export async function exchangeCode(code: string, codeVerifier: string): Promise<TokenBundle> {
  const cfg = loadAuthConfig();
  const bundle = await postToken({
    grant_type: "authorization_code",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    // Must byte-match the value sent to /authorize.
    redirect_uri: cfg.redirectUri,
    code_verifier: codeVerifier,
  });

  // Fail the login now rather than with an opaque 403 twenty minutes later.
  const granted = new Set(bundle.scope.split(/\s+/).filter(Boolean));
  const missing = SCOPES.split(" ").filter((s) => !granted.has(s));
  if (granted.size > 0 && missing.length > 0) {
    throw new AtlassianAuthError(
      "insufficient_scope",
      `Atlassian granted only [${bundle.scope}]; missing [${missing.join(", ")}]. ` +
        `Enable these scopes on the app in the developer console.`
    );
  }
  return bundle;
}

export async function refreshTokens(refreshToken: string): Promise<TokenBundle> {
  const cfg = loadAuthConfig();
  return postToken({
    grant_type: "refresh_token",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
  });
}

export async function getAccessibleResources(accessToken: string): Promise<AccessibleResource[]> {
  const res = await fetch(ACCESSIBLE_RESOURCES_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new AtlassianAuthError(
      `http_${res.status}`,
      `Could not list accessible Atlassian sites (${res.status}).`
    );
  }
  return (await res.json()) as AccessibleResource[];
}

/**
 * The acting user's identity. Served by the Atlassian identity API rather than
 * Jira's /myself so it is available before a site has been chosen — the email is
 * needed for the domain gate at callback time.
 */
export async function getTokenOwner(
  accessToken: string
): Promise<{ accountId: string; email: string | null; displayName: string; avatarUrl: string | null }> {
  const res = await fetch("https://api.atlassian.com/me", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    // The token is valid (it was just issued) — this is the User identity API
    // permission missing on the app, which is enabled separately from the Jira
    // scopes and is easy to overlook.
    throw new AtlassianAuthError(
      "identity_scope_missing",
      "GET /me returned " +
        res.status +
        ". Enable the 'User identity API' permission (read:me) on the app at " +
        "developer.atlassian.com/console/myapps, then log in again."
    );
  }
  if (!res.ok) {
    throw new AtlassianAuthError(`http_${res.status}`, `Could not read Atlassian profile (${res.status}).`);
  }
  const me = (await res.json()) as any;
  return {
    accountId: me.account_id,
    email: me.email ?? null,
    displayName: me.name ?? me.nickname ?? "Người dùng Atlassian",
    avatarUrl: me.picture ?? null,
  };
}
