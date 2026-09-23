/**
 * The Atlassian refresh token, kept in Postgres instead of the session cookie.
 *
 * It's the one field in a session with no size ceiling: an account that belongs
 * to several Atlassian organizations gets a noticeably larger refresh token, and
 * that — not anything this app does — is what pushed some real logins over the
 * cookie's ~3900-byte budget (SessionTooLargeError). Everything else in
 * SessionData is small and fixed-size regardless of account, so this was the
 * only field that needed to move.
 *
 * Keyed by (cloudId, accountId), not a session id: that pair already uniquely
 * identifies one Atlassian identity on one site, which is exactly what a
 * session cookie carries, so the cookie doesn't need to name a row — it can
 * always be found from data already in the cookie.
 *
 * Sealed under its own AAD purpose (see crypto.ts) before storage, so a
 * Postgres dump or an operator with DB access doesn't hand out live Jira
 * credentials in plaintext — the same protection the cookie gave it before.
 */
import { db } from "../db/pool.js";
import { seal, unseal } from "./crypto.js";

export async function saveRefreshToken(
  cloudId: string,
  accountId: string,
  refreshToken: string
): Promise<void> {
  const sealed = seal("gms_refresh", refreshToken);
  await db().query(
    `INSERT INTO oauth_refresh_token (cloud_id, account_id, refresh_token)
     VALUES ($1, $2, $3)
     ON CONFLICT (cloud_id, account_id) DO UPDATE SET
       refresh_token = EXCLUDED.refresh_token,
       updated_at    = now()`,
    [cloudId, accountId, sealed]
  );
}

/** Null means "no stored token" — a dead session as far as the caller is concerned. */
export async function loadRefreshToken(cloudId: string, accountId: string): Promise<string | null> {
  const { rows } = await db().query<{ refresh_token: string }>(
    `SELECT refresh_token FROM oauth_refresh_token WHERE cloud_id = $1 AND account_id = $2`,
    [cloudId, accountId]
  );
  if (rows.length === 0) return null;
  return unseal<string>("gms_refresh", rows[0].refresh_token);
}

/** Called on logout and on a confirmed-dead grant, so a token nobody can use any more doesn't just sit there. */
export async function deleteRefreshToken(cloudId: string, accountId: string): Promise<void> {
  await db().query(`DELETE FROM oauth_refresh_token WHERE cloud_id = $1 AND account_id = $2`, [
    cloudId,
    accountId,
  ]);
}
