import type { BoardIssue, BoardSnapshot, Sprint } from "./types";

/**
 * Pure helpers for the Bảng tab: dates, weights, filters, lanes, burndown.
 *
 * Kept out of the components for the same reason resourceAllocation.ts is: the
 * board re-derives all of this on every optimistic move, and a function of
 * (issues, filter) is easy to keep consistent across the board, the backlog and
 * the sprint header.
 */

/** A Jira datetime as the local calendar date — local getters, never toISOString (BUG-04). */
export function localDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A local date at a given local hour, as the ISO datetime Jira's sprint API takes. */
export function toJiraDateTime(localIso: string, hour: number): string {
  const [y, m, d] = localIso.split("-").map(Number);
  return new Date(y, m - 1, d, hour, 0, 0).toISOString();
}

export function addDaysLocal(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const x = new Date(y, m - 1, d + days);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

export function isWeekendLocal(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 || day === 6;
}

export function workingDaysLocal(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysLocal(d, 1)) if (!isWeekendLocal(d)) out.push(d);
  return out;
}

export function shortDate(iso: string | null): string {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—";
}

export const tzOffsetMinutes = () => -new Date().getTimezoneOffset();

export function unitLabel(snapshot: BoardSnapshot): string {
  if (!snapshot.estimation) return "việc";
  return snapshot.estimation.unit === "hours" ? "giờ" : "điểm";
}

/** Estimate when the board estimates, else 1 per issue — every total then has a unit. */
export function weightOf(issue: BoardIssue, snapshot: BoardSnapshot): number {
  return snapshot.estimation ? issue.estimate ?? 0 : 1;
}

export function totalWeight(issues: BoardIssue[], snapshot: BoardSnapshot): number {
  return Math.round(issues.reduce((s, i) => s + weightOf(i, snapshot), 0) * 10) / 10;
}

export function velocityAverage(snapshot: BoardSnapshot): number | null {
  const values = snapshot.velocity.map((v) => (snapshot.estimation ? v.completed : v.completedCount)).slice(-3);
  return values.length > 0 ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10 : null;
}

/** "GPM Sprint 7" → the next free "GPM Sprint N", as Jira's own Create sprint button names it. */
export function nextSprintName(snapshot: BoardSnapshot, projectKey: string): string {
  const names = [...snapshot.sprints.map((s) => s.name), ...snapshot.velocity.map((v) => v.name)];
  let max = 0;
  let prefix = `${projectKey} Sprint `;
  for (const n of names) {
    const m = n.match(/^(.*?)(\d+)\s*$/);
    if (m && Number(m[2]) >= max) {
      max = Number(m[2]);
      prefix = m[1];
    }
  }
  return `${prefix}${max + 1}`;
}

/* ----------------------------------------------------------------- filters */

export interface BoardFilter {
  text: string;
  /** Account ids to show; empty = everyone. "none" stands for unassigned. */
  people: Set<string>;
  onlyBlocked: boolean;
  onlyOverdue: boolean;
  types: Set<string>;
}

export const EMPTY_FILTER: BoardFilter = { text: "", people: new Set(), onlyBlocked: false, onlyOverdue: false, types: new Set() };

export function isFiltering(f: BoardFilter): boolean {
  return !!f.text.trim() || f.people.size > 0 || f.onlyBlocked || f.onlyOverdue || f.types.size > 0;
}

export function isOverdue(issue: BoardIssue, today: string): boolean {
  return issue.statusCategory !== "done" && !!issue.dueDate && issue.dueDate < today;
}

export function matchesFilter(issue: BoardIssue, f: BoardFilter, today: string): boolean {
  const q = f.text.trim().toLowerCase();
  if (q && !`${issue.key} ${issue.summary} ${issue.epicSummary ?? ""} ${issue.labels.join(" ")}`.toLowerCase().includes(q)) {
    return false;
  }
  if (f.people.size > 0 && !f.people.has(issue.assigneeAccountId ?? "none")) return false;
  if (f.types.size > 0 && !f.types.has(issue.issueType)) return false;
  if (f.onlyBlocked && issue.blockedBy.length === 0 && !issue.flagged) return false;
  if (f.onlyOverdue && !isOverdue(issue, today)) return false;
  return true;
}

/* ------------------------------------------------------------------- lanes */

export type Swimlane = "none" | "assignee" | "epic";

export interface Lane {
  id: string;
  label: string;
  /** The assignee this lane stands for — dropping a card here assigns it. */
  accountId?: string | null;
  issues: BoardIssue[];
}

export function lanesOf(issues: BoardIssue[], mode: Swimlane): Lane[] {
  if (mode === "none") return [{ id: "all", label: "", issues }];
  const map = new Map<string, Lane>();
  for (const i of issues) {
    const id = mode === "assignee" ? i.assigneeAccountId ?? "none" : i.epicKey ?? "none";
    const label =
      mode === "assignee"
        ? i.assigneeName ?? "Chưa gán"
        : i.epicKey
          ? `${i.epicKey} · ${i.epicSummary ?? ""}`
          : "Không thuộc Epic";
    const lane = map.get(id) ?? { id, label, accountId: mode === "assignee" ? i.assigneeAccountId : undefined, issues: [] };
    lane.issues.push(i);
    map.set(id, lane);
  }
  // Named lanes alphabetically, the "none" lane last — as Jira orders them.
  return [...map.values()].sort((a, b) => (a.id === "none" ? 1 : b.id === "none" ? -1 : a.label.localeCompare(b.label, "vi")));
}

/* ----------------------------------------------------------------- ranking */

/**
 * Where a dropped block lands, expressed the way Jira's rank API wants it: before
 * a neighbour, or after one. `beforeKey` null means "at the end of this list".
 */
export function rankTarget(list: BoardIssue[], moving: Set<string>, beforeKey: string | null): { before?: string; after?: string } | undefined {
  const rest = list.filter((i) => !moving.has(i.key));
  if (beforeKey && !moving.has(beforeKey)) return { before: beforeKey };
  const last = rest[rest.length - 1];
  return last ? { after: last.key } : undefined;
}

/** The global issue order after moving `keys` to sit before `beforeKey` (or after `afterKey`). */
export function reorder(issues: BoardIssue[], keys: string[], rank: { before?: string; after?: string } | undefined): BoardIssue[] {
  if (!rank) return issues;
  const moving = issues.filter((i) => keys.includes(i.key));
  const rest = issues.filter((i) => !keys.includes(i.key));
  const anchor = rank.before ?? rank.after!;
  const at = rest.findIndex((i) => i.key === anchor);
  if (at === -1) return [...rest, ...moving];
  const insert = rank.before ? at : at + 1;
  return [...rest.slice(0, insert), ...moving, ...rest.slice(insert)];
}

/* --------------------------------------------------------------- burndown */

export interface BurndownPoint {
  date: string;
  ideal: number;
  /** Null for days that haven't happened yet. */
  remaining: number | null;
}

/**
 * Remaining work per working day of the sprint. "Remaining" is current scope
 * minus what was resolved by that day — Jira's chart also replays scope changes
 * from the changelog, which the board API doesn't expose, so an issue added
 * mid-sprint shows as if it had been there from day one.
 */
export function burndown(sprint: Sprint, issues: BoardIssue[], snapshot: BoardSnapshot, today: string): BurndownPoint[] {
  const start = localDate(sprint.startDate);
  const end = localDate(sprint.endDate);
  if (!start || !end) return [];
  const days = workingDaysLocal(start, end);
  if (days.length === 0) return [];
  const scope = totalWeight(issues, snapshot);
  const doneBy = (day: string) =>
    issues
      .filter((i) => i.statusCategory === "done")
      .filter((i) => {
        const at = localDate(i.resolutionDate);
        // Done but with no resolution date (a workflow without a resolution
        // step): count it from today, so it isn't invisible.
        return at ? at <= day : day >= today;
      })
      .reduce((s, i) => s + weightOf(i, snapshot), 0);
  return days.map((date, idx) => ({
    date,
    ideal: Math.round(scope * (1 - idx / Math.max(1, days.length - 1)) * 10) / 10,
    remaining: date <= today ? Math.round((scope - doneBy(date)) * 10) / 10 : null,
  }));
}

/** Issue-type colour key for the small square on cards — matches Jira's own conventions. */
export function typeClass(issueType: string): string {
  const t = issueType.toLowerCase();
  if (t.includes("bug") || t.includes("lỗi")) return "bug";
  if (t.includes("story") || t.includes("câu chuyện")) return "story";
  if (t.includes("epic")) return "epic";
  if (t.includes("sub")) return "subtask";
  return "task";
}

export function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts.at(-1)?.[0] ?? "") + (parts.length > 1 ? parts[0][0] : "")).toUpperCase() || "?";
}

/** Working days since the last update, today included — the "stuck?" signal on in-progress cards. */
export function idleDays(issue: BoardIssue, today: string): number {
  const last = localDate(issue.updated);
  if (!last || last >= today) return 0;
  return workingDaysLocal(addDaysLocal(last, 1), today).length;
}
