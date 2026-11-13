/**
 * Who may read whose hours across projects (Clockwork "Cả nhóm"), with no database and no Jira in them
 * (server/test/viewerRoles.test.ts). resourceRoles.ts asks Jira for the facts; this decides.
 *
 *  - a member sees only their own hours;
 *  - a project manager (someone Jira lets administer a project) reads the hours of that project's team;
 *  - a resource manager (RESOURCE_MANAGER_GROUP / RESOURCE_MANAGER_ACCOUNT_IDS) reads every team's.
 */
import { badRequest } from "./errors.js";

export type ViewerRole = "member" | "pm" | "manager";

export interface Viewer {
  accountId: string;
  manager: boolean;
  /** Projects this account administers. */
  pmOf: ReadonlySet<string>;
  /** Projects this account can browse. */
  accessible: ReadonlySet<string>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_RANGE_DAYS = 800;

const DAY_MS = 86_400_000;
const isDate = (v: unknown): v is string => typeof v === "string" && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v));
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

export function roleOf(viewer: Viewer): ViewerRole {
  return viewer.manager ? "manager" : viewer.pmOf.size > 0 ? "pm" : "member";
}

/** May this viewer read the team of this project: they can browse it and manage it (or every project). */
export function canManage(viewer: Viewer, projectKey: string): boolean {
  return viewer.accessible.has(projectKey) && (viewer.manager || viewer.pmOf.has(projectKey));
}

export function validateRange(from: unknown, to: unknown): { from: string; to: string } {
  if (!isDate(from) || !isDate(to) || to < from) throw badRequest("Khoảng ngày không hợp lệ.");
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw badRequest("Khoảng ngày quá dài.");
  return { from, to };
}

/** `a;b c` → ["a", "b", "c"]: account ids in an env var (semicolons, since the deploy action splits on commas). */
export function parseIdList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const fold = (s: string) => s.trim().toLowerCase();

/** A resource manager is named by account id, or belongs to the configured Jira group. */
export function decideManager(
  accountId: string,
  groups: readonly string[] | null,
  cfg: { ids: readonly string[]; group: string | null }
): boolean {
  if (cfg.ids.includes(accountId)) return true;
  if (!cfg.group || !groups) return false;
  const wanted = fold(cfg.group);
  return groups.some((g) => fold(g) === wanted);
}
