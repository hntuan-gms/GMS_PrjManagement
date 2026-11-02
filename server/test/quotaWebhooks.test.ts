import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { scopeFor, viewOf } from "../src/jiraQuota.js";
import { readWebhookEvent, verifyWebhookToken } from "../src/jiraWebhooks.js";

const b64 = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
function token(secret: string, claims: Record<string, unknown>, alg = "HS256"): string {
  const head = b64({ alg, typ: "JWT" });
  const body = b64(claims);
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

describe("jiraQuota", () => {
  it("the app-wide pool unless Jira names the site's own quota", () => {
    assert.equal(scopeFor("c1", "jira-quota-global-based"), "app");
    assert.equal(scopeFor("c1", null), "app");
    assert.equal(scopeFor("c1", "jira-quota-tenant-based"), "site:c1");
  });
  it("near the limit defers background work; a long refusal also says until when", () => {
    const now = 1_000_000;
    assert.deepEqual(viewOf([], now), { deferBackground: false, limitedUntilMs: null });
    assert.deepEqual(viewOf([{ nearLimitUntilMs: now + 1, limitedUntilMs: null }], now), { deferBackground: true, limitedUntilMs: null });
    assert.deepEqual(viewOf([{ nearLimitUntilMs: now - 1, limitedUntilMs: now + 5000 }], now), { deferBackground: true, limitedUntilMs: now + 5000 });
    assert.deepEqual(viewOf([{ nearLimitUntilMs: now - 1, limitedUntilMs: now - 1 }], now), { deferBackground: false, limitedUntilMs: null });
  });
});

describe("jiraWebhooks", () => {
  const secret = "s3cret";
  const nowSec = 2_000_000_000;
  it("accepts a token signed with the app's client secret", () => {
    assert.equal(verifyWebhookToken(`Bearer ${token(secret, { exp: nowSec + 60 })}`, secret, nowSec), true);
    assert.equal(verifyWebhookToken(`JWT ${token(secret, {})}`, secret, nowSec), true);
  });
  it("refuses a wrong secret, another algorithm, an expired token or none at all", () => {
    assert.equal(verifyWebhookToken(`Bearer ${token("other", {})}`, secret, nowSec), false);
    assert.equal(verifyWebhookToken(`Bearer ${token(secret, {}, "none")}`, secret, nowSec), false);
    assert.equal(verifyWebhookToken(`Bearer ${token(secret, { exp: nowSec - 3600 })}`, secret, nowSec), false);
    assert.equal(verifyWebhookToken(undefined, secret, nowSec), false);
    assert.equal(verifyWebhookToken("Bearer abc", secret, nowSec), false);
    assert.equal(verifyWebhookToken(`Bearer ${token(secret, {})}`, "", nowSec), false);
  });
  it("reads only the webhook ids, the kind of event and the issue id", () => {
    assert.deepEqual(readWebhookEvent({ matchedWebhookIds: [12, "13"], webhookEvent: "jira:issue_updated", issue: { id: "10042", key: "AI-1", fields: { summary: "x" } } }), {
      webhookIds: [12, 13],
      kind: "updated",
      issueId: "10042",
    });
    assert.deepEqual(readWebhookEvent({ webhookEvent: "comment_created" }), { webhookIds: [], kind: null, issueId: null });
    assert.equal(readWebhookEvent({ matchedWebhookIds: [1], webhookEvent: "jira:issue_deleted", issue: { id: "1; DROP" } }).issueId, null);
  });
});
