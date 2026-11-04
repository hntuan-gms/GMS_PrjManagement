import assert from "node:assert/strict";
import { test } from "node:test";
import { JiraApiError } from "../src/jiraClient.js";
import { toolFailureMessage } from "../src/ai/toolError.js";

test("a Jira refusal carries Jira's own reason to the model", () => {
  const body = JSON.stringify({ errorMessages: [], errors: { issuetype: "Issue type is invalid." } });
  assert.equal(toolFailureMessage(new JiraApiError(400, body)), "Jira từ chối (HTTP 400): Issue type is invalid.");
});

test("a bulk-API refusal (errors is an array of objects) is read, never printed as [object Object]", () => {
  const body = JSON.stringify({ errors: [{ message: "You do not have the Bulk Change global permission.", status: 403 }] });
  assert.equal(toolFailureMessage(new JiraApiError(403, body)), "Jira từ chối (HTTP 403): You do not have the Bulk Change global permission.");
  const nested = JSON.stringify({ errors: [{ failedElementNumber: 0, elementErrors: { errorMessages: ["Bad status"], errors: { issuetype: "invalid" } } }] });
  assert.equal(toolFailureMessage(new JiraApiError(400, nested)), "Jira từ chối (HTTP 400): Bad status invalid");
  assert.ok(!toolFailureMessage(new JiraApiError(403, JSON.stringify({ errors: [{ code: 1 }] }))).includes("[object"));
});

test("a Jira refusal with an unparseable body falls back to the trimmed text", () => {
  const msg = toolFailureMessage(new JiraApiError(400, "<html>\n  bad   gateway </html>"));
  assert.equal(msg, "Jira từ chối (HTTP 400): <html> bad gateway </html>");
});

test("an empty body still names the status, never just 'Jira API error'", () => {
  assert.equal(toolFailureMessage(new JiraApiError(400, "")), "Jira từ chối (HTTP 400).");
});

test("other errors keep their own message", () => {
  assert.equal(toolFailureMessage(new Error("boom")), "boom");
});
