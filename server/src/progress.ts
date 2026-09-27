import { computeCriticalPath } from "./criticalPath.js";
import { isAssignableType, type Task } from "./types.js";

/**
 * Project progress, computed — never asked of a model.
 *
 * The same split as the planner: **this code decides every number, the model
 * only explains them.** Asked "how far along are we?", a language model will
 * produce a confident percentage with nothing behind it. So everything a
 * progress report states as a figure — % done, % planned, SPI, slip, overdue
 * counts, which phase is behind — is derived here from the tasks, and the AI
 * narrative (ai/report.ts), the report page and the chat assistant all read this
 * one object. A number on the page and a number in the chat can't disagree.
 *
 * Pure: takes tasks and a date, returns a value. No Jira, no database.
 */

export type Health = "on_track" | "at_risk" | "off_track";

export interface TaskRef {
  id: string;
  summary: string;
  assignee: string | null;
  startDate: string | null;
  dueDate: string | null;
  statusName: string;
  /** On the critical path — the same set the Gantt paints red. */
  critical: boolean;
}

export interface OverdueItem extends TaskRef {
  daysLate: number;
}

export interface SlippedItem extends TaskRef {
  baselineDue: string;
  slipDays: number;
}

export interface PhaseProgress {
  /** Epic key; null groups work that sits under no Epic. */
  id: string | null;
  summary: string;
  total: number;
  done: number;
  actualPct: number;
  plannedPct: number;
  start: string | null;
  end: string | null;
  baselineEnd: string | null;
  overdue: number;
}

export interface PersonProgress {
  accountId: string | null;
  name: string;
  open: number;
  inProgress: number;
  done: number;
  overdue: number;
}

export interface ProgressMetrics {
  asOf: string;
  counts: {
    /** Leaf work items — see `workItems` below for what that excludes. */
    total: number;
    done: number;
    inProgress: number;
    todo: number;
    overdue: number;
    slipped: number;
    notStarted: number;
    unassigned: number;
    /** Tasks with no start date: invisible on the Gantt and left out of every %. */
    undated: number;
    /**
     * Scheduled work with no baseline. Their "planned" falls back to the current
     * dates, so they can never look behind — worth saying out loud, because a
     * project with no baselines at all reads as permanently on plan.
     */
    noBaseline: number;
    criticalOpen: number;
  };
  /** 0–100. Duration-weighted share of scheduled work that is actually done. */
  actualPct: number;
  /** 0–100. Share the baseline says should be done by `asOf`. */
  plannedPct: number;
  /** actual ÷ planned. Null until the plan expects enough work for the ratio to mean anything. */
  spi: number | null;
  health: Health;
  /** Plain-language reasons for `health`, in order of severity. Never empty. */
  healthReasons: string[];
  schedule: {
    start: string | null;
    /** The latest due date in the current plan. */
    plannedEnd: string | null;
    /** The latest baseline due date — what was originally committed to. */
    baselineEnd: string | null;
    /** plannedEnd − baselineEnd in calendar days; positive means late. */
    slipDays: number | null;
    daysRemaining: number | null;
  };
  overdue: OverdueItem[];
  slipped: SlippedItem[];
  dueSoon: TaskRef[];
  notStarted: TaskRef[];
  unassigned: TaskRef[];
  phases: PhaseProgress[];
  people: PersonProgress[];
}

const DAY_MS = 86_400_000;
/** Lists are capped for the page and the prompt; `counts` always carries the true total. */
const LIST_CAP = 25;
/** Below this, the plan barely expects anything yet and SPI is noise (planned 1%, done 0% → SPI 0). */
const SPI_MIN_PLANNED_PCT = 10;

function toUtc(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function diffDays(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

function addDays(iso: string, days: number): string {
  return new Date(toUtc(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Done means 100 whatever the overlay says; otherwise the recorded %. */
function pctOf(t: Task): number {
  if (t.statusCategory === "done") return 100;
  return Math.min(100, Math.max(0, t.percentComplete));
}

/**
 * Share of a task's baseline window that has elapsed by `asOf`, 0–1.
 *
 * Baseline first, current dates as the fallback: "planned" means what was
 * committed to, and measuring against the current (already-slipped) dates
 * would make a late project look on plan simply because its plan moved.
 */
function plannedFraction(t: Task, asOf: string): number {
  const start = t.baselineStart ?? t.startDate;
  if (!start) return 0;
  const end = t.baselineDue ?? t.dueDate ?? start;
  if (asOf < start) return 0;
  if (asOf >= end) return 1;
  const span = diffDays(start, end) + 1;
  return Math.min(1, (diffDays(start, asOf) + 1) / span);
}

export function computeProgress(tasks: Task[], asOf: string): ProgressMetrics {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const parentIds = new Set(tasks.map((t) => t.wbsParentId).filter((p): p is string => !!p));

  // Work items = leaves that are real work. A Story with sub-tasks is excluded
  // (its sub-tasks are counted instead — counting both double-counts the same
  // effort), and every Epic is excluded (a container, see isAssignableType).
  const workItems = tasks.filter((t) => isAssignableType(t.issueType) && !parentIds.has(t.id));
  const scheduled = workItems.filter((t) => t.startDate);
  const open = workItems.filter((t) => t.statusCategory !== "done");

  const critical = computeCriticalPath(tasks);
  const ref = (t: Task): TaskRef => ({
    id: t.id,
    summary: t.summary,
    assignee: t.assigneeName,
    startDate: t.startDate,
    dueDate: t.dueDate,
    statusName: t.statusName,
    critical: critical.has(t.id),
  });

  // --- headline percentages, duration-weighted over scheduled work ----------
  // Weighted by duration so a ten-day task moves the number more than a one-day
  // one. Both percentages share one denominator (scheduled work) — undated tasks
  // have no plan to be ahead of or behind, and including them on only one side
  // would bias SPI.
  let weightTotal = 0;
  let earned = 0;
  let planned = 0;
  for (const t of scheduled) {
    const w = Math.max(1, t.durationDays);
    weightTotal += w;
    earned += (w * pctOf(t)) / 100;
    planned += w * plannedFraction(t, asOf);
  }
  const actualPct = weightTotal > 0 ? round1((earned / weightTotal) * 100) : 0;
  const plannedPct = weightTotal > 0 ? round1((planned / weightTotal) * 100) : 0;
  const spi = plannedPct >= SPI_MIN_PLANNED_PCT ? Math.round((actualPct / plannedPct) * 100) / 100 : null;

  // --- lists -----------------------------------------------------------------
  const overdueAll: OverdueItem[] = open
    .filter((t) => t.dueDate && t.dueDate < asOf)
    .map((t) => ({ ...ref(t), daysLate: diffDays(t.dueDate!, asOf) }))
    // Critical first: a late task on the critical path moves the end date, a
    // late one with float may not.
    .sort((a, b) => Number(b.critical) - Number(a.critical) || b.daysLate - a.daysLate);

  const slippedAll: SlippedItem[] = open
    .filter((t) => t.baselineDue && t.dueDate && t.dueDate > t.baselineDue)
    .map((t) => ({ ...ref(t), baselineDue: t.baselineDue!, slipDays: diffDays(t.baselineDue!, t.dueDate!) }))
    .sort((a, b) => b.slipDays - a.slipDays);

  const weekAhead = addDays(asOf, 7);
  const dueSoonAll = open
    .filter((t) => t.dueDate && t.dueDate >= asOf && t.dueDate <= weekAhead)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
    .map(ref);

  // Should have started by now and still hasn't — usually the earliest warning a
  // schedule gives, days before anything is actually overdue.
  const notStartedAll = open
    .filter((t) => t.statusCategory === "new" && t.startDate && t.startDate < asOf)
    .sort((a, b) => a.startDate!.localeCompare(b.startDate!))
    .map(ref);

  const unassignedAll = open.filter((t) => !t.assigneeAccountId).map(ref);
  const criticalOpen = open.filter((t) => critical.has(t.id)).length;
  const criticalOverdue = overdueAll.filter((t) => t.critical).length;

  // --- schedule envelope -----------------------------------------------------
  let start: string | null = null;
  let plannedEnd: string | null = null;
  let baselineEnd: string | null = null;
  for (const t of scheduled) {
    if (!start || t.startDate! < start) start = t.startDate!;
    const due = t.dueDate ?? t.startDate!;
    if (!plannedEnd || due > plannedEnd) plannedEnd = due;
    const bDue = t.baselineDue ?? due;
    if (!baselineEnd || bDue > baselineEnd) baselineEnd = bDue;
  }
  const slipDays = plannedEnd && baselineEnd ? diffDays(baselineEnd, plannedEnd) : null;
  const daysRemaining = plannedEnd ? Math.max(0, diffDays(asOf, plannedEnd)) : null;

  // --- phases: grouped by nearest Epic ancestor ------------------------------
  const epicOf = (t: Task): Task | null => {
    let cursor = t.wbsParentId ? byId.get(t.wbsParentId) : undefined;
    for (let guard = 0; cursor && guard < 20; guard++) {
      if (!isAssignableType(cursor.issueType)) return cursor;
      cursor = cursor.wbsParentId ? byId.get(cursor.wbsParentId) : undefined;
    }
    return null;
  };

  const phaseGroups = new Map<string, { epic: Task | null; items: Task[] }>();
  for (const t of workItems) {
    const epic = epicOf(t);
    const key = epic?.id ?? "";
    const group = phaseGroups.get(key) ?? { epic, items: [] };
    group.items.push(t);
    phaseGroups.set(key, group);
  }

  const phases: PhaseProgress[] = [...phaseGroups.values()].map(({ epic, items }) => {
    let w = 0;
    let e = 0;
    let p = 0;
    let pStart: string | null = null;
    let pEnd: string | null = null;
    let pBase: string | null = null;
    for (const t of items) {
      if (!t.startDate) continue;
      const weight = Math.max(1, t.durationDays);
      w += weight;
      e += (weight * pctOf(t)) / 100;
      p += weight * plannedFraction(t, asOf);
      if (!pStart || t.startDate < pStart) pStart = t.startDate;
      const due = t.dueDate ?? t.startDate;
      if (!pEnd || due > pEnd) pEnd = due;
      const bDue = t.baselineDue ?? due;
      if (!pBase || bDue > pBase) pBase = bDue;
    }
    return {
      id: epic?.id ?? null,
      summary: epic?.summary ?? "Không thuộc Epic nào",
      total: items.length,
      done: items.filter((t) => t.statusCategory === "done").length,
      actualPct: w > 0 ? round1((e / w) * 100) : 0,
      plannedPct: w > 0 ? round1((p / w) * 100) : 0,
      start: pStart,
      end: pEnd,
      baselineEnd: pBase,
      overdue: items.filter((t) => t.statusCategory !== "done" && t.dueDate && t.dueDate < asOf).length,
    };
  });
  // In schedule order, with the no-Epic bucket last: a report reads phase by phase.
  phases.sort((a, b) => {
    if (a.id === null) return 1;
    if (b.id === null) return -1;
    return (a.start ?? "9999").localeCompare(b.start ?? "9999");
  });

  // --- people ------------------------------------------------------------------
  const peopleMap = new Map<string, PersonProgress>();
  for (const t of workItems) {
    const key = t.assigneeAccountId ?? "";
    const person = peopleMap.get(key) ?? {
      accountId: t.assigneeAccountId,
      name: t.assigneeName ?? "Chưa gán",
      open: 0,
      inProgress: 0,
      done: 0,
      overdue: 0,
    };
    if (t.statusCategory === "done") person.done += 1;
    else {
      person.open += 1;
      if (t.statusCategory === "indeterminate") person.inProgress += 1;
      if (t.dueDate && t.dueDate < asOf) person.overdue += 1;
    }
    peopleMap.set(key, person);
  }
  const people = [...peopleMap.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open);

  const { health, reasons } = judgeHealth({
    spi,
    actualPct,
    plannedPct,
    slipDays,
    openScheduled: open.filter((t) => t.startDate).length,
    overdue: overdueAll.length,
    criticalOverdue,
    notStarted: notStartedAll.length,
  });

  return {
    asOf,
    counts: {
      total: workItems.length,
      done: workItems.filter((t) => t.statusCategory === "done").length,
      inProgress: workItems.filter((t) => t.statusCategory === "indeterminate").length,
      todo: workItems.filter((t) => t.statusCategory === "new").length,
      overdue: overdueAll.length,
      slipped: slippedAll.length,
      notStarted: notStartedAll.length,
      unassigned: unassignedAll.length,
      undated: workItems.length - scheduled.length,
      noBaseline: scheduled.filter((t) => !t.baselineStart && !t.baselineDue).length,
      criticalOpen,
    },
    actualPct,
    plannedPct,
    spi,
    health,
    healthReasons: reasons,
    schedule: { start, plannedEnd, baselineEnd, slipDays, daysRemaining },
    overdue: overdueAll.slice(0, LIST_CAP),
    slipped: slippedAll.slice(0, LIST_CAP),
    dueSoon: dueSoonAll.slice(0, LIST_CAP),
    notStarted: notStartedAll.slice(0, LIST_CAP),
    unassigned: unassignedAll.slice(0, LIST_CAP),
    phases,
    people,
  };
}

/**
 * The traffic light, decided by rules a person can check — not by the model.
 *
 * Each rule that fires contributes a reason, and the worst verdict wins. The
 * reasons are shown next to the badge and handed to the AI, which is told to
 * explain them rather than form its own opinion: a report whose headline says
 * "on track" while its own numbers say 20% behind is worse than no report.
 */
function judgeHealth(input: {
  spi: number | null;
  actualPct: number;
  plannedPct: number;
  slipDays: number | null;
  openScheduled: number;
  overdue: number;
  criticalOverdue: number;
  notStarted: number;
}): { health: Health; reasons: string[] } {
  const rank: Record<Health, number> = { on_track: 0, at_risk: 1, off_track: 2 };
  let health: Health = "on_track";
  const reasons: Array<{ level: Health; text: string }> = [];
  const flag = (level: Health, text: string) => {
    reasons.push({ level, text });
    if (rank[level] > rank[health]) health = level;
  };

  if (input.spi !== null) {
    const gap = round1(input.plannedPct - input.actualPct);
    if (input.spi < 0.8) {
      flag("off_track", `Hoàn thành ${input.actualPct}% trong khi kế hoạch là ${input.plannedPct}% (SPI ${input.spi}, chậm ${gap} điểm %).`);
    } else if (input.spi < 0.95) {
      flag("at_risk", `Hoàn thành ${input.actualPct}% so với kế hoạch ${input.plannedPct}% (SPI ${input.spi}).`);
    }
  }

  if (input.slipDays !== null && input.slipDays > 0) {
    flag(
      input.slipDays > 10 ? "off_track" : "at_risk",
      `Ngày kết thúc dự kiến trễ ${input.slipDays} ngày so với baseline.`
    );
  }

  if (input.criticalOverdue > 0) {
    flag(
      input.criticalOverdue > 2 ? "off_track" : "at_risk",
      `${input.criticalOverdue} công việc trên đường găng đã quá hạn — mỗi ngày trễ ở đây đẩy lùi ngày kết thúc.`
    );
  }

  if (input.overdue > 0 && input.openScheduled > 0) {
    const share = input.overdue / input.openScheduled;
    flag(
      share > 0.2 ? "off_track" : "at_risk",
      `${input.overdue}/${input.openScheduled} công việc đang mở đã quá hạn (${Math.round(share * 100)}%).`
    );
  }

  if (input.notStarted > 0) {
    flag("at_risk", `${input.notStarted} công việc đã tới ngày bắt đầu nhưng vẫn ở trạng thái chưa làm.`);
  }

  if (reasons.length === 0) {
    const detail =
      input.spi !== null
        ? `hoàn thành ${input.actualPct}%, kế hoạch ${input.plannedPct}%`
        : `dự án mới ở giai đoạn đầu (kế hoạch mới yêu cầu ${input.plannedPct}%)`;
    return { health, reasons: [`Không có công việc quá hạn, không trễ baseline — ${detail}.`] };
  }

  reasons.sort((a, b) => rank[b.level] - rank[a.level]);
  return { health, reasons: reasons.map((r) => r.text) };
}

export const HEALTH_LABEL: Record<Health, string> = {
  on_track: "Đúng tiến độ",
  at_risk: "Có rủi ro",
  off_track: "Chậm tiến độ",
};

/** One dense line for the chat assistant's system prompt — cheap enough to send on every turn. */
export function progressHeadline(m: ProgressMetrics): string {
  const parts = [
    `Tình trạng: ${HEALTH_LABEL[m.health]}`,
    `hoàn thành ${m.actualPct}% (kế hoạch ${m.plannedPct}%${m.spi !== null ? `, SPI ${m.spi}` : ""})`,
    `${m.counts.done}/${m.counts.total} công việc xong`,
    `${m.counts.overdue} quá hạn`,
  ];
  if (m.schedule.plannedEnd) {
    parts.push(
      `dự kiến kết thúc ${m.schedule.plannedEnd}` +
        (m.schedule.slipDays ? ` (trễ ${m.schedule.slipDays} ngày so với baseline ${m.schedule.baselineEnd})` : "")
    );
  }
  return parts.join(" · ");
}
