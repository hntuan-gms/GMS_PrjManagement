import { earliestStart } from "./dependencyCascade";
import { addDays, diffDays } from "./resourceAllocation";
import { isAssignableType, type Predecessor, type Task } from "./types";
import { dayKind, dayLabel, DEFAULT_WORK_CALENDAR, isoWeekday, type WorkCalendar } from "./workCalendar";

/*
 * The "Hôm nay" page (plan 6.5): what the signed-in person should look at first, from tasks the workspace
 * already holds. Pure, so the sections and the sentence on top are tested without a browser.
 *
 * Each of my open tasks appears in exactly one section, the most pressing that applies:
 *   waitingOnMe (someone else's work hangs on it) > overdue > today > upcoming.
 * Listing a task twice would make the page look busier than it is. `counts` and the greeting are over all
 * my open tasks, whichever section they landed in.
 *
 * Epics are left out throughout: they carry no assignee (isAssignableType), and data from before that rule
 * must not show one as "my work".
 */

export interface TodayWaiter {
  /** The other person's task that depends on mine. */
  task: Task;
  assigneeName: string;
  /**
   * How many days that task's start would move if mine slipped by one more day — 0 when it has slack.
   * An already overdue task of mine counts as late by its overdue days already, so the figure is what
   * one more day of delay costs the other person on top of what is already lost.
   */
  slipDaysIfLate: number;
}

export interface TodayData {
  waitingOnMe: Array<{ task: Task; waiters: TodayWaiter[] }>;
  today: Task[];
  /** My open tasks starting in the next UPCOMING_DAYS days, grouped by start date, soonest first. */
  upcoming: Array<{ date: string; tasks: Task[] }>;
  overdue: Task[];
  counts: { doing: number; dueThisWeek: number };
  /** Built by code from the figures above; the caller prefixes "Chào <tên>." */
  greeting: string;
}

export const UPCOMING_DAYS = 10;

const isOpen = (t: Task) => t.statusCategory !== "done";

/** A task's last day: its due date, else start + duration − 1. */
function endOf(t: Task): string | null {
  if (t.dueDate) return t.dueDate;
  return t.startDate ? addDays(t.startDate, Math.max(1, t.durationDays) - 1) : null;
}

/**
 * Days `succ` would have to move if `mine` (its predecessor through `edge`) slipped one more day — the
 * same FS/SS/FF/SF rule the cascade enforces (dependencyCascade.earliestStart), so "trễ 1n nếu bạn trễ"
 * is exactly what a drag would then do. 0 when either side has no dates.
 */
export function slipIfLate(mine: Task, succ: Task, edge: Predecessor, today: string): number {
  const end = endOf(mine);
  if (!mine.startDate || !end || !succ.startDate) return 0;
  const overdueBy = isOpen(mine) && end < today ? diffDays(end, today) : 0;
  const delay = overdueBy + 1;
  const bound = earliestStart(edge.type, addDays(mine.startDate, delay), addDays(end, delay), edge.lagDays, Math.max(1, succ.durationDays));
  return Math.max(0, diffDays(succ.startDate, bound));
}

/** The Sunday ending the ISO week that contains `iso`. */
function weekEnd(iso: string): string {
  return addDays(iso, 7 - isoWeekday(iso));
}

const byDue = (a: Task, b: Task) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.id.localeCompare(b.id);

export function buildToday(tasks: Task[], meAccountId: string, today: string, calendar: WorkCalendar = DEFAULT_WORK_CALENDAR): TodayData {
  const mine = tasks.filter((t) => t.assigneeAccountId === meAccountId && isOpen(t) && isAssignableType(t.issueType));

  // Who depends on what: predecessor id → [successor, the edge].
  const successors = new Map<string, Array<{ task: Task; edge: Predecessor }>>();
  for (const t of tasks) {
    for (const edge of t.predecessors) {
      const list = successors.get(edge.taskId) ?? [];
      list.push({ task: t, edge });
      successors.set(edge.taskId, list);
    }
  }

  const waitingOnMe: TodayData["waitingOnMe"] = [];
  for (const t of mine) {
    const waiters: TodayWaiter[] = (successors.get(t.id) ?? [])
      .filter(
        ({ task: s }) =>
          isOpen(s) && isAssignableType(s.issueType) && s.assigneeAccountId !== null && s.assigneeAccountId !== meAccountId
      )
      .map(({ task: s, edge }) => ({ task: s, assigneeName: s.assigneeName ?? "", slipDaysIfLate: slipIfLate(t, s, edge, today) }))
      .sort((a, b) => (a.task.startDate ?? "9999").localeCompare(b.task.startDate ?? "9999") || a.task.id.localeCompare(b.task.id));
    if (waiters.length > 0) waitingOnMe.push({ task: t, waiters });
  }
  // The work someone is waiting on soonest comes first.
  waitingOnMe.sort(
    (a, b) => (a.waiters[0].task.startDate ?? "9999").localeCompare(b.waiters[0].task.startDate ?? "9999") || a.task.id.localeCompare(b.task.id)
  );

  const placed = new Set(waitingOnMe.map((w) => w.task.id));
  const overdueAll = mine.filter((t) => t.dueDate !== null && t.dueDate < today);
  const overdue = overdueAll.filter((t) => !placed.has(t.id)).sort(byDue);
  for (const t of overdue) placed.add(t.id);

  const todayList = mine
    .filter((t) => !placed.has(t.id))
    .filter((t) => t.statusCategory === "indeterminate" || (!!t.startDate && t.startDate <= today && (endOf(t) ?? t.startDate) >= today))
    .sort(byDue);
  for (const t of todayList) placed.add(t.id);

  const horizon = addDays(today, UPCOMING_DAYS);
  const upcomingByDate = new Map<string, Task[]>();
  for (const t of mine) {
    if (placed.has(t.id) || !t.startDate || t.startDate <= today || t.startDate > horizon) continue;
    const list = upcomingByDate.get(t.startDate) ?? [];
    list.push(t);
    upcomingByDate.set(t.startDate, list);
  }
  const upcoming = [...upcomingByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({ date, tasks: list.sort((a, b) => a.id.localeCompare(b.id)) }));

  const sunday = weekEnd(today);
  const counts = {
    doing: mine.filter((t) => t.statusCategory === "indeterminate").length,
    dueThisWeek: mine.filter((t) => t.dueDate !== null && t.dueDate >= today && t.dueDate <= sunday).length,
  };

  const waitingPeople = new Set(waitingOnMe.flatMap((w) => w.waiters.map((x) => x.task.assigneeAccountId)));
  return {
    waitingOnMe,
    today: todayList,
    upcoming,
    overdue,
    counts,
    greeting: todayGreeting({ waitingPeople: waitingPeople.size, overdue: overdueAll.length, today, calendar }),
  };
}

/**
 * The sentence under "Chào X.": the day off first (it changes how everything else reads), then who is
 * waiting, then what is overdue; with none of those, the calm default. Code, not a model — it must match
 * the lists below it exactly.
 */
export function todayGreeting(input: { waitingPeople: number; overdue: number; today: string; calendar?: WorkCalendar }): string {
  const cal = input.calendar ?? DEFAULT_WORK_CALENDAR;
  const parts: string[] = [];
  const kind = dayKind(input.today, cal);
  if (kind === "holiday") {
    const name = dayLabel(input.today, cal);
    parts.push(name ? `Hôm nay nghỉ lễ ${name}.` : "Hôm nay là ngày lễ.");
  } else if (kind === "weekend") parts.push("Hôm nay là ngày nghỉ.");
  if (input.waitingPeople > 0) parts.push(`${input.waitingPeople} người đang chờ việc của bạn.`);
  if (input.overdue > 0) parts.push(`Bạn có ${input.overdue} việc quá hạn.`);
  if (input.waitingPeople === 0 && input.overdue === 0) {
    // "Chúc một ngày tập trung" is a working-day wish; on a day off it would read as a nudge to work.
    parts.push(kind === "work" ? "Không có gì gấp. Chúc một ngày tập trung." : "Không có gì gấp.");
  }
  return parts.join(" ");
}
