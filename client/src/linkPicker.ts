/**
 * The link box's rules (components/LinkPicker.tsx), React-free so they are tested: what typed text means,
 * what a picked issue reads as, and how long ago it was viewed. The list itself is the server's
 * (server/src/linkSearch.ts): Jira's history and a title search on the viewer's own token.
 */

export interface LinkSuggestion {
  key: string;
  summary: string;
  issueType: string;
  projectName: string;
  /** ISO time the viewer last opened it in Jira, or null. */
  lastViewed: string | null;
  url: string;
}

/** What the box hands back: the address and the words to show (never empty). */
export interface PickedLink {
  url: string;
  text: string;
}

/** Typed text that is an address, not a search (mirrors server/src/linkSearch.ts `looksLikeUrl`). */
export const looksLikeUrl = (q: string) => /^(https?:\/\/|www\.)\S+$/i.test(q.trim()) || /^mailto:\S+@\S+$/i.test(q.trim());

/** An address as it is stored: "www.x.com" gets its https://. */
export function normalizeUrl(q: string): string {
  const url = q.trim();
  return /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
}

/** What an issue picked from the list reads as when no display text was typed. */
export const suggestionText = (s: LinkSuggestion) => `${s.key}: ${s.summary}`;

/**
 * The link to make from what is in the two boxes and what is highlighted. Typed text that is an address wins;
 * otherwise the highlighted row, else the first row. Null when there is nothing to link.
 */
export function pickLink(query: string, display: string, rows: LinkSuggestion[], active: number): PickedLink | null {
  const text = display.trim();
  if (looksLikeUrl(query)) {
    const url = normalizeUrl(query);
    return { url, text: text || url };
  }
  const row = rows[active] ?? (query.trim() ? rows[0] : undefined);
  if (!row) return null;
  return { url: row.url, text: text || suggestionText(row) };
}

/** "Đã xem 5 phút trước" — the second line of a row, in the words Jira uses. */
export function viewedAgo(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const min = Math.max(0, Math.round((now - t) / 60_000));
  if (min < 1) return "Vừa xem";
  if (min < 60) return `Đã xem ${min} phút trước`;
  const h = Math.round(min / 60);
  if (h < 24) return `Đã xem khoảng ${h} giờ trước`;
  const d = Math.round(h / 24);
  if (d === 1) return "Đã xem hôm qua";
  if (d < 30) return `Đã xem ${d} ngày trước`;
  const m = Math.round(d / 30);
  return m < 12 ? `Đã xem ${m} tháng trước` : `Đã xem ${Math.round(m / 12)} năm trước`;
}
