import { computeCriticalPath } from "./criticalPath";
import { formatDayMonth, formatDayRange } from "./humanDate";
import { addDays, DEFAULT_CAPACITY_HOURS, diffDays } from "./resourceAllocation";
import { isAssignableType, type Health, type JiraUser, type ProgressMetrics, type Task } from "./types";
import { DEFAULT_WORK_CALENDAR, isWorkingDate, workingDates, type WorkCalendar } from "./workCalendar";

/*
 * "Nhịp dự án" (plan 6.8): the sentence at the top of the report page and the "Cần bạn quyết" cards.
 *
 * Both are built by code from the measured figures (GET /api/progress → ProgressMetrics, computed by
 * server/src/progress.ts) and the workspace's tasks — never by the model. That is what lets the headline
 * always be there and always agree with the charts under it; the AI's "Phân tích sâu" is a separate layer.
 * SPI is kept off this surface (plan R2): a reason quoted from the server has its "(SPI …)" removed.
 *
 * The decisions use progress.ts's definitions of work: leaf, assignable tasks (a Story with sub-tasks is
 * counted through its sub-tasks, an Epic never). "Critical" is client/src/criticalPath.ts, the mirror of
 * the server's, so a card says "đường găng" about the same tasks the Gantt paints red.
 */

export type PulseVerdict = "good" | "watch" | "bad";

export interface PulseHeadline {
  verdict: PulseVerdict;
  /** The one-line conclusion, e.g. "Chậm 4 ngày so với kế hoạch." */
  lead: string;
  /** The start of `lead` to colour (--risk, or --st-done when on track), e.g. "Chậm 4 ngày". */
  leadKey: string;
  /** Why, and when it is now expected to finish. */
  detail: string;
}

const VERDICT: Record<Health, PulseVerdict> = { on_track: "good", at_risk: "watch", off_track: "bad" };

/** A server health reason without its SPI aside — the term stays in "Chất lượng số liệu". */
export function stripSpi(reason: string): string {
  return reason.replace(/\s*\(SPI [^)]*\)/g, "").replace(/\s+\./g, ".");
}

/** "a", "a, và b" — the two most serious causes; more would turn a headline into a list. */
function joinCauses(causes: string[]): string {
  const top = causes.slice(0, 2);
  return top.length === 2 ? `${top[0]}, và ${top[1]}` : top[0];
}

/**
 * The measured causes, worst first: critical work already late, critical work nobody owns, other late
 * work, work that should have started, then the overall gap. Each is a fact from the metrics, phrased.
 */
export function pulseCauses(m: ProgressMetrics): string[] {
  const causes: string[] = [];
  const critLate = m.overdue.filter((t) => t.critical);
  if (critLate.length === 1) causes.push(`${critLate[0].id} trên đường găng đã trễ ${critLate[0].daysLate} ngày`);
  else if (critLate.length > 1) causes.push(`${critLate.length} việc trên đường găng đã quá hạn`);

  const critUnowned = m.unassigned.filter((t) => t.critical);
  if (critUnowned.length === 1) causes.push(`${critUnowned[0].id} trên đường găng chưa có người`);
  else if (critUnowned.length > 1) causes.push(`${critUnowned.length} việc trên đường găng chưa có người`);

  const otherLate = m.counts.overdue - critLate.length;
  if (otherLate > 0) {
    const single = m.overdue.filter((t) => !t.critical);
    if (otherLate === 1 && single.length === 1) causes.push(`${single[0].id} đã trễ ${single[0].daysLate} ngày`);
    else causes.push(critLate.length > 0 ? `${otherLate} việc khác đã quá hạn` : `${otherLate} việc đã quá hạn`);
  }
  if (m.counts.notStarted > 0) causes.push(`${m.counts.notStarted} việc đã đến ngày bắt đầu mà chưa làm`);
  if (m.spi !== null && m.spi < 0.95) causes.push(`mới xong ${m.actualPct}% trong khi kế hoạch đến hôm nay là ${m.plannedPct}%`);
  return causes;
}

export function pulseHeadline(m: ProgressMetrics): PulseHeadline {
  if (m.counts.total === 0) {
    const lead = "Chưa có việc nào để đo tiến độ.";
    return { verdict: "watch", lead, leadKey: lead.slice(0, -1), detail: "Thêm việc có ngày bắt đầu và kết thúc để thấy nhịp dự án." };
  }
  const verdict = VERDICT[m.health];
  const slip = m.schedule.slipDays;
  let leadKey: string;
  let lead: string;
  if (slip !== null && slip > 0) {
    leadKey = `Chậm ${slip} ngày`;
    lead = `${leadKey} so với kế hoạch.`;
  } else if (m.health === "on_track") {
    leadKey = "Đúng tiến độ";
    lead = slip !== null && slip < 0 ? `Đúng tiến độ, sớm ${-slip} ngày so với kế hoạch.` : "Đúng tiến độ.";
  } else if (m.health === "at_risk") {
    leadKey = "Có rủi ro chậm";
    lead = "Có rủi ro chậm tiến độ.";
  } else {
    leadKey = "Chậm tiến độ";
    lead = "Chậm tiến độ.";
  }

  const sentences: string[] = [];
  if (verdict === "good") {
    sentences.push(
      m.spi !== null
        ? `Đã xong ${m.actualPct}%, kế hoạch đến hôm nay là ${m.plannedPct}%.`
        : `Dự án mới ở giai đoạn đầu: kế hoạch đến hôm nay mới là ${m.plannedPct}%.`
    );
  } else {
    const causes = pulseCauses(m);
    if (causes.length > 0) sentences.push(`Nguyên nhân chính: ${joinCauses(causes)}.`);
    else if (m.healthReasons[0]) sentences.push(stripSpi(m.healthReasons[0]));
  }
  const { plannedEnd, baselineEnd } = m.schedule;
  if (plannedEnd) {
    const planned = baselineEnd && baselineEnd !== plannedEnd ? ` (kế hoạch ${formatDayMonth(baselineEnd, m.asOf)})` : "";
    sentences.push(`Dự kiến xong ${formatDayMonth(plannedEnd, m.asOf)}${planned}.`);
  }
  return { verdict, lead, leadKey, detail: sentences.join(" ") };
}

/* ------------------------------------------------------------------ decisions */

export type PulseDecisionKind = "late-blocking" | "unassigned-critical" | "overloaded" | "overdue" | "no-baseline";

export interface PulseAction {
  kind: "assign" | "open" | "rebalance" | "set-baseline";
  label: string;
  taskId?: string;
  /** For "assign": the person code suggests; the card still offers "Chọn…". */
  suggestedAccountId?: string;
  /** For "rebalance": whose load to open. */
  accountId?: string;
}

export interface PulseDecision {
  kind: PulseDecisionKind;
  title: string;
  body: string;
  taskIds: string[];
  action: PulseAction;
}

/** Days ahead in which an overload is worth a card. */
export const OVERLOAD_HORIZON_DAYS = 14;

const isOpen = (t: Task) => t.statusCategory !== "done";
const endOf = (t: Task): string | null => t.dueDate ?? (t.startDate ? addDays(t.startDate, Math.max(1, t.durationDays) - 1) : null);
/** The given name: Vietnamese names end with it ("Trần Bình" → "Bình"). */
const givenName = (name: string) => name.trim().split(/\s+/).at(-1) ?? name;
const listIds = (ids: string[], max = 3) => (ids.length > max ? `${ids.slice(0, max).join(", ")} và ${ids.length - max} việc khác` : ids.join(", "));

/** Leaf, assignable tasks — progress.ts's "work items". */
function workItemsOf(tasks: Task[]): Task[] {
  const parents = new Set(tasks.map((t) => t.wbsParentId).filter((id): id is string => !!id));
  return tasks.filter((t) => !parents.has(t.id) && isAssignableType(t.issueType));
}

/** Hours a task asks of its owner on each working day of its span: its estimate spread out, or a full day. */
function dailyDemand(t: Task, calendar: WorkCalendar): number {
  if (!t.startDate) return 0;
  const days = workingDates(t.startDate, endOf(t) ?? t.startDate, calendar).length;
  if (t.estimateHours && t.estimateHours > 0 && days > 0) return t.estimateHours / days;
  return DEFAULT_CAPACITY_HOURS;
}

/**
 * Who should take an unowned task: fewest working days on which they already have something open within
 * its span, then fewest open tasks overall — the assistant's autoAssign rule (a monthly average hides a
 * double-booked week). Nobody is excluded for being busy.
 */
export function suggestAssignee(
  target: Task,
  users: JiraUser[],
  tasks: Task[],
  calendar: WorkCalendar = DEFAULT_WORK_CALENDAR
): { user: JiraUser; busyDays: number } | null {
  if (users.length === 0) return null;
  const work = workItemsOf(tasks).filter((t) => isOpen(t) && t.assigneeAccountId);
  const span = target.startDate ? workingDates(target.startDate, endOf(target) ?? target.startDate, calendar) : [];
  const ranked = users.map((user) => {
    const theirs = work.filter((t) => t.assigneeAccountId === user.accountId);
    const busyDays = span.filter((d) => theirs.some((t) => t.startDate && t.startDate <= d && (endOf(t) ?? t.startDate) >= d)).length;
    return { user, busyDays, open: theirs.length };
  });
  ranked.sort((a, b) => a.busyDays - b.busyDays || a.open - b.open || a.user.displayName.localeCompare(b.user.displayName, "vi"));
  return { user: ranked[0].user, busyDays: ranked[0].busyDays };
}

interface Candidate {
  rank: number;
  decision: PulseDecision;
}

/**
 * At most three things only a person can decide, most severe first. Severity, in order: late work that
 * blocks others on the critical path; critical work nobody owns; late work that blocks others; someone
 * overloaded in the next two weeks; other late work; missing baselines. One card per kind — a card about
 * several tasks names the worst and lists the rest in `taskIds`.
 *
 * Overload uses the resource tab's rule (estimate spread over the working days, a full day without one)
 * against DEFAULT_CAPACITY_HOURS: profiles and leave are not on this page, so a person with a 6-hour day
 * may be under-reported here, never over-reported by a made-up capacity.
 */
export function pulseDecisions(
  metrics: ProgressMetrics,
  tasks: Task[],
  users: JiraUser[],
  today: string,
  calendar: WorkCalendar = DEFAULT_WORK_CALENDAR
): PulseDecision[] {
  const critical = computeCriticalPath(tasks);
  const work = workItemsOf(tasks);
  const open = work.filter(isOpen);
  const nameOf = (accountId: string | null) =>
    accountId ? (users.find((u) => u.accountId === accountId)?.displayName ?? tasks.find((t) => t.assigneeAccountId === accountId)?.assigneeName ?? "") : "";

  const openSuccessors = new Map<string, string[]>();
  for (const t of tasks) {
    if (!isOpen(t)) continue;
    for (const p of t.predecessors) openSuccessors.set(p.taskId, [...(openSuccessors.get(p.taskId) ?? []), t.id]);
  }

  const out: Candidate[] = [];

  /* late work, split by whether someone is waiting on it */
  const late = open
    .filter((t) => t.dueDate && t.dueDate < today)
    .map((t) => {
      const blocked = openSuccessors.get(t.id) ?? [];
      return { task: t, daysLate: diffDays(t.dueDate!, today), blocked, critical: critical.has(t.id) || blocked.some((id) => critical.has(id)) };
    });
  const blocking = late
    .filter((l) => l.blocked.length > 0)
    .sort((a, b) => Number(b.critical) - Number(a.critical) || b.blocked.length - a.blocked.length || b.daysLate - a.daysLate);
  if (blocking.length > 0) {
    const worst = blocking[0];
    const tail = worst.critical ? " Trên đường găng: mỗi ngày trễ đẩy lùi ngày kết thúc." : "";
    out.push({
      rank: worst.critical ? 0 : 2,
      decision: {
        kind: "late-blocking",
        title: blocking.length === 1 ? `${worst.task.id} trễ ${worst.daysLate} ngày` : `${blocking.length} việc trễ đang chặn việc khác`,
        body:
          (blocking.length === 1 ? `Đang chặn ${listIds(worst.blocked)}.` : `Nặng nhất: ${worst.task.id} trễ ${worst.daysLate} ngày, chặn ${listIds(worst.blocked)}.`) +
          tail,
        taskIds: blocking.map((l) => l.task.id),
        action: { kind: "open", label: "Xem phụ thuộc", taskId: worst.task.id },
      },
    });
  }

  /* critical work nobody owns */
  const unowned = open
    .filter((t) => !t.assigneeAccountId && critical.has(t.id))
    .sort((a, b) => (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999") || a.id.localeCompare(b.id));
  if (unowned.length > 0) {
    const first = unowned[0];
    const when = !first.startDate
      ? "chưa có ngày"
      : first.startDate > today
        ? `bắt đầu sau ${diffDays(today, first.startDate)} ngày`
        : first.startDate === today
          ? "bắt đầu hôm nay"
          : `lẽ ra đã bắt đầu từ ${formatDayMonth(first.startDate, today)}`;
    const pick = suggestAssignee(first, users, tasks, calendar);
    const hint = pick ? ` Gợi ý: ${pick.user.displayName} (${pick.busyDays === 0 ? "rảnh" : "ít trùng lịch nhất"}).` : "";
    out.push({
      rank: 1,
      decision: {
        kind: "unassigned-critical",
        title: unowned.length === 1 ? `${first.id} chưa có người` : `${unowned.length} việc trên đường găng chưa có người`,
        body: `${unowned.length === 1 ? "Trên đường găng" : `Sớm nhất là ${first.id}`}, ${when}.${hint}`,
        taskIds: unowned.map((t) => t.id),
        action: pick
          ? { kind: "assign", label: `Giao cho ${givenName(pick.user.displayName)}`, taskId: first.id, suggestedAccountId: pick.user.accountId }
          : { kind: "assign", label: "Chọn người…", taskId: first.id },
      },
    });
  }

  /* someone overloaded soon */
  const overload = worstOverload(open, today, calendar);
  if (overload) {
    const name = nameOf(overload.accountId) || "Một người";
    out.push({
      rank: 3,
      decision: {
        kind: "overloaded",
        title: `${name} quá tải ${formatDayRange(overload.from, overload.to, today)}`,
        body: `${overload.concurrent} việc trùng ngày${overload.days > 1 ? `, ${overload.days} ngày quá tải trong 2 tuần tới` : ""}.`,
        taskIds: overload.taskIds,
        action: { kind: "rebalance", label: "Cân tải", accountId: overload.accountId },
      },
    });
  }

  /* other late work */
  const lateAlone = late.filter((l) => l.blocked.length === 0).sort((a, b) => b.daysLate - a.daysLate || a.task.id.localeCompare(b.task.id));
  if (lateAlone.length > 0) {
    const worst = lateAlone[0];
    const owner = worst.task.assigneeName ?? "chưa có người";
    out.push({
      rank: 4,
      decision: {
        kind: "overdue",
        // "khác" when the blocking ones already have their row: "51 việc quá hạn" under a headline
        // that counted 55 read as a wrong number.
        title:
          lateAlone.length === 1
            ? `${worst.task.id} trễ ${worst.daysLate} ngày`
            : `${lateAlone.length} việc quá hạn${lateAlone.length < late.length ? " khác" : ""}`,
        body: lateAlone.length === 1 ? `${worst.task.summary} · ${owner}.` : `Lâu nhất: ${worst.task.id} trễ ${worst.daysLate} ngày (${owner}).`,
        taskIds: lateAlone.map((l) => l.task.id),
        action: { kind: "open", label: `Mở ${worst.task.id}`, taskId: worst.task.id },
      },
    });
  }

  /* no baseline: work that can never look behind */
  const noBaseline = work.filter((t) => t.startDate && !t.baselineStart && !t.baselineDue).map((t) => t.id);
  const noBaselineCount = Math.max(metrics.counts.noBaseline, noBaseline.length);
  if (noBaselineCount > 0) {
    out.push({
      rank: 5,
      decision: {
        kind: "no-baseline",
        title: `${noBaselineCount} việc chưa có baseline`,
        body: "Chưa có baseline thì không biết việc nào đang chậm so với kế hoạch ban đầu.",
        taskIds: noBaseline,
        action: { kind: "set-baseline", label: "Chụp baseline" },
      },
    });
  }

  return out
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3)
    .map((c) => c.decision);
}

/**
 * The person with the most overloaded working days in the next OVERLOAD_HORIZON_DAYS, and their first run
 * of consecutive overloaded working days. null when nobody is over.
 */
function worstOverload(
  open: Task[],
  today: string,
  calendar: WorkCalendar
): { accountId: string; from: string; to: string; days: number; concurrent: number; taskIds: string[] } | null {
  const horizon = workingDates(today, addDays(today, OVERLOAD_HORIZON_DAYS - 1), calendar);
  const byPerson = new Map<string, Task[]>();
  for (const t of open) {
    if (!t.assigneeAccountId || !t.startDate) continue;
    byPerson.set(t.assigneeAccountId, [...(byPerson.get(t.assigneeAccountId) ?? []), t]);
  }
  let best: { accountId: string; from: string; to: string; days: number; concurrent: number; taskIds: string[] } | null = null;
  for (const [accountId, theirs] of [...byPerson.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const over: Array<{ date: string; tasks: Task[] }> = [];
    for (const d of horizon) {
      const on = theirs.filter((t) => t.startDate! <= d && (endOf(t) ?? t.startDate!) >= d && isWorkingDate(d, calendar));
      const hours = on.reduce((s, t) => s + dailyDemand(t, calendar), 0);
      if (hours > DEFAULT_CAPACITY_HOURS + 1e-9) over.push({ date: d, tasks: on });
    }
    if (over.length === 0 || (best && over.length <= best.days)) continue;
    // The first run of consecutive working days: "12–13/11" rather than every day listed.
    let end = 0;
    while (end + 1 < over.length && horizon.indexOf(over[end + 1].date) === horizon.indexOf(over[end].date) + 1) end++;
    const run = over.slice(0, end + 1);
    const ids = [...new Set(run.flatMap((r) => r.tasks.map((t) => t.id)))];
    best = {
      accountId,
      from: run[0].date,
      to: run[run.length - 1].date,
      days: over.length,
      concurrent: Math.max(...run.map((r) => r.tasks.length)),
      taskIds: ids,
    };
  }
  return best;
}
