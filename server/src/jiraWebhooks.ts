/**
 * Jira dynamic webhooks, behind JIRA_WEBHOOKS=on: Jira says when an issue of a project changes,
 * so the issue copy re-reads that issue on the next load instead of asking "what changed" every
 * 30 s. The "what changed" read stays, every 5 minutes, as the safety net: a webhook expires after
 * 30 days, can be missed while an instance is deploying, and only reports what its registering
 * user can see.
 *
 * Off by default for the reason JIRA_AGILE is: registering needs the `manage:jira-webhook` scope,
 * and a scope the Atlassian app lacks fails /authorize for everyone — enable it on both apps in the
 * developer console first. Jira also requires the webhook URL on the app's own base URL (HTTPS), so
 * a local dev server can register nothing; it logs why and tries again hours later.
 *
 * One webhook per project (`jqlFilter: project = KEY`), registered with the token of whoever opens
 * the project first, refreshed by the same user when a week from expiry. Jira allows 5 per app per
 * user per site; a refused registration is tried again later, with whoever opens the project then.
 *
 * What arrives is trusted only as far as "look at this issue again": a webhook never writes issue
 * content into the copy. Its bearer token is checked (HS256, signed with the app's client secret,
 * as Atlassian documents for OAuth 2.0 apps) and its webhook ids must be ones registered here — a
 * forged call could at most cost a re-read.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { webhooksEnabled } from "./auth/config.js";
import { db } from "./db/pool.js";

export { webhooksEnabled };

export const WEBHOOK_PATH = "/api/jira/webhook";
/** While a project's webhook is live, "what changed" is asked this often instead of every 30 s. */
export const LIVE_DELTA_INTERVAL_MS = 5 * 60_000;
const LIFETIME_MS = 30 * 24 * 60 * 60_000;
const REFRESH_BEFORE_MS = 7 * 24 * 60 * 60_000;
/** After a failed registration, the next try waits this long. */
const RETRY_AFTER_MS = 6 * 60 * 60_000;
/** Each instance checks a project's registration at most this often. */
const CHECK_EVERY_MS = 10 * 60_000;
const LIVE_CACHE_MS = 60_000;
const EVENTS = ["jira:issue_created", "jira:issue_updated", "jira:issue_deleted"];

const b64url = (buf: Buffer) => buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** Pure: whether an Authorization header carries a token signed with `secret` (HS256) that has not expired. */
export function verifyWebhookToken(header: string | undefined, secret: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  const token = header.replace(/^(Bearer|JWT)\s+/i, "").trim();
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const head = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (head?.alg !== "HS256") return false;
    const expected = Buffer.from(b64url(createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest()));
    const given = Buffer.from(parts[2]);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    // A minute of clock skew either way.
    if (typeof claims?.exp === "number" && claims.exp < nowSec - 60) return false;
    return true;
  } catch {
    return false;
  }
}

export interface WebhookEvent {
  webhookIds: number[];
  kind: "created" | "updated" | "deleted" | null;
  issueId: string | null;
}

/** Pure: what a webhook body says, reduced to what the copy acts on. */
export function readWebhookEvent(body: any): WebhookEvent {
  const ids = Array.isArray(body?.matchedWebhookIds) ? body.matchedWebhookIds.map(Number).filter(Number.isFinite) : [];
  const event = String(body?.webhookEvent ?? "");
  const kind = event === "jira:issue_created" ? "created" : event === "jira:issue_updated" ? "updated" : event === "jira:issue_deleted" ? "deleted" : null;
  const issueId = body?.issue?.id !== undefined && body?.issue?.id !== null && /^\d+$/.test(String(body.issue.id)) ? String(body.issue.id) : null;
  return { webhookIds: ids, kind, issueId };
}

/** Applies one event to the copy. Returns false when no webhook of ours matched (ignored). */
export async function applyWebhookEvent(e: WebhookEvent): Promise<boolean> {
  if (e.webhookIds.length === 0 || !e.kind || !e.issueId) return false;
  const regs = await db().query<{ cloud_id: string; project_key: string }>(
    `SELECT cloud_id, project_key FROM jira_webhook WHERE webhook_id = ANY($1)`,
    [e.webhookIds]
  );
  if (regs.rows.length === 0) return false;
  for (const { cloud_id, project_key } of regs.rows) {
    if (e.kind === "deleted") {
      await db().query(`DELETE FROM jira_issue_cache WHERE cloud_id = $1 AND issue_id = $2`, [cloud_id, e.issueId]);
    } else {
      // Re-read by id on the next load; the event's own copy of the issue is not trusted into the cache.
      await db().query(`UPDATE jira_issue_cache SET stale_at = now() WHERE cloud_id = $1 AND issue_id = $2`, [cloud_id, e.issueId]);
    }
    if (e.kind === "created") {
      // Everyone's id list predates the issue.
      await db().query(`UPDATE jira_issue_visibility SET reusable = false WHERE cloud_id = $1 AND project_key = $2`, [cloud_id, project_key]);
    }
    await db().query(
      `INSERT INTO jira_project_sync (cloud_id, project_key, changed_at) VALUES ($1, $2, now())
       ON CONFLICT (cloud_id, project_key) DO UPDATE SET changed_at = now()`,
      [cloud_id, project_key]
    );
  }
  return true;
}

const liveCache = new Map<string, { at: number; live: boolean }>();

/** Whether Jira is currently reporting this project's changes. */
export async function webhookLive(cloudId: string, projectKey: string): Promise<boolean> {
  if (!webhooksEnabled()) return false;
  const key = `${cloudId}|${projectKey}`;
  const hit = liveCache.get(key);
  if (hit && Date.now() - hit.at < LIVE_CACHE_MS) return hit.live;
  let live = false;
  try {
    const res = await db().query<{ ok: boolean }>(
      `SELECT webhook_id IS NOT NULL AND expires_at > now() AS ok FROM jira_webhook WHERE cloud_id = $1 AND project_key = $2`,
      [cloudId, projectKey]
    );
    live = !!res.rows[0]?.ok;
  } catch {
    live = false;
  }
  liveCache.set(key, { at: Date.now(), live });
  return live;
}

/** The part of JiraClient registration needs. */
export interface WebhookJira {
  registerWebhooks(url: string, webhooks: Array<{ events: string[]; jqlFilter: string }>): Promise<Array<{ id: number | null; error: string | null }>>;
  refreshWebhooks(ids: number[]): Promise<string | null>;
}

const lastCheck = new Map<string, number>();

/**
 * Makes sure the project has a live webhook, registering or refreshing it with this user's token.
 * Never throws and never delays the caller (run it without awaiting).
 */
export async function ensureProjectWebhook(
  jira: WebhookJira,
  ctx: { cloudId: string; projectKey: string; accountId: string; baseUrl: string }
): Promise<void> {
  if (!webhooksEnabled()) return;
  const key = `${ctx.cloudId}|${ctx.projectKey}|${ctx.accountId}`;
  if (Date.now() - (lastCheck.get(key) ?? 0) < CHECK_EVERY_MS) return;
  lastCheck.set(key, Date.now());
  try {
    const res = await db().query<{ webhook_id: string | null; registered_by: string | null; expires_at: Date | null; last_attempt_at: Date | null }>(
      `SELECT webhook_id, registered_by, expires_at, last_attempt_at FROM jira_webhook WHERE cloud_id = $1 AND project_key = $2`,
      [ctx.cloudId, ctx.projectKey]
    );
    const row = res.rows[0];
    const now = Date.now();
    const expires = row?.expires_at?.getTime() ?? 0;
    if (row?.webhook_id && expires - now > REFRESH_BEFORE_MS) return;
    if (row?.last_attempt_at && now - row.last_attempt_at.getTime() < RETRY_AFTER_MS && !(row.webhook_id && expires > now)) return;
    // Claim the attempt first, so other instances and users do not all try at once.
    await db().query(
      `INSERT INTO jira_webhook (cloud_id, project_key, last_attempt_at) VALUES ($1, $2, now())
       ON CONFLICT (cloud_id, project_key) DO UPDATE SET last_attempt_at = now()`,
      [ctx.cloudId, ctx.projectKey]
    );

    if (row?.webhook_id && row.registered_by === ctx.accountId && expires > now) {
      const until = await jira.refreshWebhooks([Number(row.webhook_id)]);
      const untilMs = until ? Date.parse(until) : now + LIFETIME_MS;
      await db().query(`UPDATE jira_webhook SET expires_at = $3, last_error = NULL WHERE cloud_id = $1 AND project_key = $2`, [
        ctx.cloudId,
        ctx.projectKey,
        new Date(Number.isNaN(untilMs) ? now + LIFETIME_MS : untilMs).toISOString(),
      ]);
      console.log(`[webhook] ${ctx.projectKey}: refreshed ${row.webhook_id}`);
      return;
    }
    // Another user's webhook can only be refreshed by them: this user registers their own, and the old one
    // simply runs out.
    const [result] = await jira.registerWebhooks(`${ctx.baseUrl.replace(/\/+$/, "")}${WEBHOOK_PATH}`, [
      { events: EVENTS, jqlFilter: `project = ${ctx.projectKey}` },
    ]);
    if (!result?.id) throw new Error(result?.error ?? "Jira did not return a webhook id");
    await db().query(
      `UPDATE jira_webhook SET webhook_id = $3, registered_by = $4, expires_at = $5, last_error = NULL
        WHERE cloud_id = $1 AND project_key = $2`,
      [ctx.cloudId, ctx.projectKey, result.id, ctx.accountId, new Date(now + LIFETIME_MS).toISOString()]
    );
    liveCache.delete(`${ctx.cloudId}|${ctx.projectKey}`);
    console.log(`[webhook] ${ctx.projectKey}: registered ${result.id}`);
  } catch (err) {
    const message = `${(err as Error)?.message ?? err}${(err as { body?: string })?.body ? ` ${(err as { body?: string }).body}` : ""}`.slice(0, 300);
    console.warn(`[webhook] ${ctx.projectKey}: could not register — ${message}`);
    await db()
      .query(`UPDATE jira_webhook SET last_error = $3 WHERE cloud_id = $1 AND project_key = $2`, [ctx.cloudId, ctx.projectKey, message])
      .catch(() => {});
  }
}
