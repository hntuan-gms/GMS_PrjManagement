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
  /** Lowercase domain a user's email must end with, or null to allow any account. */
  allowedEmailDomain: string | null;
  cookieSecure: boolean;
}

/** Classic scopes. Do NOT mix these with granular scopes — Atlassian rejects the app. */
export const SCOPES = [
  "read:jira-work",
  "write:jira-work",
  "read:jira-user",
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

export function loadAuthConfig(): AuthConfig {
  if (cached) return cached;

  const appBaseUrl = required("APP_BASE_URL").replace(/\/+$/, "");
  const domain = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase().replace(/^@/, "");

  cached = {
    clientId: required("ATLASSIAN_CLIENT_ID"),
    clientSecret: required("ATLASSIAN_CLIENT_SECRET"),
    appBaseUrl,
    // Derived, never taken from the Host header — that is attacker-controlled, and
    // Atlassian matches the redirect_uri byte-for-byte against the registered value.
    redirectUri: `${appBaseUrl}${CALLBACK_PATH}`,
    keyring: parseKeyring(required("SESSION_ENCRYPTION_KEYS")),
    allowedEmailDomain: domain ? domain : null,
    cookieSecure: process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === "true"
      : process.env.NODE_ENV === "production",
  };
  return cached;
}
