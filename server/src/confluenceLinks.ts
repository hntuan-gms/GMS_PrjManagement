/**
 * Names for the Confluence pages linked to an issue.
 *
 * Jira's Confluence integration stores a page link with the title "Wiki Page" (relationship "Wiki Page",
 * application com.atlassian.confluence, url `…/wiki/pages/viewpage.action?pageId=123`): Jira's own UI asks
 * Confluence for the page's real name each time. So a list of three linked pages read "Wiki Page" three times.
 *
 * The real name is read from Confluence (`GET /wiki/api/v2/pages/{id}`, scope `read:page:confluence`) with the
 * viewer's own token, so a page they may not open keeps Jira's label. That scope is requested only when
 * CONFLUENCE_LINKS=on (auth/config.ts): a scope the Atlassian app lacks fails /authorize for everyone. Without it,
 * a title in the page's address is used (`/pages/123/Page+Title`), else "Trang Confluence" and the page number.
 *
 * Names are kept in memory only, per viewer, for ten minutes: never stored.
 */

export interface RemoteLinkLike {
  object?: { url?: string; title?: string };
  globalId?: string;
  application?: { type?: string; name?: string };
  relationship?: string;
}

const GENERIC = /^(wiki page|page|confluence page)$/i;

/** The page id of a Confluence link, from its global id or its address; null for anything else. */
export function confluencePageId(link: RemoteLinkLike): string | null {
  const url = link.object?.url ?? "";
  const fromGlobal = /(?:^|&)pageId=(\d{1,20})(?:&|$)/.exec(link.globalId ?? "")?.[1];
  if (fromGlobal) return fromGlobal;
  const looksConfluence = link.application?.type === "com.atlassian.confluence" || /\/wiki\//.test(url);
  if (!looksConfluence) return null;
  return /[?&]pageId=(\d{1,20})(?:&|#|$)/.exec(url)?.[1] ?? /\/pages\/(\d{1,20})(?:\/|\?|#|$)/.exec(url)?.[1] ?? null;
}

/** A title written into the address itself: `/wiki/spaces/KEY/pages/123/Page+Title`. */
export function titleFromUrl(url: string): string | null {
  const slug = /\/pages\/\d{1,20}\/([^/?#]+)/.exec(url)?.[1];
  if (!slug) return null;
  try {
    const t = decodeURIComponent(slug.replace(/\+/g, " ")).trim();
    return t || null;
  } catch {
    return null;
  }
}

/** Jira's own label says nothing about which page it is. */
export function isGenericTitle(title: string | undefined, url: string): boolean {
  const t = (title ?? "").trim();
  return !t || t === url || GENERIC.test(t);
}

/** What the link is called on screen: the real name when known, else the best the link itself says. */
export function linkTitle(link: RemoteLinkLike, resolved: string | null | undefined): string {
  const url = link.object?.url ?? "";
  const title = link.object?.title;
  if (!isGenericTitle(title, url)) return title!.trim();
  if (resolved) return resolved;
  const pageId = confluencePageId(link);
  if (pageId) return titleFromUrl(url) ?? `Trang Confluence ${pageId}`;
  return title?.trim() || url;
}

/** Ten minutes per viewer and page, including "could not read" (so a page one may not open is not asked for again). */
const TTL_MS = 10 * 60 * 1000;
const titles = new Map<string, { value: string | null; at: number }>();

export async function resolvePageTitles(
  ids: readonly string[],
  viewer: { cloudId: string; accountId: string },
  read: (id: string) => Promise<string | null>
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const now = Date.now();
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const memo = `${viewer.cloudId}|${viewer.accountId}|${id}`;
      const hit = titles.get(memo);
      if (hit && now - hit.at < TTL_MS) {
        out.set(id, hit.value);
        return;
      }
      const value = await read(id).catch(() => null);
      if (titles.size > 20_000) titles.clear();
      titles.set(memo, { value, at: now });
      out.set(id, value);
    })
  );
  return out;
}

/** Tests only. */
export function forgetPageTitles(): void {
  titles.clear();
}
