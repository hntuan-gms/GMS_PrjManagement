import { Router } from "express";
import { loadAuthConfig } from "../auth/config.js";
import { applyWebhookEvent, readWebhookEvent, verifyWebhookToken, webhooksEnabled } from "../jiraWebhooks.js";

/**
 * Where Jira posts issue events (jiraWebhooks.ts). Mounted before the API's requireAuth: Jira has
 * no session cookie. Its bearer token is checked instead, and anything else answers 401. The answer
 * is always quick and says nothing about what was found — Jira only needs a 2xx.
 */
export const webhookRouter = Router();

let unsignedWarned = false;

webhookRouter.post("/", async (req, res) => {
  if (!webhooksEnabled()) {
    res.status(404).end();
    return;
  }
  if (!verifyWebhookToken(req.get("authorization"), loadAuthConfig().clientSecret)) {
    if (!unsignedWarned) {
      unsignedWarned = true;
      console.warn(`[webhook] refused a call without a valid token (header: ${req.get("authorization") ? "present" : "absent"})`);
    }
    res.status(401).end();
    return;
  }
  try {
    await applyWebhookEvent(readWebhookEvent(req.body));
  } catch (err) {
    console.warn(`[webhook] could not apply an event: ${(err as Error)?.message ?? err}`);
  }
  res.status(204).end();
});
