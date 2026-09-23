import { isAssignableType } from "./types";
import type { JiraUser, ResourceAbsence, ResourceProfile, Task } from "./types";

/**
 * The allocation engine behind the "Nguồn lực" tab.
 *
 * It answers one question per person per day: how many hours of work is this
 * person committed to, against how many hours they actually have. Everything the
 * tab shows — the heatmap, the overload count, the per-person grid — is a view
 * over the same `DayLoad[]`, so a colour and a number can never disagree.
 *
 * It runs on the client, on data the workspace already holds, because the
 * heatmap has to recolour while a Gantt bar is still under the cursor. A server
 * round trip per drag would make it lag exactly the way the bars used to.
 *
 * Deliberately NOT modelled: per-assignment percentages (MS Project's "50% on
 * this task"). Jira has no field for it and inventing one would mean a second
 * schedule to keep in sync with the first.
 */

/** A full working day when nobody has said otherwise. Mirrors the server's default. */
export const DEFAULT_CAPACITY_HOURS = 8;

export type LoadBand = "free" | "light" | "healthy" | "over" | "off" | "off-violation";

export interface DayLoad {
  date: string;
  /** Hours available: 0 on weekends and absence days. */
  capacityHours: number;
  allocatedHours: number;
  /** allocated / capacity. 0 when there is no capacity — read `band` instead. */
  ratio: number;
  band: LoadBand;
  taskIds: string[];
  /** Why capacity is 0, for the tooltip. */
  offReason: "weekend" | "absence" | null;
}

export interface Overlap {
  aId: string;
  bId: string;
  /** Inclusive ISO date range shared by both tasks. */
  from: string;
  to: string;
}

export interface PersonLoad {
  accountId: string;
  displayName: string;
  avatarUrl: string | null;
  role: string | null;
  capacityHoursPerDay: number;
  /** One entry per date in the window, in order. */
  days: DayLoad[];
  /** The person's open tasks that touch the window, earliest first. */
  tasks: Task[];
  overloadedDays: number;
  /** Highest ratio in the window — what sorts the "most overloaded first" list. */
  peakRatio: number;
  /** Committed hours as a share of available hours across the whole window. */
  utilisation: number;
  allocatedHours: number;
  capacityHours: number;
  /** Pairs of this person's tasks whose dates collide, for the detail grid. */
  overlaps: Overlap[];
  absences: ResourceAbsence[];
  profile: ResourceProfile | null;
}

export interface ResourceLoad {
  /** Every date in the window, ascending. */
  dates: string[];
  people: PersonLoad[];
  /** Work nobody owns: real demand with no capacity behind it. */
  unassigned: Task[];
  overloadedPeople: number;
}

/* -------------------------------------------------------------------------- */
/* Date helpers — UTC throughout, matching the server (see BUG-04 in CLAUDE.md) */
/* -------------------------------------------------------------------------- */

function toUtc(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return toIso(toUtc(iso) + days * 86_400_000);
}

export function diffDays(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/**
 * Today as YYYY-MM-DD, from LOCAL getters.
 *
 * Not toISOString(): in UTC+7 that returns yesterday for the first seven hours
 * of every day, which would open the heatmap on a window the user is not in
 * (BUG-04, the client half of it).
 */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Inclusive list of ISO dates. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let ms = toUtc(from); ms <= toUtc(to); ms += 86_400_000) out.push(toIso(ms));
  return out;
}

/** 0 = Sunday. UTC getters, so this does not shift in UTC+7. */
export function weekdayOf(iso: string): number {
  return new Date(toUtc(iso)).getUTCDay();
}

export function isWeekend(iso: string): boolean {
  const d = weekdayOf(iso);
  return d === 0 || d === 6;
}

/* -------------------------------------------------------------------------- */

function bandFor(capacity: number, allocated: number, ratio: number, weekendOrOff: boolean): LoadBand {
  if (weekendOrOff || capacity <= 0) {
    // Work scheduled onto a day the person does not have is its own failure
    // mode, and a louder one than "busy": nobody is going to do it.
    return allocated > 0 ? "off-violation" : "off";
  }
  if (allocated <= 0) return "free";
  // Four non-overlapping bands. The brief asked for "green under 100%, yellow
  // under 50%", which overlap — a 30% day is both. Split at 50% instead, so
  // every cell has exactly one colour and yellow means something specific:
  // this person has room for more work.
  if (ratio > 1.0001) return "over";
  if (ratio < 0.5) return "light";
  return "healthy";
}

export const BAND_LABEL: Record<LoadBand, string> = {
  free: "Trống",
  light: "Nhẹ tải (<50%)",
  healthy: "Hợp lý (50–100%)",
  over: "Quá tải (>100%)",
  off: "Nghỉ / cuối tuần",
  "off-violation": "Xếp việc vào ngày nghỉ",
};

/**
 * Every pair of one person's tasks whose date ranges collide.
 *
 * Kept alongside the hours model because it answers a different question. Two
 * half-day tasks on the same day are not an overload, but they are still two
 * things at once, and a PM reading the grid wants to see that the bars touch.
 * O(n²) over one person's tasks — tens, not thousands.
 */
export function findOverlaps(tasks: Task[]): Overlap[] {
  const dated = tasks.filter((t) => t.startDate && t.dueDate);
  const overlaps: Overlap[] = [];
  for (let i = 0; i < dated.length; i++) {
    for (let j = i + 1; j < dated.length; j++) {
      const a = dated[i];
      const b = dated[j];
      // ISO YYYY-MM-DD strings compare lexicographically the same as chronologically.
      const from = a.startDate! > b.startDate! ? a.startDate! : b.startDate!;
      const to = a.dueDate! < b.dueDate! ? a.dueDate! : b.dueDate!;
      if (from <= to) overlaps.push({ aId: a.id, bId: b.id, from, to });
    }
  }
  return overlaps;
}

/** The dates a scheduled task actually occupies, ignoring the display window. */
export function taskSpan(task: Task): string[] {
  if (!task.startDate) return [];
  const end = task.dueDate && task.dueDate >= task.startDate ? task.dueDate : task.startDate;
  return eachDate(task.startDate, end);
}

export interface LoadInput {
  tasks: Task[];
  users: JiraUser[];
  profiles: ResourceProfile[];
  absences: ResourceAbsence[];
  defaultCapacityHours?: number;
  /** Inclusive window the heatmap covers. */
  from: string;
  to: string;
  /** Show everyone assignable, not only people currently holding work. */
  includeIdle?: boolean;
}

/**
 * Turns tasks + capacity + absences into a per-person, per-day load table.
 *
 * Completed work contributes nothing: a task Jira calls done is no longer a
 * claim on anyone's time, and leaving it in makes every past week look
 * permanently overloaded. `percentComplete` is deliberately NOT used to scale
 * the remainder — it is an overlay field most teams never fill in, and halving
 * someone's load off a number nobody maintains hides real overload.
 */
export function buildResourceLoad(input: LoadInput): ResourceLoad {
  const defaultCapacity = input.defaultCapacityHours ?? DEFAULT_CAPACITY_HOURS;
  const dates = eachDate(input.from, input.to);
  const dateIndex = new Map(dates.map((d, i) => [d, i]));

  const profileByAccount = new Map(input.profiles.map((p) => [p.accountId, p]));
  const absencesByAccount = new Map<string, ResourceAbsence[]>();
  for (const a of input.absences) {
    const list = absencesByAccount.get(a.accountId) ?? [];
    list.push(a);
    absencesByAccount.set(a.accountId, list);
  }

  // Epics are excluded outright, not merely expected to be unassigned: an Epic
  // spans its children's entire min/max range (ganttMapping.resolveRanges), so
  // one left over from before this rule existed would book its owner solid for
  // a whole phase on top of the child tasks they are actually doing.
  const open = input.tasks.filter((t) => t.statusCategory !== "done" && isAssignableType(t.issueType));
  const byAccount = new Map<string, Task[]>();
  const unassigned: Task[] = [];
  for (const t of open) {
    if (!t.startDate) continue; // nothing to place on a calendar
    if (!t.assigneeAccountId) {
      unassigned.push(t);
      continue;
    }
    const list = byAccount.get(t.assigneeAccountId) ?? [];
    list.push(t);
    byAccount.set(t.assigneeAccountId, list);
  }

  const candidates = input.includeIdle
    ? input.users
    : input.users.filter((u) => (byAccount.get(u.accountId)?.length ?? 0) > 0);

  const people = candidates.map((user) => {
    const profile = profileByAccount.get(user.accountId) ?? null;
    const capacityPerDay = profile?.capacityHoursPerDay ?? defaultCapacity;
    const absences = (absencesByAccount.get(user.accountId) ?? []).slice().sort((a, b) =>
      a.from.localeCompare(b.from)
    );
    const tasks = (byAccount.get(user.accountId) ?? [])
      .slice()
      .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));

    /** Is this a day the person can work, anywhere on the calendar? */
    const isOffDay = (iso: string): "weekend" | "absence" | null => {
      if (isWeekend(iso)) return "weekend";
      for (const a of absences) if (iso >= a.from && iso <= a.to) return "absence";
      return null;
    };

    const days: DayLoad[] = dates.map((date) => {
      const offReason = isOffDay(date);
      return {
        date,
        capacityHours: offReason ? 0 : capacityPerDay,
        allocatedHours: 0,
        ratio: 0,
        band: "free",
        taskIds: [],
        offReason,
      };
    });

    for (const task of tasks) {
      const span = taskSpan(task);
      if (span.length === 0) continue;
      // The rate is derived from the task's WHOLE span, not the visible window:
      // a task clipped by the window edge must still cost the same per day, or
      // scrolling the heatmap would change how loaded someone looks.
      const workDays = span.filter((d) => isOffDay(d) === null);
      // A task landing entirely on days off still has to go somewhere, or it
      // would silently disappear from the load. It lands on its own days and
      // colours them as a violation.
      const chargeDays = workDays.length > 0 ? workDays : span;
      const perDay =
        task.estimateHours != null && task.estimateHours > 0
          ? task.estimateHours / chargeDays.length
          : // No estimate: the honest default in a tool where duration is the
            // primary input is that a task occupies the working day it is on.
            capacityPerDay;

      for (const d of chargeDays) {
        const i = dateIndex.get(d);
        if (i === undefined) continue;
        days[i].allocatedHours += perDay;
        days[i].taskIds.push(task.id);
      }
    }

    let allocatedHours = 0;
    let capacityHours = 0;
    let overloadedDays = 0;
    let peakRatio = 0;
    for (const day of days) {
      day.allocatedHours = Math.round(day.allocatedHours * 100) / 100;
      day.ratio = day.capacityHours > 0 ? day.allocatedHours / day.capacityHours : 0;
      day.band = bandFor(day.capacityHours, day.allocatedHours, day.ratio, day.offReason !== null);
      allocatedHours += day.allocatedHours;
      capacityHours += day.capacityHours;
      if (day.band === "over" || day.band === "off-violation") overloadedDays += 1;
      peakRatio = Math.max(peakRatio, day.band === "off-violation" ? Infinity : day.ratio);
    }

    return {
      accountId: user.accountId,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: profile?.role ?? null,
      capacityHoursPerDay: capacityPerDay,
      days,
      tasks,
      overloadedDays,
      peakRatio,
      utilisation: capacityHours > 0 ? allocatedHours / capacityHours : 0,
      allocatedHours: Math.round(allocatedHours * 10) / 10,
      capacityHours,
      overlaps: findOverlaps(tasks),
      absences,
      profile,
    } satisfies PersonLoad;
  });

  // Overloaded first — the reason to open this tab is to find the problem, and
  // a PM should not have to scan an alphabetical list for it.
  people.sort((a, b) => {
    if (a.overloadedDays !== b.overloadedDays) return b.overloadedDays - a.overloadedDays;
    if (b.utilisation !== a.utilisation) return b.utilisation - a.utilisation;
    return a.displayName.localeCompare(b.displayName, "vi");
  });

  return {
    dates,
    people,
    unassigned,
    overloadedPeople: people.filter((p) => p.overloadedDays > 0).length,
  };
}

/**
 * The date window the heatmap should open on: the project's own span, clamped so
 * a single stray task years out does not compress everything else to nothing.
 */
export function defaultWindow(tasks: Task[], today: string, maxDays = 120): { from: string; to: string } {
  const dated = tasks.filter((t) => t.statusCategory !== "done" && t.startDate);
  if (dated.length === 0) return { from: addDays(today, -7), to: addDays(today, 27) };

  let min = dated[0].startDate!;
  let max = dated[0].dueDate ?? dated[0].startDate!;
  for (const t of dated) {
    if (t.startDate! < min) min = t.startDate!;
    const end = t.dueDate ?? t.startDate!;
    if (end > max) max = end;
  }
  // Start from today when the project is already under way: a heatmap of weeks
  // that have already happened cannot be acted on.
  const from = min > today ? min : today < max ? today : min;
  const to = diffDays(from, max) > maxDays ? addDays(from, maxDays) : max;
  return { from, to: to < from ? from : to };
}

export interface WeekCell {
  /** Monday (or the window's first date) of the week this cell covers. */
  start: string;
  end: string;
  capacityHours: number;
  allocatedHours: number;
  ratio: number;
  band: LoadBand;
  taskIds: string[];
}

/**
 * Collapses days into weeks for long windows.
 *
 * A quarter is ~90 columns; at a readable cell size that is wider than any
 * screen, and scrolling a heatmap horizontally to find the red is the opposite
 * of what it is for. A week cell carries the week's totals, so its colour is the
 * week's real utilisation rather than an average of averages.
 */
export function aggregateWeeks(days: DayLoad[]): WeekCell[] {
  const weeks: WeekCell[] = [];
  let current: DayLoad[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const capacityHours = current.reduce((n, d) => n + d.capacityHours, 0);
    const allocatedHours = current.reduce((n, d) => n + d.allocatedHours, 0);
    const ratio = capacityHours > 0 ? allocatedHours / capacityHours : 0;
    const violation = current.some((d) => d.band === "off-violation");
    weeks.push({
      start: current[0].date,
      end: current[current.length - 1].date,
      capacityHours,
      allocatedHours: Math.round(allocatedHours * 10) / 10,
      ratio,
      band:
        capacityHours <= 0
          ? violation
            ? "off-violation"
            : "off"
          : bandFor(capacityHours, allocatedHours, ratio, false),
      taskIds: [...new Set(current.flatMap((d) => d.taskIds))],
    });
    current = [];
  };

  for (const day of days) {
    // Break on Monday so the columns line up with how people talk about weeks,
    // not on every 7th day from an arbitrary window start.
    if (current.length > 0 && weekdayOf(day.date) === 1) flush();
    current.push(day);
  }
  flush();
  return weeks;
}
