import { cellsOf, projectOfKey, stableOrder, type OpenWork, type TaskRow } from "./timesheetModel";
import { roundHours } from "./taskForm";
import type { Task, WorklogEntry } from "./types";
import { dayKind, type WorkCalendar } from "./workCalendar";

/*
 * Clockwork "Của tôi": which projects are shown, in what order, open or folded, and which of their tasks are rows.
 * Pure, so the rules are tested without a browser (client/test/clockworkLayout.test.ts).
 *
 * The rules come from a backtest over two months of real worklogs (27 people, 9 projects): "I logged on it in the
 * last ten working days" is what predicts the next worklog; assigned / in progress add a little; and 91% of the
 * issues someone logs on for the first time are in a project they logged on in the last two weeks — which is why
 * every project has its own "+ Thêm việc".
 *
 * Projects:  pinned first (in the order they were pinned), then the one I logged on most recently, then the one
 *            with more hours; projects with only assigned work after those. The project the tab is on has no
 *            say. A project with nothing (no worklog in 30 days, nothing assigned, not pinned) is not shown.
 * Hidden:    a project the person hid is left out (it is listed in "Dự án khác") until something is logged or
 *            picked in it or it is pinned. A row closed with × stays closed until it is picked again or logged on.
 * Open:      pinned, logged in the period or in the last ten working days, a task in progress, or chosen by hand.
 *            Anything else starts folded. What the person opened or folded wins.
 * Rows:      logged in the period and picked by hand always; then logged before the period (latest first),
 *            assigned in progress, assigned. At most ROW_LIMIT rows unless more were logged; the rest behind
 *            "+n việc khác".
 * Stable:    rows and projects keep their place while the person types; only pinning moves a project at once.
 */

/** A line of what I logged before the period (server/src/clockworkHistory.ts). */
export interface HistoryItem {
  key: string;
  summary: string;
  issueType: string;
  lastDate: string;
  days: number;
  hours: number;
}

export const ROW_LIMIT = 8;
/** "Recently" for opening a project: logged within this many working days. */
export const RECENT_WORKDAYS = 10;

export interface ProjectGroup {
  project: string;
  pinned: boolean;
  open: boolean;
  /** The rows drawn while open. */
  rows: TaskRow[];
  /** Rows behind "Hiện thêm n việc" (none once it was opened). */
  more: number;
  /** "Hiện thêm" was opened and drew rows beyond the limit: "Thu gọn" folds them back. */
  expanded: boolean;
  /** The rows "Thu gọn" leaves (the first ones in rank order): the others are the ones that fold away. */
  base: string[];
  /** Nothing logged or picked here this period: the project may be hidden. */
  hideable: boolean;
  /** Rows this project has in all, drawn or not: what a folded project says. */
  count: number;
  total: number;
  dayTotals: Map<string, number>;
}

export interface LayoutInput {
  /** The period's worklogs (only mine are used). */
  entries: readonly WorklogEntry[];
  history: readonly HistoryItem[];
  /** My open work on every project, the most recently touched first. */
  openWork: readonly OpenWork[];
  /** The plan the tab holds: names rows and gives them a status. */
  tasks: readonly Task[];
  me: string;
  /** Picked with "+ Thêm việc" this period, in the order picked. */
  added: readonly string[];
  /** Rows with no hours the person closed with ×. */
  dismissed: readonly string[];
  /** Pinned projects, in the order they were pinned. */
  pinned: readonly string[];
  /** Projects brought in from "Dự án khác" this period. */
  extraProjects?: readonly string[];
  /** Projects the person hid. One comes back on its own once something is logged or picked in it, or it is pinned. */
  hiddenProjects?: readonly string[];
  /** What the person opened (true) or folded (false). */
  openOverride?: Readonly<Record<string, boolean>>;
  /** Projects whose "+n việc khác" was opened. */
  showAll?: readonly string[];
  today: string;
  calendar?: WorkCalendar;
  /** The order rows were first drawn in this period (stableOrder). */
  rowOrder?: readonly string[];
  /** The order the unpinned projects were first drawn in this period. */
  projectOrder?: readonly string[];
  limit?: number;
}

const NATURAL = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** Working days after `from` up to and including `to`; 0 when `from` is `to` or later. */
export function workdaysBetween(from: string, to: string, calendar?: WorkCalendar): number {
  if (from >= to) return 0;
  let n = 0;
  const d = new Date(from + "T00:00:00Z");
  const end = Date.parse(to + "T00:00:00Z");
  for (d.setUTCDate(d.getUTCDate() + 1); d.getTime() <= end && n < 400; d.setUTCDate(d.getUTCDate() + 1)) {
    if (dayKind(d.toISOString().slice(0, 10), calendar) === "work") n++;
  }
  return n;
}

interface Candidate {
  key: string;
  summary: string;
  issueType: string;
  /** 0 logged in period, 1 picked, 2 logged before, 3 assigned in progress, 4 assigned. */
  tier: number;
  /** Order inside its tier. */
  rank: number;
  lastDate: string;
}

export function layoutClockwork(input: LayoutInput): { groups: ProjectGroup[]; rowOrder: string[]; projectOrder: string[] } {
  const limit = input.limit ?? ROW_LIMIT;
  const byTask = new Map(input.tasks.map((t) => [t.id, t]));
  const dismissed = new Set(input.dismissed);
  const pinned = input.pinned;
  const showAll = new Set(input.showAll ?? []);

  // Every task that could be a row, at its best tier.
  const cands = new Map<string, Candidate>();
  const offer = (c: Candidate) => {
    const cur = cands.get(c.key);
    if (!cur || c.tier < cur.tier) cands.set(c.key, cur ? { ...c, summary: c.summary || cur.summary, issueType: c.issueType || cur.issueType } : c);
  };
  const mine = new Map<string, WorklogEntry[]>();
  for (const e of input.entries) {
    if (!e.mine) continue;
    mine.set(e.issueKey, [...(mine.get(e.issueKey) ?? []), e]);
  }
  const lastIn = (list: readonly WorklogEntry[]) => list.reduce((m, e) => (e.date > m ? e.date : m), "");
  [...mine.entries()]
    .sort(([ka, a], [kb, b]) => lastIn(b).localeCompare(lastIn(a)) || NATURAL(ka, kb))
    .forEach(([key, list], i) => offer({ key, summary: list[0].summary, issueType: list[0].issueType, tier: 0, rank: i, lastDate: lastIn(list) }));
  const work = new Map(input.openWork.map((w) => [w.key, w]));
  input.added.forEach((key, i) => {
    const t = byTask.get(key);
    const w = work.get(key);
    offer({ key, summary: t?.summary ?? w?.summary ?? "", issueType: t?.issueType ?? w?.issueType ?? "", tier: 1, rank: i, lastDate: "" });
  });
  input.history.forEach((h, i) => offer({ key: h.key, summary: h.summary, issueType: h.issueType, tier: 2, rank: i, lastDate: h.lastDate }));
  // Assigned: my open work from the server, plus the tab's plan in case that list was cut short.
  const assigned: Array<{ key: string; summary: string; issueType: string; inProgress: boolean }> = [...input.openWork.map((w) => ({ ...w, inProgress: !!w.inProgress }))];
  for (const t of input.tasks) {
    if (t.assigneeAccountId === input.me && t.statusCategory !== "done" && !work.has(t.id)) {
      assigned.push({ key: t.id, summary: t.summary, issueType: t.issueType, inProgress: t.statusCategory === "indeterminate" });
    }
  }
  assigned.forEach((w, i) => offer({ key: w.key, summary: w.summary, issueType: w.issueType, tier: w.inProgress ? 3 : 4, rank: i, lastDate: "" }));

  // Rows, per project.
  const perProject = new Map<string, TaskRow[]>();
  const tierOf = new Map<string, number>();
  const sorted = [...cands.values()].sort((a, b) => a.tier - b.tier || a.rank - b.rank);
  for (const c of sorted) {
    const list = mine.get(c.key) ?? [];
    const { cells, total } = cellsOf(list);
    if (dismissed.has(c.key) && total === 0) continue;
    const t = byTask.get(c.key) ?? null;
    const row: TaskRow = {
      key: c.key,
      summary: t?.summary ?? (c.summary || c.key),
      issueType: t?.issueType ?? c.issueType,
      task: t,
      kind: c.tier === 0 ? "logged" : c.tier === 1 ? "added" : "suggested",
      project: projectOfKey(c.key),
      cells,
      total,
    };
    tierOf.set(c.key, c.tier);
    perProject.set(row.project, [...(perProject.get(row.project) ?? []), row]);
  }

  // Facts per project, for ordering and opening.
  const lastLog = new Map<string, string>();
  const hours = new Map<string, number>();
  const note = (key: string, date: string, h: number) => {
    const p = projectOfKey(key);
    if (date > (lastLog.get(p) ?? "")) lastLog.set(p, date);
    hours.set(p, (hours.get(p) ?? 0) + h);
  };
  for (const e of input.entries) if (e.mine) note(e.issueKey, e.date, e.hours);
  for (const h of input.history) note(h.key, h.lastDate, h.hours);
  const inProgress = new Map<string, number>();
  for (const w of assigned) if (w.inProgress) inProgress.set(projectOfKey(w.key), (inProgress.get(projectOfKey(w.key)) ?? 0) + 1);

  const extra = input.extraProjects ?? [];
  const hiddenSet = new Set(input.hiddenProjects ?? []);
  const active = (p: string) => (perProject.get(p) ?? []).some((r) => (tierOf.get(r.key) ?? 9) <= 1);
  const shown = new Set<string>([...perProject.keys(), ...pinned, ...extra].filter((p) => !hiddenSet.has(p) || pinned.includes(p) || active(p)));
  const natural = [...shown]
    .filter((p) => !pinned.includes(p))
    .sort(
      (a, b) =>
        (lastLog.get(b) ?? "").localeCompare(lastLog.get(a) ?? "") ||
        (hours.get(b) ?? 0) - (hours.get(a) ?? 0) ||
        (inProgress.get(b) ?? 0) - (inProgress.get(a) ?? 0) ||
        (perProject.get(b)?.length ?? 0) - (perProject.get(a)?.length ?? 0) ||
        NATURAL(a, b)
    );
  const projectOrder = stableOrder(input.projectOrder ?? [], natural);
  const order = [...pinned.filter((p) => shown.has(p)), ...projectOrder];

  const rowPos = new Map((input.rowOrder ?? []).map((k, i) => [k, i]));
  const drawnKeys: string[] = [];
  const groups = order.map((project): ProjectGroup => {
    const all = perProject.get(project) ?? [];
    const always = all.filter((r) => (tierOf.get(r.key) ?? 9) <= 1);
    const rest = all.filter((r) => (tierOf.get(r.key) ?? 9) > 1);
    // A row already on the page stays (one that just got its first hours must not push the last one off);
    // the room left is filled in rank order.
    const kept = rest.filter((r) => rowPos.has(r.key));
    const fresh = rest.filter((r) => !rowPos.has(r.key));
    const room = showAll.has(project) ? fresh.length : Math.max(0, limit - always.length - kept.length);
    // Keep the place a row was first drawn in; a row new to the page goes after, in rank order.
    const drawn = [...always, ...kept, ...fresh.slice(0, room)]
      .map((r, i) => ({ r, i }))
      .sort((a, b) => (rowPos.get(a.r.key) ?? Infinity) - (rowPos.get(b.r.key) ?? Infinity) || a.i - b.i)
      .map(({ r }) => r);
    const last = lastLog.get(project) ?? "";
    const recent = !!last && (last >= input.today || workdaysBetween(last, input.today, input.calendar) <= RECENT_WORKDAYS);
    const isPinned = pinned.includes(project);
    const hot = isPinned || always.length > 0 || recent || (inProgress.get(project) ?? 0) > 0 || extra.includes(project);
    const open = input.openOverride?.[project] ?? hot;
    const dayTotals = new Map<string, number>();
    for (const r of all) for (const [d, c] of r.cells) dayTotals.set(d, roundHours((dayTotals.get(d) ?? 0) + c.hours));
    if (open) drawnKeys.push(...drawn.map((r) => r.key));
    return {
      project,
      pinned: isPinned,
      open,
      rows: drawn,
      more: all.length - drawn.length,
      expanded: showAll.has(project) && drawn.length > Math.max(limit, always.length),
      base: [...always, ...rest.slice(0, Math.max(0, limit - always.length))].map((r) => r.key),
      hideable: always.length === 0,
      count: all.length,
      total: roundHours(all.reduce((s, r) => s + r.total, 0)),
      dayTotals,
    };
  });
  return { groups, rowOrder: stableOrder(input.rowOrder ?? [], drawnKeys), projectOrder };
}

/** Pinning moves a project to the end of the pinned ones; unpinning puts it back among the rest. */
export function togglePin(pinned: readonly string[], project: string): string[] {
  return pinned.includes(project) ? pinned.filter((p) => p !== project) : [...pinned, project];
}

/** Projects I can browse that the page does not show, for "Dự án khác", by name. */
export function otherProjects(all: ReadonlyArray<{ key: string; name: string }>, shown: Iterable<string>): Array<{ key: string; name: string }> {
  const have = new Set(shown);
  return all.filter((p) => !have.has(p.key)).sort((a, b) => a.name.localeCompare(b.name, "vi"));
}
