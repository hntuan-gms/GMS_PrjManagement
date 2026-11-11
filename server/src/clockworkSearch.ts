/**
 * The JQL behind "+ Thêm việc" in Clockwork when what was typed is not in the plan the tab holds: an issue of
 * ANY project, found with the caller's own token (Jira decides what they may see).
 *
 * A key typed whole is looked up exactly; anything else is a title search on open, non-Epic work. The text goes
 * into a quoted JQL string, so quotes and backslashes are dropped, and Lucene's own operators are turned into
 * spaces: "a+b" or "(x" would otherwise be a syntax error instead of a search.
 */
const KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
export const MIN_QUERY = 2;
export const MAX_QUERY = 80;

export function issuePickJql(raw: string): string | null {
  const q = raw.trim().slice(0, MAX_QUERY);
  if (KEY.test(q)) return `key = "${q.toUpperCase()}"`;
  const text = q
    .replace(/["\\]/g, "")
    .replace(/[+\-&|!(){}\[\]^~*?:\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < MIN_QUERY) return null;
  return `summary ~ "${text}*" AND statusCategory != Done AND issuetype != Epic ORDER BY updated DESC`;
}
