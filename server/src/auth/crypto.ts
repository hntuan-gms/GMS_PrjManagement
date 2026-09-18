/**
 * Authenticated encryption for cookie payloads. AES-256-GCM via node:crypto — no
 * new dependency, and no JWS/JWE signature-stripping class of bug to worry about.
 *
 * Wire format: v1.<kid>.<iv>.<tag>.<ciphertext>   (each part base64url)
 *
 * The cookie's purpose string is used as GCM additional authenticated data, so a
 * sealed access-token blob cannot be replayed into the session cookie slot even
 * though both are encrypted under the same key.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { loadAuthConfig } from "./config.js";

const VERSION = "v1";
const IV_BYTES = 12;

export type SealPurpose = "gms_sess" | "gms_at" | "gms_oauth";

export function seal(purpose: SealPurpose, value: unknown): string {
  const { keyring } = loadAuthConfig();
  const active = keyring[0]!; // parseKeyring guarantees at least one
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", active.key, iv);
  cipher.setAAD(Buffer.from(purpose, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(value), "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    active.kid,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Returns null on ANY failure — unknown key id, tampered tag, truncated cookie,
 * unparseable JSON. A mangled cookie means "logged out", never a 500.
 */
export function unseal<T>(purpose: SealPurpose, blob: string | undefined): T | null {
  if (!blob) return null;
  const parts = blob.split(".");
  if (parts.length !== 5) return null;
  const [version, kid, ivPart, tagPart, ctPart] = parts as [string, string, string, string, string];
  if (version !== VERSION) return null;

  const { keyring } = loadAuthConfig();
  const entry = keyring.find((k) => k.kid === kid);
  if (!entry) return null; // key was rotated out

  try {
    const decipher = createDecipheriv("aes-256-gcm", entry.key, Buffer.from(ivPart, "base64url"));
    decipher.setAAD(Buffer.from(purpose, "utf8"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ctPart, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    return null;
  }
}
