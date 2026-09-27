import type { ResourceAbsence, ResourceProfile } from "../resourceStore.js";
import { eachDate, isWeekend } from "../workload.js";
import type { BoardIssue, BoardSnapshot, Sprint } from "./boardTypes.js";

/**
 * Sprint numbers, computed — the same rule as progress.ts: this code decides
 * every figure (days left, % done, pace, velocity, who is free), and the sprint
 * AI (ai/sprintAi.ts) receives them as facts and reasons over them. A model
 * asked "are we going to make it?" otherwise answers with arithmetic of its own.
 *
 * Pure. "Today" and the timezone come from the browser: a Jira sprint starts at
 * a datetime, and whether 17:00Z is Monday or Tuesday depends on where you are.
 */

const DAY_MS = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** A Jira datetime as a local calendar date, `offsetMinutes` east of UTC (Vietnam = 420). */
export function localDate(iso: string | null, offsetMinutes: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function workingDays(from: string, to: string): string[] {
  if (to < from) return [];
  return eachDate(from, to).filter((d) => !isWeekend(d));
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Estimate, or 1 per issue when the board doesn't estimate — so every figure has a unit. */
export function weightOf(issue: BoardIssue, estimated: boolean): number {
  return estimated ? issue.estimate ?? 0 : 1;
}

export interface VelocityStats {
  /** "estimate" when the board has an estimation field, else plain issue counts. */
  basis: "estimate" | "count";
  unit: string;
  /** Mean of the last three closed sprints, or null with no history. */
  average: number | null;
  last: number | null;
  sprints: number;
}

export function velocityStats(snapshot: BoardSnapshot): VelocityStats {
  const basis = snapshot.estimation ? "estimate" : "count";
  const values = snapshot.velocity.map((v) => (basis === "estimate" ? v.completed : v.completedCount));
  const recent = values.slice(-3);
  return {
    basis,
    unit: snapshot.estimation ? (snapshot.estimation.unit === "hours" ? "giờ" : "điểm") : "việc",
    average: recent.length > 0 ? round1(recent.reduce((s, v) => s + v, 0) / recent.length) : null,
    last: values.length > 0 ? values[values.length - 1] : null,
    sprints: values.length,
  };
}

export interface SprintFacts {
  sprint: { id: number; name: string; goal: string | null; start: string | null; end: string | null };
  days: { total: number; elapsed: number; left: number };
  /** Share of the sprint's working days already gone, 0–100. */
  elapsedPct: number;
  unit: string;
  scope: { count: number; weight: number; unestimated: number };
  done: { count: number; weight: number };
  inProgress: { count: number; weight: number };
  todo: { count: number; weight: number };
  /** Share of scope done, 0–100, by estimate when the board estimates. */
  donePct: number;
  /** Where done% sits against elapsed%: ±10 points either side is on pace. */
  pace: "ahead" | "on_pace" | "behind" | "not_started";
  people: Array<{ name: string; open: number; openWeight: number; inProgress: number; done: number }>;
  blocked: Array<{ key: string; summary: string; blockedBy: string[] }>;
  flagged: Array<{ key: string; summary: string }>;
  /** In progress but untouched for 3+ working days — usually stuck, rarely just quiet. */
  stale: Array<{ key: string; summary: string; assignee: string | null; idleDays: number }>;
  unassigned: string[];
  unestimated: string[];
}

export function sprintFacts(
  snapshot: BoardSnapshot,
  sprint: Sprint,
  today: string,
  offsetMinutes: number
): SprintFacts {
  const estimated = !!snapshot.estimation;
  const items = snapshot.issues.filter((i) => i.sprintId === sprint.id && !i.subtask);
  const start = localDate(sprint.startDate, offsetMinutes);
  const end = localDate(sprint.endDate, offsetMinutes);

  const all = start && end ? workingDays(start, end) : [];
  const elapsed = all.filter((d) => d < today).length;
  const total = all.length;

  const sum = (xs: BoardIssue[]) => round1(xs.reduce((s, i) => s + weightOf(i, estimated), 0));
  const done = items.filter((i) => i.statusCategory === "done");
  const inProgress = items.filter((i) => i.statusCategory === "indeterminate");
  const todo = items.filter((i) => i.statusCategory === "new");
  const open = items.filter((i) => i.statusCategory !== "done");

  const scopeWeight = sum(items);
  const donePct = scopeWeight > 0 ? round1((sum(done) / scopeWeight) * 100) : 0;
  const elapsedPct = total > 0 ? round1((elapsed / total) * 100) : 0;
  const pace: SprintFacts["pace"] =
    elapsed === 0 ? "not_started" : donePct >= elapsedPct + 10 ? "ahead" : donePct >= elapsedPct - 10 ? "on_pace" : "behind";

  const peopleMap = new Map<string, SprintFacts["people"][number]>();
  for (const i of items) {
    const name = i.assigneeName ?? "Chưa gán";
    const p = peopleMap.get(name) ?? { name, open: 0, openWeight: 0, inProgress: 0, done: 0 };
    if (i.statusCategory === "done") p.done += 1;
    else {
      p.open += 1;
      p.openWeight = round1(p.openWeight + weightOf(i, estimated));
      if (i.statusCategory === "indeterminate") p.inProgress += 1;
    }
    peopleMap.set(name, p);
  }

  const idleDays = (updated: string | null) => {
    const last = localDate(updated, offsetMinutes);
    // Working days since the last change, today included: touched Monday, asked Thursday → 3.
    return last ? workingDays(addDays(last, 1), today).length : 0;
  };

  return {
    sprint: { id: sprint.id, name: sprint.name, goal: sprint.goal, start, end },
    days: { total, elapsed, left: Math.max(0, total - elapsed) },
    elapsedPct,
    unit: estimated ? (snapshot.estimation!.unit === "hours" ? "giờ" : "điểm") : "việc",
    scope: { count: items.length, weight: scopeWeight, unestimated: estimated ? items.filter((i) => i.estimate === null).length : 0 },
    done: { count: done.length, weight: sum(done) },
    inProgress: { count: inProgress.length, weight: sum(inProgress) },
    todo: { count: todo.length, weight: sum(todo) },
    donePct,
    pace,
    people: [...peopleMap.values()].sort((a, b) => b.openWeight - a.openWeight),
    blocked: open.filter((i) => i.blockedBy.length > 0).map((i) => ({ key: i.key, summary: i.summary, blockedBy: i.blockedBy })),
    flagged: open.filter((i) => i.flagged).map((i) => ({ key: i.key, summary: i.summary })),
    stale: inProgress
      .map((i) => ({ key: i.key, summary: i.summary, assignee: i.assigneeName, idleDays: idleDays(i.updated) }))
      .filter((s) => s.idleDays >= 3)
      .sort((a, b) => b.idleDays - a.idleDays),
    unassigned: open.filter((i) => !i.assigneeAccountId).map((i) => i.key),
    unestimated: estimated ? open.filter((i) => i.estimate === null).map((i) => i.key) : [],
  };
}

export interface Availability {
  accountId: string;
  name: string;
  /** Working days in the window minus declared absences. */
  days: number;
  hoursPerDay: number;
}

/** Who can work how much in [from, to] — the resource tab's capacity and absences, applied to a sprint. */
export function availability(
  members: Array<{ accountId: string; displayName: string }>,
  profiles: ResourceProfile[],
  absences: ResourceAbsence[],
  from: string,
  to: string,
  defaultHours: number
): Availability[] {
  const days = workingDays(from, to);
  return members.map((m) => {
    const profile = profiles.find((p) => p.accountId === m.accountId);
    const away = absences.filter((a) => a.accountId === m.accountId);
    const free = days.filter((d) => !away.some((a) => d >= a.from && d <= a.to)).length;
    return { accountId: m.accountId, name: m.displayName, days: free, hoursPerDay: profile?.capacityHoursPerDay ?? defaultHours };
  });
}

/**
 * The window a future sprint will run in: its own dates when set, otherwise
 * right after the active sprint (or from today), as long as the last sprints ran.
 */
export function plannedWindow(
  snapshot: BoardSnapshot,
  target: Sprint,
  today: string,
  offsetMinutes: number
): { start: string; end: string; lengthDays: number } {
  const own = { start: localDate(target.startDate, offsetMinutes), end: localDate(target.endDate, offsetMinutes) };
  if (own.start && own.end && own.end > own.start) {
    return { start: own.start, end: own.end, lengthDays: Math.round((Date.parse(own.end) - Date.parse(own.start)) / DAY_MS) + 1 };
  }
  const lengths = snapshot.velocity
    .map((v) => (v.startDate && v.completeDate ? Math.round((Date.parse(v.completeDate) - Date.parse(v.startDate)) / DAY_MS) : null))
    .filter((n): n is number => n !== null && n > 2 && n < 60)
    .sort((a, b) => a - b);
  // Whole weeks, as sprints are planned: an 11-day Mon→Fri run is a 2-week sprint.
  const weeks = lengths.length > 0 ? Math.max(1, Math.round(lengths[Math.floor(lengths.length / 2)] / 7)) : 2;
  const lengthDays = weeks * 7;
  const active = snapshot.sprints.find((s) => s.state === "active");
  const activeEnd = localDate(active?.endDate ?? null, offsetMinutes);
  let start = activeEnd && activeEnd >= today ? addDays(activeEnd, 1) : today;
  while (isWeekend(start)) start = addDays(start, 1);
  return { start, end: addDays(start, lengthDays - 1), lengthDays };
}
