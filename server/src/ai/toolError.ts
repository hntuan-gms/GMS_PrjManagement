import { JiraApiError } from "../jiraClient.js";

/**
 * What the model is told when a tool throws. "Jira API error 400" alone gives it
 * nothing to explain or retry with — Jira's own sentence ("Issue type is
 * invalid", "parent is required"…) is what lets it tell the user the real
 * reason or pick another way. The user does not see this text: the model
 * answers in words, so a failing tool no longer paints a raw red error box.
 */
export function toolFailureMessage(err: unknown): string {
  if (err instanceof JiraApiError) {
    const reason = err.summary || err.body.replace(/\s+/g, " ").slice(0, 300);
    return reason ? `Jira từ chối (HTTP ${err.status}): ${reason}` : `Jira từ chối (HTTP ${err.status}).`;
  }
  return (err as Error)?.message || "Công cụ gặp lỗi không rõ.";
}
