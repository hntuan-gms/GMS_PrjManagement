/**
 * The board read from the issue copy (issueCache.ts) instead of from Jira's board API.
 *
 * The board API answered with every card of the board on each open — 8–9 s and a page of 100 per
 * request, plus another read for the velocity's finished work. The copy already holds the project
 * with the user's permissions applied, so the board only asks Jira what the copy cannot know: its
 * configuration, its sprints, its quick filters and versions.
 *
 * Used only when the answer is the same as Jira's, otherwise the board API is read as before:
 *  - the board's saved filter selects the whole project (`project = KEY [ORDER BY Rank]`) — a board
 *    over a component, a label or two projects shows something else;
 *  - a Kanban sub-filter is absent or Jira's default (`fixVersion in unreleasedVersions() OR
 *    fixVersion is EMPTY`), which is evaluated here against the project's versions;
 *  - every visible row has been read with the board's fields (rank, estimate, flag) — right after
 *    the board is first opened they are being added, a few hundred rows per load.
 *
 * Everything below is pure and mirrors JQL the board API used to run: BOARD_JQL and
 * RECENT_DONE_JQL in boardService.ts. Change both together.
 */

export const DAY_MS = 86_400_000;

const fold = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Whether a board filter's JQL selects exactly this one project, optionally rank-ordered. */
export function isWholeProjectFilter(jql: string | null | undefined, projectKey: string): boolean {
  if (!jql) return false;
  const key = projectKey.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^project\\s*(=\\s*"?${key}"?|in\\s*\\(\\s*"?${key}"?\\s*\\))(\\s+order\\s+by\\s+rank(\\s+asc)?)?$`);
  return pattern.test(fold(jql));
}

/** What a Kanban board's sub-filter asks for: nothing, Jira's own default, or something this does not evaluate. */
export function subQueryRule(query: string | null | undefined): "none" | "unreleased" | "other" {
  if (!query || !query.trim()) return "none";
  const q = fold(query).replace(/[()]/g, "");
  const a = "fixversion in unreleasedversions";
  const b = "fixversion is empty";
  return q === `${a} or ${b}` || q === `${b} or ${a}` ? "unreleased" : "other";
}

export interface ShapeOptions {
  sprintFieldId: string | null;
  flaggedFieldId: string | null;
  /** The board's active and future sprints (id → state) as Jira listed them just now — truer than the state held in the copy. */
  openSprints: Map<number, string>;
  closedSprintIds: Set<number>;
}

/**
 * One copied issue in the shape the board API returned: `sprint` (the open one), `closedSprints`
 * and `flagged` are fields of that API alone, rebuilt here from the Sprint and Flagged fields.
 */
export function toBoardShape(issue: any, o: ShapeOptions, byKey: Map<string, any>): any {
  const f = issue.fields ?? {};
  const sprints: any[] = o.sprintFieldId && Array.isArray(f[o.sprintFieldId]) ? f[o.sprintFieldId] : [];
  const isOpen = (s: any) =>
    o.openSprints.has(Number(s.id)) || (!o.closedSprintIds.has(Number(s.id)) && (s.state === "active" || s.state === "future"));
  const stateOf = (s: any) => o.openSprints.get(Number(s.id)) ?? (o.closedSprintIds.has(Number(s.id)) ? "closed" : s.state);
  const open = sprints
    .filter(isOpen)
    .map((s) => ({ ...s, state: stateOf(s) }))
    .sort((a, b) => Number(b.state === "active") - Number(a.state === "active"));
  const closed = sprints.filter((s) => !isOpen(s)).map((s) => ({ ...s, state: "closed" }));
  const flag = o.flaggedFieldId ? f[o.flaggedFieldId] : null;

  const parent = parentWithFields(f.parent, byKey);

  return {
    ...issue,
    fields: {
      ...f,
      parent,
      sprint: open[0] ?? null,
      closedSprints: closed,
      flagged: Array.isArray(flag) ? flag.length > 0 : !!flag,
    },
  };
}

/** Rows written before the copy kept a parent's type and title: the parent's own row has them. */
export function parentWithFields(parent: any, byKey: Map<string, any>): any {
  if (!parent || parent.fields || !byKey.has(parent.key)) return parent;
  const pf = byKey.get(parent.key).fields ?? {};
  return { ...parent, fields: { summary: pf.summary, issuetype: pf.issuetype } };
}

const isDone = (issue: any) => issue.fields?.status?.statusCategory?.key === "done";
const resolvedMs = (issue: any): number => {
  const at = issue.fields?.resolutiondate;
  return typeof at === "string" ? Date.parse(at.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) : NaN;
};
const isEpic = (issue: any) => issue.fields?.issuetype?.hierarchyLevel === 1 || issue.fields?.issuetype?.name === "Epic";

/** BOARD_JQL: not done, or resolved in the last 14 days, or in an open sprint. */
export function onAgileBoard(issue: any, nowMs: number): boolean {
  return !isDone(issue) || resolvedMs(issue) >= nowMs - 14 * DAY_MS || !!issue.fields?.sprint;
}

/** The status board's JQL: not done, or resolved in the last 14 days. */
export function onStatusBoard(issue: any, nowMs: number): boolean {
  return !isDone(issue) || resolvedMs(issue) >= nowMs - 14 * DAY_MS;
}

/** RECENT_DONE_JQL: done and resolved in the last 180 days. */
export function recentlyDone(issue: any, nowMs: number): boolean {
  return isDone(issue) && resolvedMs(issue) >= nowMs - 180 * DAY_MS;
}

/** `fixVersion in unreleasedVersions() OR fixVersion is EMPTY`, against the project's versions. */
export function passesUnreleased(issue: any, released: Map<string, boolean>): boolean {
  const versions: any[] = Array.isArray(issue.fields?.fixVersions) ? issue.fields.fixVersions : [];
  if (versions.length === 0) return true;
  // A version the project no longer lists (archived) does not count as unreleased.
  return versions.some((v) => released.get(String(v.name)) === false);
}

/** Board order: by rank, as `ORDER BY Rank` does; issues without one keep their place after the ranked ones. */
export function rankOrder(issues: any[], rankFieldId: string | null): any[] {
  if (!rankFieldId) return issues;
  return issues
    .map((issue, i) => ({ issue, i, rank: typeof issue.fields?.[rankFieldId] === "string" ? (issue.fields[rankFieldId] as string) : null }))
    .sort((a, b) => (a.rank === null ? (b.rank === null ? a.i - b.i : 1) : b.rank === null ? -1 : a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.i - b.i))
    .map((x) => x.issue);
}

export interface AgileFromCache {
  issues: any[];
  recentDone: any[];
}

/** The agile board's two reads, from the copy. `limit` mirrors the board API's page cap. */
export function agileBoardFromCache(
  copied: any[],
  o: ShapeOptions & {
    rankFieldId: string | null;
    scrum: boolean;
    subQuery: "none" | "unreleased";
    released: Map<string, boolean>;
    nowMs: number;
    limit: number;
    doneLimit: number;
  }
): AgileFromCache {
  const byKey = new Map(copied.map((i) => [i.key, i]));
  // "Epic issues do not belong to the scrum boards" — Jira's board API.
  const onThisBoard = copied
    .filter((i) => !(o.scrum && isEpic(i)))
    .filter((i) => o.subQuery === "none" || passesUnreleased(i, o.released))
    .map((i) => toBoardShape(i, o, byKey));
  const issues = rankOrder(onThisBoard.filter((i) => onAgileBoard(i, o.nowMs)), o.rankFieldId).slice(0, o.limit);
  const recentDone = onThisBoard
    .filter((i) => recentlyDone(i, o.nowMs))
    .sort((a, b) => resolvedMs(b) - resolvedMs(a))
    .slice(0, o.doneLimit);
  return { issues, recentDone };
}

/** The status board's one read, from the copy. */
export function statusBoardFromCache(copied: any[], o: { rankFieldId: string | null; nowMs: number }): any[] {
  const byKey = new Map(copied.map((i) => [i.key, i]));
  return rankOrder(
    copied
      .filter((i) => onStatusBoard(i, o.nowMs))
      .map((i) => ({ ...i, fields: { ...i.fields, parent: parentWithFields(i.fields?.parent, byKey) } })),
    o.rankFieldId
  );
}
