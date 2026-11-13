/**
 * The JQL behind "+ Thêm việc" in Clockwork: an issue of ANY project, found with the caller's own token (Jira
 * decides what they may see). Each project's own "+ Thêm việc" passes its key, which narrows the search to it.
 *
 * Epics and finished issues are found too: in the worklog history 15% of logged time went on an Epic and 17% on
 * an issue that was already resolved (people log after closing), so leaving either out hides real work.
 *
 * - A key typed whole is looked up exactly, in any project.
 * - Nothing typed, with a project: what is likely next there — my work and what was created lately.
 * - Anything else is a title search. The text goes into a quoted JQL string, so quotes and backslashes are dropped,
 *   and Lucene's own operators are turned into spaces: "a+b" or "(x" would otherwise be a syntax error.
 */
const KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
const PROJECT = /^[A-Za-z][A-Za-z0-9_]{0,24}$/;
export const MIN_QUERY = 2;
export const MAX_QUERY = 80;

export function issuePickJql(raw: string, project: string | null = null): string | null {
  const q = raw.trim().slice(0, MAX_QUERY);
  const scope = project && PROJECT.test(project) ? `project = "${project.toUpperCase()}" AND ` : "";
  if (KEY.test(q)) return `key = "${q.toUpperCase()}"`;
  if (!q) return scope ? `${scope}(assignee = currentUser() OR created >= -14d) ORDER BY updated DESC` : null;
  const text = q
    .replace(/["\\]/g, "")
    .replace(/[+\-&|!(){}\[\]^~*?:\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < MIN_QUERY) return null;
  return `${scope}summary ~ "${text}*" ORDER BY updated DESC`;
}
