import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

// The config is read once, so the environment goes in before the router is imported.
const SECRET = "test-client-secret";
process.env.JIRA_WEBHOOKS = "on";
process.env.ATLASSIAN_CLIENT_ID = "id";
process.env.ATLASSIAN_CLIENT_SECRET = SECRET;
process.env.APP_BASE_URL = "https://example.test";
process.env.SESSION_ENCRYPTION_KEYS = `k1:${Buffer.alloc(32, 1).toString("base64url")}`;
process.env.ALLOWED_SITE_HOSTS = "example.atlassian.net";

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
function bearer(): string {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ exp: Math.floor(Date.now() / 1000) + 600 });
  return `Bearer ${head}.${body}.${createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url")}`;
}

describe("webhook body size", () => {
  let server: import("node:http").Server;
  let url = "";

  before(async () => {
    const { default: express } = await import("express");
    const { webhookRouter } = await import("../src/routes/webhooks.js");
    const app = express();
    // No global parser here: the router must read its own body (index.ts leaves the path out of the default 100 kb one).
    app.use("/hook", webhookRouter);
    server = app.listen(0);
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  });
  after(() => server.close());

  const post = (body: unknown, authorization?: string) =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body) });
  // An issue event whose description is long: 300 kb, well past express.json's 100 kb default (the production failures were ~125 kb).
  const bigEvent = { webhookEvent: "jira:issue_updated", matchedWebhookIds: [], issue: { id: "1", fields: { description: "x".repeat(300_000) } } };

  it("accepts a signed event larger than 100 kb", async () => {
    assert.equal((await post(bigEvent, bearer())).status, 204);
  });
  it("still caps what a signed caller can make it read", async () => {
    const huge = { ...bigEvent, issue: { id: "1", fields: { description: "x".repeat(3_000_000) } } };
    assert.equal((await post(huge, bearer())).status, 413);
  });
  it("refuses an unsigned one before reading it", async () => {
    assert.equal((await post(bigEvent)).status, 401);
  });
});
