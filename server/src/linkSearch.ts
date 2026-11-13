/**
 * What the link box offers under "Dán hoặc tìm liên kết" — Jira's own link picker, on the caller's token:
 * nothing typed lists the issues they viewed last (`issueHistory()`, newest first, any project they can see);
 * a whole key is looked up exactly; anything else is a title search, the recently viewed first.
 *
 * Pure: the route (routes/links.ts) runs the JQL and hands the rows here. Nothing is stored — the history
 * is the viewer's own and crosses projects, so it never goes into the per-project issue copy.
 */
const KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
export const LINK_MIN_QUERY = 2;
const MAX_QUERY = 80;
export const LINK_FIELDS = ["summary", "issuetype", "project", "lastViewed"];

/** Typed text that is an address, not a search: the client links it as it is. */
export const looksLikeUrl = (q: string) => /^(https?:\/\/|www\.)\S+$/i.test(q.trim());

export function linkSearchJql(raw: string): string | null {
  const q = raw.trim().slice(0, MAX_QUERY);
  if (!q) return "issue in issueHistory() ORDER BY lastViewed DESC";
  if (looksLikeUrl(q)) return null;
  if (KEY.test(q)) return `key = "${q.toUpperCase()}"`;
  // Into a quoted JQL string: quotes and backslashes dropped, Lucene's operators made spaces (see clockworkSearch.ts).
  const text = q
    .replace(/["\\]/g, "")
    .replace(/[+\-&|!(){}\[\]^~*?:\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < LINK_MIN_QUERY) return null;
  return `summary ~ "${text}*" ORDER BY lastViewed DESC, updated DESC`;
}

export interface LinkSuggestion {
  key: string;
  summary: string;
  issueType: string;
  projectName: string;
  /** ISO time the caller last opened it in Jira, or null. */
  lastViewed: string | null;
  url: string;
}

/** Jira writes "2026-11-13T10:00:00.000+0700"; an offset without a colon is not read alike everywhere. */
export function isoTime(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function toSuggestions(issues: any[], siteUrl: string): LinkSuggestion[] {
  const base = siteUrl.replace(/\/+$/, "");
  return issues
    .filter((i) => typeof i?.key === "string")
    .map((i) => ({
      key: i.key,
      summary: String(i.fields?.summary ?? i.key),
      issueType: String(i.fields?.issuetype?.name ?? "Task"),
      projectName: String(i.fields?.project?.name ?? i.key.split("-")[0]),
      lastViewed: isoTime(i.fields?.lastViewed),
      url: `${base}/browse/${i.key}`,
    }));
}
