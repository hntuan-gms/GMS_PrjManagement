/**
 * Configuration for Atlassian OAuth 2.0 (3LO).
 *
 * Validation is lazy-but-memoised rather than done at module load: index.ts calls
 * loadAuthConfig() inside a try/catch so a missing variable produces one readable
 * line instead of an ESM import stack trace. On Cloud Run a boot crash surfaces
 * only as "revision failed to start", so the message has to be worth reading.
 */

export interface EncryptionKey {
  kid: string;
  key: Buffer; // 32 bytes
}

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  appBaseUrl: string;
  /** First entry encrypts; every entry is a decryption candidate (see crypto.ts). */
  keyring: EncryptionKey[];
  /**
   * Atlassian site hostnames whose members may log in, lowercased.
   *
   * This is the access gate, and it deliberately delegates to Jira: a user is
   * allowed in exactly when an admin has already invited them to one of these
   * sites. That covers guests on personal or client-company addresses — which an
   * email-domain rule cannot express without either excluding them or letting in
   * anyone who happens to share a domain.
   */
  allowedSiteHosts: string[];
  /**
   * Lowercase domain marking someone as internal staff, or null to treat everyone
   * as staff. NOT a login gate — it only decides who may use the AI features,
   * which bill against a shared Gemini key.
   */
  staffEmailDomain: string | null;
  cookieSecure: boolean;
}

/**
 * Classic scopes. Do NOT mix these with granular scopes — Atlassian rejects the app.
 *
 * `read:me` is what lets GET https://api.atlassian.com/me return the user's email,
 * which STAFF_EMAIL_DOMAIN uses to decide who may use the AI features. It is
 * granted by the "User identity API" permission in the developer console, which is
 * a SEPARATE product from the Jira API permission — enabling the Jira scopes alone
 * leaves /me at 403.
 *
 * `manage:jira-configuration` is here for exactly one call: GET /group/member,
 * which projectMembers.ts needs to expand the groups a project role is granted
 * to. Without it the gateway answers 401 "scope does not match", and the tab can
 * only show role members added one by one. It is broad — it covers Jira-admin
 * configuration writes — but a token can never do more than its user's own Jira
 * permissions allow, so for a non-admin it adds nothing beyond reading groups.
 *
 * Every scope here must ALSO be enabled on the app in the developer console, on
 * BOTH apps (dev and production, see .env.example). Requesting a scope the app
 * doesn't have fails the authorize step itself, so a mismatch is a login outage
 * for everyone, not a degraded member list. And a scope added here only reaches a
 * user after they log in again: existing refresh tokens keep their old scopes.
 */
export const SCOPES = [
  "read:jira-work",
  "write:jira-work",
  "read:jira-user",
  "manage:jira-configuration",
  "read:me",
  "offline_access",
].join(" ");

export const AUTHORIZE_URL = "https://auth.atlassian.com/authorize";
export const TOKEN_URL = "https://auth.atlassian.com/oauth/token";
export const ACCESSIBLE_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources";
export const JIRA_API_BASE = "https://api.atlassian.com";

/** Path the Atlassian app's Callback URL must point at. */
export const CALLBACK_PATH = "/api/auth/callback";

let cached: AuthConfig | null = null;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `The server cannot start without Atlassian OAuth credentials — see server/.env.example.`
    );
  }
  return value;
}

/**
 * Parses "k2:<base64url 32 bytes>,k1:<base64url 32 bytes>".
 *
 * A keyring rather than a single key so the encryption key can be rotated without
 * logging every user out: prepend a new key, deploy, wait out the cookie Max-Age,
 * then drop the old one.
 */
function parseKeyring(raw: string): EncryptionKey[] {
  const keys: EncryptionKey[] = [];
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(":");
    if (sep <= 0) {
      throw new Error(
        `SESSION_ENCRYPTION_KEYS entry "${trimmed}" is malformed; expected "<kid>:<base64url key>".`
      );
    }
    const kid = trimmed.slice(0, sep);
    const key = Buffer.from(trimmed.slice(sep + 1), "base64url");
    if (key.length !== 32) {
      throw new Error(
        `SESSION_ENCRYPTION_KEYS entry "${kid}" decodes to ${key.length} bytes; AES-256 needs exactly 32. ` +
          `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
      );
    }
    keys.push({ kid, key });
  }
  if (keys.length === 0) {
    throw new Error("SESSION_ENCRYPTION_KEYS contained no usable keys.");
  }
  return keys;
}

/**
 * Accepts either bare hostnames or full URLs, so `gimasys.atlassian.net` and
 * `https://gimasys.atlassian.net/` both work — the value gets copy-pasted from a
 * browser address bar as often as it gets typed.
 */
function parseSiteHosts(raw: string): string[] {
  const hosts = raw
    .split(",")
    .map((entry) => {
      const trimmed = entry.trim().toLowerCase();
      if (!trimmed) return "";
      try {
        return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).host;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  if (hosts.length === 0) {
    throw new Error(
      `ALLOWED_SITE_HOSTS contained no usable hostnames. Expected e.g. "gimasys.atlassian.net".`
    );
  }
  return hosts;
}

export function loadAuthConfig(): AuthConfig {
  if (cached) return cached;

  const appBaseUrl = required("APP_BASE_URL").replace(/\/+$/, "");
  const staff = process.env.STAFF_EMAIL_DOMAIN?.trim().toLowerCase().replace(/^@/, "");

  cached = {
    clientId: required("ATLASSIAN_CLIENT_ID"),
    clientSecret: required("ATLASSIAN_CLIENT_SECRET"),
    appBaseUrl,
    // Derived, never taken from the Host header — that is attacker-controlled, and
    // Atlassian matches the redirect_uri byte-for-byte against the registered value.
    redirectUri: `${appBaseUrl}${CALLBACK_PATH}`,
    keyring: parseKeyring(required("SESSION_ENCRYPTION_KEYS")),
    // Required, not optional: this service is publicly invokable, so an unset
    // value would mean any Atlassian account on earth could sign in. Better a
    // loud boot failure than a silent open door.
    allowedSiteHosts: parseSiteHosts(required("ALLOWED_SITE_HOSTS")),
    staffEmailDomain: staff ? staff : null,
    cookieSecure: process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === "true"
      : process.env.NODE_ENV === "production",
  };
  return cached;
}
