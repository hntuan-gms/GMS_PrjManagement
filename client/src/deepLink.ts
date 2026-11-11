/**
 * A link into the app: one saved report (`/?project=GPM&report=<uuid>`) or one task
 * (`/?project=GPM&task=GPM-12`, which opens that task's detail panel).
 *
 * There is no router (the OAuth callback is a server route, so the browser never sees a path), and
 * a link must survive being opened logged out — the login round trip leaves the app and comes back
 * to `/`. So the link is read once on load, parked in sessionStorage (it lives as long as the tab,
 * across the cross-site hop to Atlassian), and taken when there is a session to act on.
 *
 * A link grants nothing: opening it asks the server for the report / tasks as the signed-in user,
 * who must already be able to browse that project (requireProject), or gets a 403 / 404 as for any
 * other request.
 */

export interface DeepLink {
  project: string;
  /** A saved report to open on the Báo cáo tab. */
  reportId?: string;
  /** A task (issue key) to open in the detail panel. */
  taskId?: string;
}

const STORAGE_KEY = "gms.deeplink";
const PROJECT_KEY = /^[A-Za-z][A-Za-z0-9_]{0,49}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_KEY = /^([A-Za-z][A-Za-z0-9_]{0,49})-(\d{1,9})$/;

export function buildReportLink(origin: string, projectKey: string, reportId: string): string {
  return `${origin.replace(/\/$/, "")}/?project=${encodeURIComponent(projectKey)}&report=${encodeURIComponent(reportId)}`;
}

/** The link to one task. The project is the key's own prefix, so a task never needs its project passed beside it. */
export function buildTaskLink(origin: string, taskKey: string): string {
  const m = TASK_KEY.exec(taskKey.trim());
  const project = m ? m[1] : taskKey.replace(/-\d+$/, "");
  return `${origin.replace(/\/$/, "")}/?project=${encodeURIComponent(project)}&task=${encodeURIComponent(taskKey.trim())}`;
}

/** What a stored or typed link is worth: null unless the project and one target look right. */
function validate(project: string, reportId: string, taskId: string): DeepLink | null {
  if (!PROJECT_KEY.test(project)) return null;
  if (UUID.test(reportId)) return { project, reportId };
  const m = TASK_KEY.exec(taskId);
  // A task key names its own project; a link whose two parts disagree is ignored, not trusted.
  if (m && m[1].toUpperCase() === project.toUpperCase()) return { project, taskId: `${m[1].toUpperCase()}-${m[2]}` };
  return null;
}

/** Null unless the project and a report id or a task key look right — anything else in the query string is ignored. */
export function parseDeepLink(search: string): DeepLink | null {
  const q = new URLSearchParams(search);
  return validate(q.get("project")?.trim() ?? "", q.get("report")?.trim() ?? "", q.get("task")?.trim() ?? "");
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
    return parked ? validate(parked.project ?? "", parked.reportId ?? "", parked.taskId ?? "") : null;
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
