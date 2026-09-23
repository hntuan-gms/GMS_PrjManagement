import { isAssignableType, type JiraUser, type Task } from "./types.js";
import { DEFAULT_CAPACITY_HOURS, type ResourceAbsence, type ResourceProfile } from "./resourceStore.js";

/**
 * How busy each person is, day by day — the server's half of the workload model.
 *
 * `client/src/resourceAllocation.ts` computes the same thing for the heatmap,
 * and the two are deliberately kept as mirrors rather than a shared package, the
 * same arrangement `earliestStartFor` (taskService.ts) and `dependencyCascade.ts`
 * already use. The client's copy owns everything about *presenting* load —
 * colour bands, week aggregation, overlap pairs. This copy owns only the numbers
 * needed to answer "who should take this?", so the duplicated surface is the
 * three rules below and nothing else:
 *
 *   1. weekends and absence days have zero capacity;
 *   2. a task's hours spread evenly across the working days in its own span;
 *   3. no estimate means one full working day, and a done task means nothing.
 *
 * If those three change, change them in both files.
 */

const DAY_MS = 86_400_000;

function toUtc(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let ms = toUtc(from); ms <= toUtc(to); ms += DAY_MS) out.push(toIso(ms));
  return out;
}

export function isWeekend(iso: string): boolean {
  const day = new Date(toUtc(iso)).getUTCDay();
  return day === 0 || day === 6;
}

export interface WorkloadInput {
  tasks: Task[];
  users: JiraUser[];
  profiles: ResourceProfile[];
  absences: ResourceAbsence[];
}

export interface PersonWorkload {
  accountId: string;
  displayName: string;
  capacityHoursPerDay: number;
  /** Hours already committed, keyed by ISO date. Days off are simply absent. */
  allocated: Map<string, number>;
  /** Task ids per ISO date, so a conflict can name what it collides with. */
  taskIds: Map<string, string[]>;
  isOff: (iso: string) => boolean;
  openTaskCount: number;
}

/** Hours per working day one task costs the person holding it. */
export function demandPerDay(task: Task, capacityHoursPerDay: number, isOff: (iso: string) => boolean): number {
  const span = taskDates(task);
  if (span.length === 0) return 0;
  const working = span.filter((d) => !isOff(d));
  const charged = working.length > 0 ? working : span;
  return task.estimateHours != null && task.estimateHours > 0
    ? task.estimateHours / charged.length
    : capacityHoursPerDay;
}

export function taskDates(task: Task): string[] {
  if (!task.startDate) return [];
  const end = task.dueDate && task.dueDate >= task.startDate ? task.dueDate : task.startDate;
  return eachDate(task.startDate, end);
}

export function buildWorkload(input: WorkloadInput): Map<string, PersonWorkload> {
  const profileBy = new Map(input.profiles.map((p) => [p.accountId, p]));
  const absencesBy = new Map<string, ResourceAbsence[]>();
  for (const a of input.absences) {
    absencesBy.set(a.accountId, [...(absencesBy.get(a.accountId) ?? []), a]);
  }

  const out = new Map<string, PersonWorkload>();
  for (const user of input.users) {
    const capacityHoursPerDay = profileBy.get(user.accountId)?.capacityHoursPerDay ?? DEFAULT_CAPACITY_HOURS;
    const away = absencesBy.get(user.accountId) ?? [];
    out.set(user.accountId, {
      accountId: user.accountId,
      displayName: user.displayName,
      capacityHoursPerDay,
      allocated: new Map(),
      taskIds: new Map(),
      isOff: (iso) => isWeekend(iso) || away.some((a) => iso >= a.from && iso <= a.to),
      openTaskCount: 0,
    });
  }

  for (const task of input.tasks) {
    if (task.statusCategory === "done" || !task.assigneeAccountId) continue;
    // Epics are containers spanning all their children; counting one would book
    // its owner solid for the whole phase. See isAssignableType.
    if (!isAssignableType(task.issueType)) continue;
    const person = out.get(task.assigneeAccountId);
    if (!person) continue; // assigned to someone no longer on the project

    person.openTaskCount += 1;
    const span = taskDates(task);
    const working = span.filter((d) => !person.isOff(d));
    const charged = working.length > 0 ? working : span;
    if (charged.length === 0) continue;
    const perDay = demandPerDay(task, person.capacityHoursPerDay, person.isOff);
    for (const date of charged) {
      person.allocated.set(date, (person.allocated.get(date) ?? 0) + perDay);
      person.taskIds.set(date, [...(person.taskIds.get(date) ?? []), task.id]);
    }
  }

  return out;
}

export interface Candidate {
  accountId: string;
  displayName: string;
  /** Working days in the window where taking this work would exceed capacity. */
  conflictDays: number;
  /** Hours they would be over capacity, summed — how bad the conflict is. */
  overflowHours: number;
  /** Spare hours across the window before taking it. */
  freeHours: number;
  /** Share of capacity used after taking it, 0–1+. */
  utilisationAfter: number;
  openTaskCount: number;
  /** Issue keys already booked on the colliding days. */
  collidesWith: string[];
  /** Working days they have in the window at all — 0 means fully away. */
  availableDays: number;
}

/**
 * Ranks who should take a piece of work spanning [from, to].
 *
 * The ordering is the whole point: **fewest conflict days first**, then least
 * loaded. Picking "the least loaded person overall" is the obvious rule and the
 * wrong one — someone at 40% for the month can still be double-booked in exactly
 * the week this task needs, and a month-long average hides that completely.
 *
 * Nobody is filtered out for being busy. A fully-booked team still has to do the
 * work, and returning an empty list would just make the caller invent something;
 * the conflict cost is reported instead so the decision is visible.
 */
export function rankCandidates(
  workload: Map<string, PersonWorkload>,
  from: string,
  to: string,
  hoursPerDay: number | null,
  restrictTo?: string[]
): Candidate[] {
  const dates = eachDate(from, to);
  const allowed = restrictTo && restrictTo.length > 0 ? new Set(restrictTo) : null;

  const candidates: Candidate[] = [];
  for (const person of workload.values()) {
    if (allowed && !allowed.has(person.accountId)) continue;

    const working = dates.filter((d) => !person.isOff(d));
    // A task needing capacity the person simply does not have in this window is
    // the worst possible fit, but still reported — see the note above.
    const perDay = hoursPerDay ?? person.capacityHoursPerDay;

    let conflictDays = 0;
    let overflowHours = 0;
    let freeHours = 0;
    let usedHours = 0;
    const collidesWith = new Set<string>();

    for (const date of working) {
      const already = person.allocated.get(date) ?? 0;
      const capacity = person.capacityHoursPerDay;
      usedHours += already;
      freeHours += Math.max(0, capacity - already);
      const after = already + perDay;
      if (after > capacity + 0.0001) {
        conflictDays += 1;
        overflowHours += after - capacity;
        for (const id of person.taskIds.get(date) ?? []) collidesWith.add(id);
      }
    }

    const totalCapacity = working.length * person.capacityHoursPerDay;
    candidates.push({
      accountId: person.accountId,
      displayName: person.displayName,
      conflictDays,
      overflowHours: Math.round(overflowHours * 10) / 10,
      freeHours: Math.round(freeHours * 10) / 10,
      utilisationAfter:
        totalCapacity > 0 ? (usedHours + perDay * working.length) / totalCapacity : Infinity,
      openTaskCount: person.openTaskCount,
      collidesWith: [...collidesWith],
      availableDays: working.length,
    });
  }

  candidates.sort(
    (a, b) =>
      a.conflictDays - b.conflictDays ||
      a.overflowHours - b.overflowHours ||
      a.utilisationAfter - b.utilisationAfter ||
      // Last tiebreak is task count, so work spreads across people who look
      // identical on hours rather than piling onto whoever sorts first.
      a.openTaskCount - b.openTaskCount ||
      a.displayName.localeCompare(b.displayName, "vi")
  );
  return candidates;
}

/** Applies a just-made assignment so the next suggestion in the same turn sees it. */
export function commitAssignment(
  workload: Map<string, PersonWorkload>,
  accountId: string,
  from: string,
  to: string,
  hoursPerDay: number | null,
  taskId: string
): void {
  const person = workload.get(accountId);
  if (!person) return;
  const working = eachDate(from, to).filter((d) => !person.isOff(d));
  const perDay = hoursPerDay ?? person.capacityHoursPerDay;
  for (const date of working) {
    person.allocated.set(date, (person.allocated.get(date) ?? 0) + perDay);
    person.taskIds.set(date, [...(person.taskIds.get(date) ?? []), taskId]);
  }
  person.openTaskCount += 1;
}
