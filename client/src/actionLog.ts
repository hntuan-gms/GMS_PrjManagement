/**
 * A record of what this tab did, sent to the server so it can sit beside the access log and Jira's own history.
 *
 * Why it exists: a drag or a Ctrl+Z is drawn at once and written to Jira seconds later, in a queue; when the
 * screen and Jira disagree, the access log (which requests ran) and the Jira changelog (what they wrote) cannot
 * say what the person did or which answer the screen then used. Each event is a name and a few plain values
 * (task keys, dates, counts) — never descriptions, comments or names of people. Batched, best effort: a failed
 * send is dropped, and nothing here may ever slow or break an edit. Rules of the batching: actionLogCore.ts.
 */
import { projectHeaders } from "./api";
import { createActionLog } from "./actionLogCore";

const API_BASE = import.meta.env?.VITE_API_BASE ?? "/api";

/** The tab's one log. `keepalive` lets the last batch leave while the page is closing. */
const tabLog = createActionLog({
  send: (batch) => {
    void fetch(`${API_BASE}/client-log`, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...projectHeaders() },
      body: JSON.stringify(batch),
    }).catch(() => undefined);
  },
});

export const logAction = tabLog.log;
export const flushActionLog = tabLog.flush;
export const actionLogSession = tabLog.sid;

if (typeof window !== "undefined") {
  // What is still waiting leaves with the page: the moments before a reload are the ones worth having.
  window.addEventListener("pagehide", () => tabLog.flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") tabLog.flush();
  });
}
