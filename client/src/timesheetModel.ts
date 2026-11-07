import { fold } from "./csvImport";
import { parseHours } from "./parseHours";
import { roundHours } from "./taskForm";
import { isAway, expectation } from "./timesheetDays";
import { isAssignableType, type Task, type TimesheetPerson, type WorklogEntry } from "./types";
import { dayKind, type WorkCalendar } from "./workCalendar";

/*
 * What the Giờ đã ghi lens draws, worked out away from React so the rules are tested without a browser.
 *
 * Two grids over the same worklogs:
 *   "Của tôi"  — one row per task, one cell per day, every cell a field (buildMyRows, planCell). Jira only lets a
 *                person log time as themselves, so this is the only grid that is edited.
 *   "Cả nhóm"  — one row per person (buildTeamRows), read-only, opened into the person's own task rows
 *                (personRows) when clicked.
 */

export type Cell = { hours: number; entries: WorklogEntry[] };

export interface TaskRow {
  key: string;
  summary: string;
  issueType: string;
  /** From the plan; null for a task the loaded plan does not have (logged on an issue of another project). */
  task: Task | null;
  /** "logged" = has hours in the period, "suggested" = my own open work with none yet, "added" = picked by hand. */
  kind: "logged" | "suggested" | "added";
  cells: Map<string, Cell>;
  total: number;
}

const NATURAL = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** "2", "2,5", "1,33": hours the way people write them here. */
export function fmtHours(h: number): string {
  return String(roundHours(h)).replace(".", ",");
}

function cellsOf(entries: readonly WorklogEntry[]): { cells: Map<string, Cell>; total: number } {
  const cells = new Map<string, Cell>();
  let total = 0;
  for (const e of entries) {
    const c = cells.get(e.date) ?? { hours: 0, entries: [] };
    c.hours = roundHours(c.hours + e.hours);
    c.entries.push(e);
    cells.set(e.date, c);
    total += e.hours;
  }
  return { cells, total: roundHours(total) };
}

/** My open work worth offering as an empty row: in progress first, then the rest of what is assigned to me. */
export function suggestedTasks(tasks: readonly Task[], me: string, exclude: ReadonlySet<string>, limit = 6): Task[] {
  const mine = tasks.filter((t) => t.assigneeAccountId === me && t.statusCategory !== "done" && isAssignableType(t.issueType) && !exclude.has(t.id));
  const rank = (t: Task) => (t.statusCategory === "indeterminate" ? 0 : 1);
  return mine
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
    .slice(0, limit)
    .map(({ t }) => t);
}

/**
 * The rows of "Của tôi": every task I logged on in the period, then the ones I picked by hand this session, then
 * a few suggestions. `order` (see stableOrder) keeps a row where it first appeared: a row that gets its first
 * hours must not jump from "suggested" up to "logged" under the cursor.
 */
export function buildMyRows(input: {
  entries: readonly WorklogEntry[];
  tasks: readonly Task[];
  me: string;
  added: readonly string[];
  order?: readonly string[];
  suggestLimit?: number;
}): TaskRow[] {
  const { entries, tasks, me, added } = input;
  const byTask = new Map(tasks.map((t) => [t.id, t]));
  const mine = new Map<string, WorklogEntry[]>();
  for (const e of entries) {
    if (!e.mine) continue;
    const list = mine.get(e.issueKey) ?? [];
    list.push(e);
    mine.set(e.issueKey, list);
  }
  const rows: TaskRow[] = [];
  const seen = new Set<string>();
  const push = (key: string, kind: TaskRow["kind"], list: WorklogEntry[]) => {
    if (seen.has(key)) return;
    seen.add(key);
    const t = byTask.get(key) ?? null;
    const first = list[0];
    const { cells, total } = cellsOf(list);
    rows.push({ key, summary: t?.summary ?? first?.summary ?? key, issueType: t?.issueType ?? first?.issueType ?? "", task: t, kind, cells, total });
  };
  for (const key of [...mine.keys()].sort(NATURAL)) push(key, "logged", mine.get(key) ?? []);
  for (const key of added) push(key, "added", []);
  for (const t of suggestedTasks(tasks, me, seen, input.suggestLimit)) push(t.id, "suggested", []);
  if (!input.order) return rows;
  const pos = new Map(input.order.map((k, i) => [k, i]));
  return rows.sort((a, b) => (pos.get(a.key) ?? Infinity) - (pos.get(b.key) ?? Infinity));
}

/**
 * Row order that survives edits: what was already shown keeps its place, what is new goes after it, what is
 * gone is dropped. Passing no `prev` (a new period) starts again from `next`.
 */
export function stableOrder(prev: readonly string[], next: readonly string[]): string[] {
  const have = new Set(next);
  const kept = prev.filter((k) => have.has(k));
  const keptSet = new Set(kept);
  return [...kept, ...next.filter((k) => !keptSet.has(k))];
}

/** Hours I logged on each day, across every row. */
export function myDayTotals(entries: readonly WorklogEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) if (e.mine) out.set(e.date, roundHours((out.get(e.date) ?? 0) + e.hours));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// One day of one person: what it should say.

export type DayState =
  /** A day off, or a day the project does not work with nothing on it. */
  | "off"
  /** Work on a weekend or holiday: logged, never expected. */
  | "extra"
  /** A working day not reached yet. */
  | "later"
  /** Today with nothing yet. */
  | "open"
  /** A working day gone by with nothing logged. */
  | "missing"
  /** Logged, short of the day. */
  | "short"
  /** The whole day. */
  | "full"
  /** More than the day. */
  | "over";

export function dayState(
  p: Pick<TimesheetPerson, "absences" | "capacityHoursPerDay">,
  d: string,
  hours: number,
  today: string,
  calendar: WorkCalendar
): DayState {
  const cap = Math.max(p.capacityHoursPerDay, 0.01);
  if (hours > cap + 1e-9) return "over";
  if (isAway(p, d)) return hours > 0 ? "extra" : "off";
  if (dayKind(d, calendar) !== "work") return hours > 0 ? "extra" : "off";
  if (hours <= 0) return d > today ? "later" : d === today ? "open" : "missing";
  return hours >= cap - 1e-9 ? "full" : "short";
}

/** A capacity nobody works ("24h a day"): almost always a typo in the profile, and it blows up "expected". */
export const ODD_CAPACITY_HOURS = 12;
export const isOddCapacity = (p: Pick<TimesheetPerson, "capacityHoursPerDay">) => p.capacityHoursPerDay > ODD_CAPACITY_HOURS;

// ---------------------------------------------------------------------------------------------------------------
// The team grid.

export interface TeamRow {
  person: TimesheetPerson;
  hoursByDay: Map<string, number>;
  total: number;
  expected: number;
  /** Working days already gone with nothing logged. */
  missing: string[];
  overDays: number;
}

export function buildTeamRows(input: {
  people: readonly TimesheetPerson[];
  entries: readonly WorklogEntry[];
  days: readonly string[];
  today: string;
  calendar: WorkCalendar;
  me: string;
}): TeamRow[] {
  const { people, entries, days, today, calendar, me } = input;
  const perPerson = new Map<string, Map<string, number>>();
  for (const e of entries) {
    if (!e.authorAccountId) continue;
    const m = perPerson.get(e.authorAccountId) ?? new Map<string, number>();
    m.set(e.date, (m.get(e.date) ?? 0) + e.hours);
    perPerson.set(e.authorAccountId, m);
  }
  const rows = people.map((person): TeamRow => {
    const hoursByDay = new Map([...(perPerson.get(person.accountId) ?? new Map<string, number>())].map(([d, h]) => [d, roundHours(h)]));
    const hoursOn = (d: string) => hoursByDay.get(d) ?? 0;
    const total = roundHours(days.reduce((s, d) => s + hoursOn(d), 0));
    const { expected, missing } = expectation(person, [...days], today, hoursOn, calendar);
    const overDays = days.filter((d) => dayState(person, d, hoursOn(d), today, calendar) === "over").length;
    return { person, hoursByDay, total, expected, missing: person.outsider ? [] : missing, overDays };
  });
  // You first; then whoever owes the most days; then by name — so "who has not logged" is the top of the page.
  return rows.sort(
    (a, b) =>
      Number(b.person.accountId === me) - Number(a.person.accountId === me) ||
      b.missing.length - a.missing.length ||
      a.person.displayName.localeCompare(b.person.displayName, "vi")
  );
}

export type TeamFilter = "all" | "missing" | "over";

export function filterTeam(rows: readonly TeamRow[], text: string, mode: TeamFilter): TeamRow[] {
  const q = fold(text.trim());
  return rows.filter(
    (r) =>
      (!q || fold(r.person.displayName).includes(q)) &&
      (mode === "all" || (mode === "missing" ? r.missing.length > 0 : r.overDays > 0))
  );
}

/** People who owe days, people over capacity, and the over-capacity person-days (what the page's figures say). */
export function teamCounts(rows: readonly TeamRow[]): { all: number; missing: number; over: number; overDays: number } {
  return {
    all: rows.length,
    missing: rows.filter((r) => r.missing.length > 0).length,
    over: rows.filter((r) => r.overDays > 0).length,
    overDays: rows.reduce((n, r) => n + r.overDays, 0),
  };
}

/** One person's own task rows (what a team row opens into): the same shape as "Của tôi", for anyone. */
export function personRows(entries: readonly WorklogEntry[], accountId: string): TaskRow[] {
  const by = new Map<string, WorklogEntry[]>();
  for (const e of entries) {
    if (e.authorAccountId !== accountId) continue;
    const list = by.get(e.issueKey) ?? [];
    list.push(e);
    by.set(e.issueKey, list);
  }
  return [...by.keys()].sort(NATURAL).map((key) => {
    const list = by.get(key) ?? [];
    const { cells, total } = cellsOf(list);
    return { key, summary: list[0]?.summary ?? key, issueType: list[0]?.issueType ?? "", task: null, kind: "logged", cells, total };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Typing into a cell.

export type CellPlan =
  | { kind: "noop" }
  | { kind: "invalid" }
  | { kind: "create"; hours: number }
  | { kind: "update"; entry: WorklogEntry; hours: number }
  | { kind: "delete"; entries: WorklogEntry[] };

/**
 * What typing `text` in a cell does to the worklogs it already holds. A cell with several worklogs is not
 * typed into (which one would "2h" replace?), it opens its list, so nothing is planned for it.
 */
export function planCell(text: string, entries: readonly WorklogEntry[]): CellPlan {
  if (entries.length > 1) return { kind: "noop" };
  if (!text.trim()) return entries.length ? { kind: "delete", entries: [...entries] } : { kind: "noop" };
  const hours = parseHours(text);
  if (hours === null) return { kind: "invalid" };
  const [only] = entries;
  if (!only) return { kind: "create", hours };
  return Math.abs(only.hours - hours) < 1e-9 ? { kind: "noop" } : { kind: "update", entry: only, hours };
}

// Optimistic edits of the entry list: pure, so the order of operations can be tested.
export const withEntry = (entries: readonly WorklogEntry[], e: WorklogEntry): WorklogEntry[] => [...entries, e];
export const withoutEntries = (entries: readonly WorklogEntry[], ids: ReadonlySet<string>): WorklogEntry[] => entries.filter((e) => !ids.has(e.id));
export const replacingEntry = (entries: readonly WorklogEntry[], id: string, e: WorklogEntry): WorklogEntry[] =>
  entries.map((x) => (x.id === id ? e : x));

/** The worklogs of mine in one cell. */
export function cellEntries(entries: readonly WorklogEntry[], issueKey: string, date: string): WorklogEntry[] {
  return entries.filter((e) => e.mine && e.issueKey === issueKey && e.date === date);
}
