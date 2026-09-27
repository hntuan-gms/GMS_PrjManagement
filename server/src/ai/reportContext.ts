import { computeCriticalPath } from "../criticalPath.js";
import { isAssignableType, type Task } from "../types.js";

/**
 * The raw material the report model reasons over.
 *
 * `computeProgress` answers "how far along are we?" with numbers, and the page
 * already draws those. What a person wants from the AI is the part numbers
 * can't say: *why* a phase is behind, which task is quietly holding up three
 * others, who is carrying too much at once, what happens next week if nobody
 * steps in. None of that is visible in a percentage — it lives in the task
 * graph. So the model gets the graph itself (open work with its dependencies,
 * owners and dates) plus a few facts derived from it that are tedious to count
 * by eye (what each task is blocked by, how many things each person has open at
 * the same time), and is asked to reason, not to recompute.
 *
 * Pure, like progress.ts. Capped: a project with hundreds of open issues would
 * otherwise send a prompt that costs more than the report is worth, and the
 * ordering puts what matters most (late, critical, in flight) first so the cut
 * falls on work that can wait.
 */

const OPEN_WORK_CAP = 80;
const SUMMARY_CAP = 100;
const DESCRIPTION_CAP = 160;
/** Only the most urgent items carry a description excerpt — it is where "blocked by vendor" gets written. */
const DESCRIBED_CAP = 25;
const LOOKAHEAD_DAYS = 14;
const DAY_MS = 86_400_000;

export interface EvidenceTask {
  key: string;
  summary: string;
  type: string;
  status: string;
  assignee: string | null;
  start: string | null;
  due: string | null;
  baselineDue: string | null;
  durationDays: number;
  pctComplete: number;
  critical: boolean;
  /** Days past due, when it is. */
  daysLate?: number;
  /** Epic this sits under — for reasoning phase by phase. */
  epic: string | null;
  /** Predecessors that are not done yet: the task can't really move until these do. */
  blockedBy?: string[];
  /** How many open tasks wait on this one. A late task with many dependants is a bottleneck. */
  openDependants?: number;
  description?: string;
}

export interface EvidencePerson {
  name: string;
  open: number;
  inProgress: number;
  overdue: number;
  /** Open tasks whose span touches the next two weeks. */
  activeNext14d: number;
  /** Most tasks this person holds on any single day in the next two weeks. */
  peakConcurrent14d: number;
}

export interface ReportEvidence {
  openWork: EvidenceTask[];
  /** Open items left out by the cap — so the model knows the list is partial. */
  openWorkOmitted: number;
  people: EvidencePerson[];
  /** Everyone on the project team, including people with nothing assigned. */
  team: string[];
}

function toUtc(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function addDays(iso: string, days: number): string {
  return new Date(toUtc(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

function clip(text: string | null, max: number): string | undefined {
  if (!text) return undefined;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function buildEvidence(tasks: Task[], asOf: string, teamNames: string[]): ReportEvidence {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const parentIds = new Set(tasks.map((t) => t.wbsParentId).filter((p): p is string => !!p));
  const critical = computeCriticalPath(tasks);

  // Same definition of "work" as computeProgress, so the model reasons over the
  // exact set the numbers were computed from.
  const work = tasks.filter((t) => isAssignableType(t.issueType) && !parentIds.has(t.id));
  const open = work.filter((t) => t.statusCategory !== "done");

  const epicOf = (t: Task): string | null => {
    let cursor = t.wbsParentId ? byId.get(t.wbsParentId) : undefined;
    for (let guard = 0; cursor && guard < 20; guard++) {
      if (!isAssignableType(cursor.issueType)) return cursor.id;
      cursor = cursor.wbsParentId ? byId.get(cursor.wbsParentId) : undefined;
    }
    return null;
  };

  const openDependants = new Map<string, number>();
  for (const t of open) {
    for (const p of t.predecessors) openDependants.set(p.taskId, (openDependants.get(p.taskId) ?? 0) + 1);
  }

  const daysLate = (t: Task) => (t.dueDate && t.dueDate < asOf ? Math.round((toUtc(asOf) - toUtc(t.dueDate)) / DAY_MS) : 0);

  // Most urgent first: late work, then the critical path, then what is in
  // flight, then by due date. The cap cuts from the bottom of this order.
  const ranked = [...open].sort((a, b) => {
    const late = daysLate(b) - daysLate(a);
    if (late !== 0) return late;
    const crit = Number(critical.has(b.id)) - Number(critical.has(a.id));
    if (crit !== 0) return crit;
    const flight = Number(b.statusCategory === "indeterminate") - Number(a.statusCategory === "indeterminate");
    if (flight !== 0) return flight;
    return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
  });

  const openWork: EvidenceTask[] = ranked.slice(0, OPEN_WORK_CAP).map((t, i) => {
    const blockedBy = t.predecessors
      .map((p) => byId.get(p.taskId))
      .filter((p): p is Task => !!p && p.statusCategory !== "done")
      .map((p) => p.id);
    const late = daysLate(t);
    const dependants = openDependants.get(t.id) ?? 0;
    return {
      key: t.id,
      summary: clip(t.summary, SUMMARY_CAP) ?? t.id,
      type: t.issueType,
      status: t.statusName,
      assignee: t.assigneeName,
      start: t.startDate,
      due: t.dueDate,
      baselineDue: t.baselineDue,
      durationDays: t.durationDays,
      pctComplete: t.percentComplete,
      critical: critical.has(t.id),
      epic: epicOf(t),
      ...(late > 0 ? { daysLate: late } : {}),
      ...(blockedBy.length > 0 ? { blockedBy } : {}),
      ...(dependants > 0 ? { openDependants: dependants } : {}),
      ...(i < DESCRIBED_CAP && t.description ? { description: clip(t.description, DESCRIPTION_CAP) } : {}),
    };
  });

  // Concurrency over the next two weeks: a monthly count hides that someone has
  // five things due in the same three days.
  const horizonEnd = addDays(asOf, LOOKAHEAD_DAYS - 1);
  const peopleMap = new Map<string, EvidencePerson & { days: Map<string, number> }>();
  for (const t of open) {
    const name = t.assigneeName;
    if (!name) continue;
    const p = peopleMap.get(name) ?? {
      name,
      open: 0,
      inProgress: 0,
      overdue: 0,
      activeNext14d: 0,
      peakConcurrent14d: 0,
      days: new Map<string, number>(),
    };
    p.open += 1;
    if (t.statusCategory === "indeterminate") p.inProgress += 1;
    if (daysLate(t) > 0) p.overdue += 1;
    // Overdue work is still on their plate today even though its dates are past.
    const from = t.startDate && t.startDate > asOf ? t.startDate : asOf;
    const to = t.dueDate && t.dueDate >= asOf ? t.dueDate : daysLate(t) > 0 ? asOf : null;
    if (to && from <= horizonEnd && to >= asOf) {
      p.activeNext14d += 1;
      for (let d = from; d <= to && d <= horizonEnd; d = addDays(d, 1)) {
        p.days.set(d, (p.days.get(d) ?? 0) + 1);
      }
    }
    peopleMap.set(name, p);
  }
  const people: EvidencePerson[] = [...peopleMap.values()]
    .map(({ days, ...rest }) => ({ ...rest, peakConcurrent14d: Math.max(0, ...days.values()) }))
    .sort((a, b) => b.peakConcurrent14d - a.peakConcurrent14d || b.open - a.open);

  const assigned = new Set(people.map((p) => p.name));
  const team = [...new Set([...teamNames, ...assigned])];

  return { openWork, openWorkOmitted: Math.max(0, open.length - OPEN_WORK_CAP), people, team };
}
