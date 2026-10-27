/**
 * A link that opens the Báo cáo tab on one saved report: `/?project=GPM&report=<uuid>`.
 *
 * There is no router (the OAuth callback is a server route, so the browser never sees a path), and
 * a link must survive being opened logged out — the login round trip leaves the app and comes back
 * to `/`. So the link is read once on load, parked in sessionStorage (it lives as long as the tab,
 * across the cross-site hop to Atlassian), and taken when there is a session to act on.
 *
 * A link grants nothing: opening it asks the server for the report as the signed-in user, who
 * must already be able to browse that project (requireProject), or gets a 403 / 404 as for any
 * other report.
 */

export interface DeepLink {
  project: string;
  reportId: string;
}

const STORAGE_KEY = "gms.deeplink";
const PROJECT_KEY = /^[A-Za-z][A-Za-z0-9_]{0,49}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildReportLink(origin: string, projectKey: string, reportId: string): string {
  return `${origin.replace(/\/$/, "")}/?project=${encodeURIComponent(projectKey)}&report=${encodeURIComponent(reportId)}`;
}

/** Null unless both parts look right — anything else in the query string is ignored, not trusted. */
export function parseDeepLink(search: string): DeepLink | null {
  const q = new URLSearchParams(search);
  const project = q.get("project")?.trim() ?? "";
  const reportId = q.get("report")?.trim() ?? "";
  return PROJECT_KEY.test(project) && UUID.test(reportId) ? { project, reportId } : null;
}

/**
 * Read the link from the address bar (or the one parked before a login), park it, and strip it
 * from the URL so a refresh doesn't replay it. Call once, in a lazy initializer.
 */
export function captureDeepLink(): DeepLink | null {
  if (typeof window === "undefined") return null;
  const fromUrl = parseDeepLink(window.location.search);
  try {
    if (fromUrl) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(fromUrl));
      window.history.replaceState({}, "", window.location.pathname);
      return fromUrl;
    }
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parked = raw ? (JSON.parse(raw) as Partial<DeepLink>) : null;
    return parked && PROJECT_KEY.test(parked.project ?? "") && UUID.test(parked.reportId ?? "")
      ? { project: parked.project!, reportId: parked.reportId! }
      : null;
  } catch {
    return fromUrl;
  }
}

/** Once the link has been acted on (or the user chose another project), so it never replays. */
export function clearDeepLink(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing parked.
  }
}
