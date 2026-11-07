import { computeCriticalPath } from "./criticalPath";
import { formatDayMonth, formatDayRange } from "./humanDate";
import { addDays, DEFAULT_CAPACITY_HOURS, diffDays, type ResourceLoad } from "./resourceAllocation";
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
  /** The verdict, one short sentence: "Chậm 3 ngày.", "Chậm 22 điểm.", "Đúng tiến độ." */
  lead: string;
  /** `lead` without its full stop. */
  leadKey: string;
  /** When it is expected to finish, beside the verdict: "Dự kiến xong 25/11, hạn 22/11." Empty when nothing is dated. */
  forecast: string;
  /**
   * "Vì sao?": the measured causes no "Cần bạn quyết" row already carries, then SPI explained. Never the
   * overall gap: the bar under the sentence already says it, in numbers.
   */
  reasons: string[];
}

/** A percentage as people read it: whole numbers. The server keeps one decimal for its own arithmetic. */
export const pct = (n: number) => `${Math.round(n)}%`;
/** "0,43": a decimal written the Vietnamese way. */
export const decimal = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const VERDICT: Record<Health, PulseVerdict> = { on_track: "good", at_risk: "watch", off_track: "bad" };

/** A server health reason without its SPI aside — the term stays in "Chất lượng số liệu". */
export function stripSpi(reason: string): string {
  return reason.replace(/\s*\(SPI [^)]*\)/g, "").replace(/\s+\./g, ".");
}

/**
 * One measured cause. `covers` is the kind of decision row (pulseDecisions) that already says the same
 * thing about the same work, so the headline can leave it out instead of saying it twice (plan H6);
 * `ids` are the issues it is about. A cause no decision row can carry (work that should have started, the
 * overall gap) has no `covers` and always stays in the headline.
 */
export interface PulseCause {
  text: string;
  /** The overall gap between done and planned: the bar under the verdict already shows it. */
  gap?: boolean;
  covers?: PulseDecisionKind[];
  ids?: string[];
}

/**
 * The measured causes, worst first: critical work already late, critical work nobody owns, other late
 * work, work that should have started, then the overall gap. Each is a fact from the metrics, phrased.
 */
export function pulseCauseItems(m: ProgressMetrics): PulseCause[] {
  const causes: PulseCause[] = [];
  const lateKinds: PulseDecisionKind[] = ["late-blocking", "overdue"];
  const critLate = m.overdue.filter((t) => t.critical);
  const critLateIds = critLate.map((t) => t.id);
  if (critLate.length === 1) causes.push({ text: `${critLate[0].id} trên đường găng đã trễ ${critLate[0].daysLate} ngày`, covers: lateKinds, ids: critLateIds });
  else if (critLate.length > 1) causes.push({ text: `${critLate.length} việc trên đường găng đã quá hạn`, covers: lateKinds, ids: critLateIds });

  const critUnowned = m.unassigned.filter((t) => t.critical);
  const unownedIds = critUnowned.map((t) => t.id);
  if (critUnowned.length === 1) causes.push({ text: `${critUnowned[0].id} trên đường găng chưa có người`, covers: ["unassigned-critical"], ids: unownedIds });
  else if (critUnowned.length > 1) causes.push({ text: `${critUnowned.length} việc trên đường găng chưa có người`, covers: ["unassigned-critical"], ids: unownedIds });

  const otherLate = m.counts.overdue - critLate.length;
  if (otherLate > 0) {
    const single = m.overdue.filter((t) => !t.critical);
    const ids = single.map((t) => t.id);
    if (otherLate === 1 && single.length === 1) causes.push({ text: `${single[0].id} đã trễ ${single[0].daysLate} ngày`, covers: lateKinds, ids });
    else causes.push({ text: critLate.length > 0 ? `${otherLate} việc khác đã quá hạn` : `${otherLate} việc đã quá hạn`, covers: lateKinds, ids });
  }
  if (m.counts.notStarted > 0) causes.push({ text: `${m.counts.notStarted} việc đã đến ngày bắt đầu mà chưa làm` });
  if (m.spi !== null && m.spi < 0.95) causes.push({ text: `mới xong ${pct(m.actualPct)} trong khi kế hoạch đến hôm nay là ${pct(m.plannedPct)}`, gap: true });
  return causes;
}

export function pulseCauses(m: ProgressMetrics): string[] {
  return pulseCauseItems(m).map((c) => c.text);
}

/**
 * Whether a decision row already carries this cause: a row of the right kind that is about at least one of
 * the same issues. The overlap test is on issue keys, so a row about other work does not hide a cause.
 */
function coveredBy(cause: PulseCause, decisions: PulseDecision[]): boolean {
  const kinds = cause.covers;
  if (!kinds) return false;
  return decisions.some((d) => kinds.includes(d.kind) && (!cause.ids || cause.ids.length === 0 || cause.ids.some((id) => d.taskIds.includes(id))));
}

/**
 * The verdict, the forecast and the reasons. `decisions` are the "Cần bạn quyết" rows shown under it: a
 * cause already one of them is not repeated in "Vì sao?" (one idea said once).
 *
 * The verdict is in days when the forecast end is past the baseline end (what a deadline is measured in),
 * otherwise in percentage points of work behind the plan ("Chậm 22 điểm"), with the plan and the actual
 * figure on the bar right under it. The forecast names the baseline date only when it differs, so the same
 * slip is never said twice in one line.
 */
export function pulseHeadline(m: ProgressMetrics, decisions: PulseDecision[] = []): PulseHeadline {
  if (m.counts.total === 0) {
    const lead = "Chưa có việc nào để đo tiến độ.";
    return { verdict: "watch", lead, leadKey: lead.slice(0, -1), forecast: "", reasons: [] };
  }
  const verdict = VERDICT[m.health];
  const slip = m.schedule.slipDays;
  const gap = Math.round(m.plannedPct) - Math.round(m.actualPct);
  let leadKey: string;
  if (slip !== null && slip > 0) leadKey = `Chậm ${slip} ngày`;
  else if (m.health !== "on_track" && m.spi !== null && gap >= 1) leadKey = `Chậm ${gap} điểm`;
  else if (m.health === "on_track") {
    if (slip !== null && slip < 0) leadKey = `Đúng tiến độ, sớm ${-slip} ngày`;
    else if (m.spi !== null && gap <= -1) leadKey = `Đi trước ${-gap} điểm`;
    else leadKey = "Đúng tiến độ";
  } else leadKey = m.health === "at_risk" ? "Có rủi ro chậm" : "Chậm tiến độ";

  const { plannedEnd, baselineEnd } = m.schedule;
  const forecast = plannedEnd
    ? `Dự kiến xong ${formatDayMonth(plannedEnd, m.asOf)}${baselineEnd && baselineEnd !== plannedEnd ? `, hạn ${formatDayMonth(baselineEnd, m.asOf)}` : ""}.`
    : "";

  const reasons = pulseCauseItems(m)
    .filter((c) => !c.gap)
    .filter((c) => !coveredBy(c, decisions))
    .map((c) => `${capitalise(c.text)}.`);
  if (m.counts.slipped > 0) reasons.push(`${m.counts.slipped} việc kết thúc muộn hơn baseline.`);
  if (m.spi !== null) {
    reasons.push(`Chỉ số tiến độ (SPI) ${decimal(m.spi)}: đã làm được ${Math.round(m.spi * 100)}% khối lượng lẽ ra phải xong đến hôm nay. 1 là đúng kế hoạch.`);
  } else {
    reasons.push(`Kế hoạch đến hôm nay mới là ${pct(m.plannedPct)}, còn quá sớm để so nhanh hay chậm.`);
  }
  if (m.counts.noBaseline > 0 && !decisions.some((d) => d.kind === "no-baseline")) {
    reasons.push(`${m.counts.noBaseline} việc chưa có baseline: chúng được đo theo lịch hiện tại nên không bao giờ hiện là chậm.`);
  }
  return { verdict, lead: `${leadKey}.`, leadKey, forecast, reasons };
}

/* ------------------------------------------------------------------ decisions */

export type PulseDecisionKind = "late-blocking" | "unassigned-critical" | "overloaded" | "overdue" | "no-baseline";

export interface PulseAction {
  /**
   * reschedule: pick a new due date for `taskId`. reassign / pick: choose a person for `taskId`.
   * assign: give `taskId` to `suggestedAccountId` in one click. rebalance: open that person's load.
   * set-baseline: freeze the current dates of the row's tasks as their baseline. open: the task.
   */
  kind: "reschedule" | "reassign" | "pick" | "assign" | "open" | "rebalance" | "set-baseline";
  label: string;
  taskId?: string;
  /** For "assign": the person code suggests. */
  suggestedAccountId?: string;
  /** For "rebalance": whose load to open. */
  accountId?: string;
  /** For "rebalance": the first overloaded day, to scroll the person's row to. */
  date?: string;
}

export interface PulseDecision {
  kind: PulseDecisionKind;
  title: string;
  body: string;
  taskIds: string[];
  /** What can be done from the row, in the order drawn; the last is the main one. */
  actions: PulseAction[];
}

/** Days ahead in which an overload is worth a card. */
export const OVERLOAD_HORIZON_DAYS = 14;

const isOpen = (t: Task) => t.statusCategory !== "done";
const endOf = (t: Task): string | null => t.dueDate ?? (t.startDate ? addDays(t.startDate, Math.max(1, t.durationDays) - 1) : null);
/** The given name: Vietnamese names end with it ("Trần Bình" → "Bình"). */
const givenName = (name: string) => name.trim().split(/\s+/).at(-1) ?? name;
const listIds = (ids: string[], max = 3) => (ids.length > max ? `${ids.slice(0, max).join(", ")} và ${ids.length - max} việc khác` : ids.join(", "));

/** Late work is decided one of two ways: a new date, or someone else. */
const fixLate = (taskId: string): PulseAction[] => [
  { kind: "reschedule", label: "Dời hạn", taskId },
  { kind: "reassign", label: "Giao lại", taskId },
];

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
  calendar: WorkCalendar = DEFAULT_WORK_CALENDAR,
  /**
   * The next two weeks' load as Nhân lực computes it (profiles, leave, the calendar). With it the overload row
   * names the same person and days as the Nhân lực badge and the "tải 2 tuần" column; without it (tests) the
   * row is worked out here against the default capacity.
   */
  load?: ResourceLoad | null
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
          (blocking.length === 1
            ? `${worst.task.summary} · ${worst.task.assigneeName ?? "chưa có người"}. Đang chặn ${listIds(worst.blocked)}.`
            : `Nặng nhất: ${worst.task.id} trễ ${worst.daysLate} ngày, chặn ${listIds(worst.blocked)}.`) + tail,
        taskIds: blocking.map((l) => l.task.id),
        actions: fixLate(worst.task.id),
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
        actions: pick
          ? [
              { kind: "pick", label: "Chọn…", taskId: first.id },
              { kind: "assign", label: `Giao cho ${givenName(pick.user.displayName)}`, taskId: first.id, suggestedAccountId: pick.user.accountId },
            ]
          : [{ kind: "pick", label: "Chọn người…", taskId: first.id }],
      },
    });
  }

  /* someone overloaded soon */
  const overload = load ? overloadFromLoad(load) : worstOverload(open, today, calendar);
  if (overload) {
    const name = nameOf(overload.accountId) || "Một người";
    out.push({
      rank: 3,
      decision: {
        kind: "overloaded",
        title: `${name} quá tải ${formatDayRange(overload.from, overload.to, today)}`,
        body: `${overload.concurrent} việc trùng ngày${overload.days > 1 ? `, ${overload.days} ngày quá tải trong 2 tuần tới` : ""}.`,
        taskIds: overload.taskIds,
        actions: [{ kind: "rebalance", label: nameOf(overload.accountId) ? `Xem lịch ${givenName(name)}` : "Xem lịch", accountId: overload.accountId, date: overload.from }],
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
        actions: fixLate(worst.task.id),
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
        actions: [{ kind: "set-baseline", label: "Chụp baseline" }],
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

/**
 * The overload row from Nhân lực's own load (buildResourceLoad over the next two weeks): the person with the
 * most days over capacity, and their first run of overloaded working days (days off in between do not end
 * a run). null when nobody is over.
 */
export function overloadFromLoad(
  load: ResourceLoad
): { accountId: string; from: string; to: string; days: number; concurrent: number; taskIds: string[] } | null {
  let best: { accountId: string; from: string; to: string; days: number; concurrent: number; taskIds: string[] } | null = null;
  for (const p of [...load.people].sort((a, b) => a.accountId.localeCompare(b.accountId))) {
    const overDays = p.days.filter((d) => d.band === "over").length;
    if (overDays === 0 || (best && overDays <= best.days)) continue;
    const start = p.days.findIndex((d) => d.band === "over");
    const run = [p.days[start]];
    for (let i = start + 1; i < p.days.length; i++) {
      const d = p.days[i];
      if (d.band === "over") run.push(d);
      else if (d.capacityHours > 0) break;
    }
    best = {
      accountId: p.accountId,
      from: run[0].date,
      to: run[run.length - 1].date,
      days: overDays,
      concurrent: Math.max(...run.map((d) => d.taskIds.length)),
      taskIds: [...new Set(run.flatMap((d) => d.taskIds))],
    };
  }
  return best;
}

/* ------------------------------------------------------------------ tables */

export type RowTone = "risk" | "warn" | "quiet";

export type WorkState = "done" | "inProgress" | "todo";

/** How a work state is written in a count: "5 chưa làm". */
export const STATE_LABEL: Record<WorkState, string> = {
  done: "xong",
  inProgress: "đang làm",
  todo: "chưa làm",
};

/**
 * The "lệch" cell of an Epic row, in words: "chậm 57 điểm · 1 quá hạn", "chưa tới lịch", "xong". It replaced
 * "43% / 100%" and a bare "!1": the reader should not have to know that the second figure was the plan.
 * `dated` is whether any work under the Epic has dates — without them the plan is 0% by construction.
 */
export function phaseStatus(p: ProgressMetrics["phases"][number], dated: boolean): { text: string; tone: RowTone } {
  if (p.total > 0 && p.done === p.total) return { text: "xong", tone: "quiet" };
  if (!dated) return { text: "chưa có ngày", tone: "quiet" };
  const gap = Math.round(p.plannedPct) - Math.round(p.actualPct);
  const parts: string[] = [];
  if (Math.round(p.plannedPct) === 0 && Math.round(p.actualPct) === 0) parts.push("chưa tới lịch");
  else if (gap >= 1) parts.push(`chậm ${gap} điểm`);
  else if (gap <= -1) parts.push(`trước ${-gap} điểm`);
  else parts.push("đúng kế hoạch");
  if (p.overdue > 0) parts.push(`${p.overdue} quá hạn`);
  if (p.end && p.baselineEnd && p.end > p.baselineEnd) parts.push(`kết thúc trễ ${diffDays(p.baselineEnd, p.end)} ngày`);
  const tone: RowTone = p.overdue > 0 || gap > 15 ? "risk" : gap >= 5 ? "warn" : "quiet";
  return { text: parts.join(" · "), tone };
}
