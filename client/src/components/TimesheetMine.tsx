import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { api } from "../api";
import { layoutClockwork, otherProjects, togglePin, type ProjectGroup } from "../clockworkLayout";
import { toast } from "../toast";
import { buildTaskLink } from "../deepLink";
import { parseHours } from "../parseHours";
import { expectation, isAway } from "../timesheetDays";
import { cellEntries, dayState, fmtHours, myDayTotals, projectOfKey, type Cell, type OpenWork, type TaskRow } from "../timesheetModel";
import { remoteAsTask } from "../taskPickerModel";
import type { Task, Timesheet, TimesheetPerson } from "../types";
import type { TimesheetOps } from "../useTimesheet";
import { useWorkCalendar } from "./workCalendarContext";
import { dayLabel } from "../workCalendar";
import { dayClass } from "../timesheetDays";
import CellPicker from "./CellPicker";
import { Icon } from "./Icons";
import Metric, { MetricRow } from "./Metric";
import StatusGlyph from "./StatusGlyph";
import TaskPicker from "./TaskPicker";
import { CellList, DayHead } from "./TimesheetParts";
import { WEEKDAYS_LONG, dm, weekday } from "../timesheetRange";

const NO_KEYS: string[] = [];

/** A motion token from tokens.css, in ms (a reduced-motion setting shortens them there). */
function cssMs(name: string, fallback: number): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? (v.endsWith("ms") ? n : n * 1000) : fallback;
}
function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Per person, per site, in this browser: which projects are pinned, and which were opened or folded by hand. */
function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window: not remembered */
  }
}

/**
 * "Của tôi": my hours as task × day on every project, every cell a field. Type 4, 1,5 or 2h30 and press Enter: it
 * is logged in Jira under your name and the next row's cell is under the cursor, like a spreadsheet.
 *
 * Rows are gathered by project. Which projects come first, which are open and which tasks are rows is decided in
 * clockworkLayout.ts (from a backtest on real worklogs): what I logged lately leads, a pin puts a project on top,
 * and each project has its own "+ Thêm việc", because new work almost always lands in a project already in use.
 */
export default function TimesheetMine({
  sheet,
  days,
  month,
  today,
  me,
  prefsKey,
  tasks,
  ops,
  focusDate,
  onFocusDone,
  onOpenTask,
  rangeKey,
}: {
  sheet: Timesheet;
  days: string[];
  month: boolean;
  today: string;
  me: string;
  /** Site + account: pins and folds are kept per person. */
  prefsKey: string;
  tasks: Task[];
  ops: TimesheetOps;
  /** A day another screen asked to land on (a click on your own cell in "Cả nhóm"). */
  focusDate: string | null;
  onFocusDone: () => void;
  onOpenTask: (task: Task) => void;
  /** Changes with the period: rows are laid out afresh for each. */
  rangeKey: string;
}) {
  const calendar = useWorkCalendar();
  const person: TimesheetPerson = useMemo(
    () =>
      sheet.people.find((p) => p.accountId === me) ?? { accountId: me, displayName: "", avatarUrl: null, capacityHoursPerDay: 8, absences: [], outsider: false },
    [sheet.people, me]
  );

  // Kept in this browser for the person: pins, and projects opened or folded by hand.
  const pinKey = `gms.cw.pins.${prefsKey}`;
  const openKey = `gms.cw.open.${prefsKey}`;
  const [pinned, setPinned] = useState<string[]>(() => readPref(pinKey, [] as string[]));
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>(() => readPref(openKey, {} as Record<string, boolean>));
  const setOpen = (project: string, open: boolean) =>
    setOpenOverride((cur) => {
      const next = { ...cur, [project]: open };
      writePref(openKey, next);
      return next;
    });
  const pin = (project: string) =>
    setPinned((cur) => {
      const next = togglePin(cur, project);
      writePref(pinKey, next);
      return next;
    });
  // Hidden projects, and rows closed with ×: kept too, or a dead project's tasks would be back next week.
  const hiddenKey = `gms.cw.hidden.${prefsKey}`;
  const closedKey = `gms.cw.closed.${prefsKey}`;
  const [hiddenProjects, setHiddenProjects] = useState<string[]>(() => readPref(hiddenKey, [] as string[]));
  const [dismissed, setDismissed] = useState<string[]>(() => readPref(closedKey, [] as string[]));
  const keepHidden = (f: (cur: string[]) => string[]) =>
    setHiddenProjects((cur) => {
      const next = f(cur);
      writePref(hiddenKey, next);
      return next;
    });
  const keepClosed = (f: (cur: string[]) => string[]) =>
    setDismissed((cur) => {
      const next = f(cur).slice(-500);
      writePref(closedKey, next);
      return next;
    });
  const hideProject = (project: string) => {
    keepHidden((x) => (x.includes(project) ? x : [...x, project]));
    setExtraProjects((x) => x.filter((p) => p !== project));
    toast(`Đã ẩn ${project}. Mở lại từ "Dự án khác".`, { action: { label: "Hoàn tác", run: () => keepHidden((x) => x.filter((p) => p !== project)) } });
  };
  const closeRow = (key: string) => {
    keepClosed((x) => (x.includes(key) ? x : [...x, key]));
    toast(`Đã ẩn ${key}`, { action: { label: "Hoàn tác", run: () => keepClosed((x) => x.filter((k) => k !== key)) } });
  };

  // This period only: rows picked by hand, projects brought in, "+n việc khác" opened, and the order rows and
  // projects were first drawn in (so nothing moves while typing).
  const [added, setAdded] = useState<string[]>([]);
  const [extraProjects, setExtraProjects] = useState<string[]>([]);
  const [showAll, setShowAll] = useState<string[]>([]);
  const [order, setOrder] = useState<{ range: string; rows: string[]; projects: string[] }>({ range: rangeKey, rows: [], projects: [] });
  const [forRange, setForRange] = useState(rangeKey);
  if (forRange !== rangeKey) {
    setForRange(rangeKey);
    setAdded([]);
    setShowAll([]);
  }
  const placedRows = order.range === rangeKey ? order.rows : NO_KEYS;
  const placedProjects = order.range === rangeKey ? order.projects : NO_KEYS;

  // Opening and folding move the rows below smoothly instead of jumping (FLIP: each row is drawn where it was,
  // then slides to where it is now; new rows fade in one after another). Only after a click that asked for it:
  // typing hours or a fresh read never animates. Rows that leave fade out first, then the rest close the gap.
  const table = useRef<HTMLTableElement>(null);
  const animateNext = useRef(false);
  const lastTops = useRef<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    const el = table.current;
    if (!el) return;
    const trs = [...el.querySelectorAll<HTMLTableRowElement>("tr[data-flip]")];
    const tops = new Map(trs.map((tr) => [tr.dataset.flip!, tr.offsetTop]));
    if (animateNext.current && !reducedMotion()) {
      const move = cssMs("--d-3", 220);
      const easeMove = cssVar("--e-move", "ease-out");
      const easeOut = cssVar("--e-out", "ease-out");
      let n = 0;
      for (const tr of trs) {
        const before = lastTops.current.get(tr.dataset.flip!);
        const now = tops.get(tr.dataset.flip!)!;
        if (before === undefined) {
          tr.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], {
            duration: move,
            delay: Math.min(n++, 12) * 22,
            easing: easeOut,
            fill: "backwards",
          });
        } else if (Math.abs(before - now) > 0.5) {
          tr.animate([{ transform: `translateY(${before - now}px)` }, { transform: "none" }], { duration: move + 40, easing: easeMove });
        }
      }
    }
    animateNext.current = false;
    lastTops.current = tops;
  });
  /** A change that opens rows: the layout effect animates it. */
  const opening = (change: () => void) => {
    animateNext.current = true;
    change();
  };
  /** Fade out the rows that are about to go, then make the change; the rows below then slide up. */
  const closing = (leaving: string[], change: () => void) => {
    const els = leaving
      .map((k) => table.current?.querySelector<HTMLElement>(`tr[data-flip="${CSS.escape(k)}"]`))
      .filter((e): e is HTMLElement => !!e);
    if (!els.length || reducedMotion()) {
      animateNext.current = true;
      change();
      return;
    }
    const out = cssMs("--d-2", 150);
    const anims = els.map((e) => e.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(-4px)" }], { duration: out, easing: cssVar("--e-in", "ease-in"), fill: "forwards" }));
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      animateNext.current = true;
      flushSync(change);
      // A row that stays after all must not be left invisible.
      for (const a of anims) a.cancel();
    };
    Promise.all(anims.map((a) => a.finished)).then(finish, finish);
    setTimeout(finish, out + 80);
  };
  const toggleGroup = (group: ProjectGroup) => {
    if (group.open) closing([...group.rows.map((r) => `row:${r.key}`), `add:${group.project}`], () => setOpen(group.project, false));
    else opening(() => setOpen(group.project, true));
  };
  const showMore = (project: string) => opening(() => setShowAll((x) => [...x, project]));
  /** "Thu gọn": back to the first rows. The project's rows are laid out again, or those drawn would all stay. */
  const showLess = (group: ProjectGroup) => {
    const keep = new Set(group.base);
    closing(
      group.rows.filter((r) => !keep.has(r.key)).map((r) => `row:${r.key}`),
      () => {
        setShowAll((x) => x.filter((p) => p !== group.project));
        setOrder((o) => ({ ...o, rows: o.rows.filter((k) => projectOfKey(k) !== group.project) }));
      }
    );
  };
  /** A task of this project opens in the panel; one of another project in a new tab, on its own project. */
  const openRow = (row: TaskRow) => {
    if (row.task) onOpenTask(row.task);
    else window.open(buildTaskLink(window.location.origin, row.key), "_blank", "noopener");
  };

  // What was picked from a search: in neither the plan nor my open work, so the row needs its name from here.
  const [picked, setPicked] = useState<ReadonlyMap<string, OpenWork>>(new Map());
  const openWork = useMemo(() => {
    const have = new Set((sheet.openWork ?? []).map((w) => w.key));
    return [...(sheet.openWork ?? []), ...[...picked.values()].filter((w) => !have.has(w.key))];
  }, [sheet.openWork, picked]);


  const layout = useMemo(
    () =>
      layoutClockwork({
        entries: sheet.entries,
        history: sheet.history ?? [],
        openWork,
        tasks,
        me,
        added,
        dismissed,
        pinned,
        extraProjects,
        hiddenProjects,
        openOverride,
        showAll,
        today,
        calendar,
        rowOrder: placedRows,
        projectOrder: placedProjects,
      }),
    [sheet.entries, sheet.history, openWork, tasks, me, added, dismissed, pinned, extraProjects, hiddenProjects, openOverride, showAll, today, calendar, placedRows, placedProjects]
  );
  const { groups } = layout;
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i]);
  if (order.range !== rangeKey || !same(order.rows, layout.rowOrder) || !same(order.projects, layout.projectOrder)) {
    setOrder({ range: rangeKey, rows: layout.rowOrder, projects: layout.projectOrder });
  }
  // The rows drawn, in order: what the arrow keys walk.
  const rows = useMemo(() => groups.flatMap((g) => (g.open ? g.rows : [])), [groups]);
  const projectName = useMemo(() => {
    const m = new Map((sheet.allProjects ?? []).map((p) => [p.key, p.name]));
    for (const p of sheet.projects ?? []) m.set(p.key, p.name);
    return m;
  }, [sheet.allProjects, sheet.projects]);
  const others = useMemo(() => otherProjects(sheet.allProjects ?? [], groups.map((g) => g.project)), [sheet.allProjects, groups]);

  const totals = useMemo(() => myDayTotals(sheet.entries), [sheet.entries]);
  const hoursOn = (d: string) => totals.get(d) ?? 0;
  const { expected, missing } = useMemo(() => expectation(person, days, today, (d) => totals.get(d) ?? 0, calendar), [person, days, today, totals, calendar]);
  const overDays = days.filter((d) => dayState(person, d, hoursOn(d), today, calendar) === "over");
  const logged = days.reduce((s, d) => s + hoursOn(d), 0);

  const wrap = useRef<HTMLDivElement>(null);
  const focusCell = (key: string | null, date: string) => {
    const sel = key ? `[data-key="${key}"][data-date="${date}"]` : `[data-date="${date}"]`;
    const el = wrap.current?.querySelector<HTMLElement>(`input${sel}, button${sel}`);
    el?.focus();
    el?.scrollIntoView({ block: "nearest", inline: "center" });
    return !!el;
  };
  useEffect(() => {
    if (focusDate && focusCell(null, focusDate)) onFocusDone();
  }, [focusDate, onFocusDone, rows.length]);

  const [list, setList] = useState<{ rect: DOMRect; row: TaskRow; date: string } | null>(null);
  // A project's "+ Thêm việc": the picker opens on what is likely next there, read from Jira as it opens.
  const [pick, setPick] = useState<{ rect: DOMRect; project: string; list: Task[] | null } | null>(null);
  const [pickProject, setPickProject] = useState<DOMRect | null>(null);
  // A row just picked takes the cursor on today's cell as soon as it is drawn.
  const landOn = useRef<string | null>(null);
  const landDate = days.includes(today) ? today : days[0];
  useEffect(() => {
    if (landOn.current && focusCell(landOn.current, landDate)) landOn.current = null;
  }, [rows.length, landDate]);

  /** What a project's picker offers before anything is typed: what I know of it here, then what Jira adds. */
  function openPicker(rect: DOMRect, project: string) {
    const inProject = (key: string) => projectOfKey(key) === project;
    const local: Task[] = [
      ...tasks.filter((t) => inProject(t.id)),
      ...(sheet.history ?? []).filter((h) => inProject(h.key)).map((h) => remoteAsTask({ key: h.key, summary: h.summary, issueType: h.issueType })),
      ...openWork.filter((w) => inProject(w.key)).map((w) => remoteAsTask(w)),
    ];
    const known = local.filter((t, i) => local.findIndex((x) => x.id === t.id) === i);
    setPick({ rect, project, list: known.length ? known : null });
    api
      .searchClockworkIssues("", project)
      .then((found) => {
        // Merged here, not inside the state update: React may run an updater twice.
        const have = new Set(known.map((t) => t.id));
        const list = [...known, ...found.filter((r) => !have.has(r.key)).map(remoteAsTask)];
        setPick((p) => (p && p.project === project ? { ...p, list } : p));
      })
      .catch(() => setPick((p) => (p && p.project === project ? { ...p, list: known } : p)));
  }
  const pickFor = pick?.project ?? null;
  const remote = useMemo(() => (pickFor ? (q: string) => api.searchClockworkIssues(q, pickFor) : undefined), [pickFor]);

  /** Move between cells like a spreadsheet: by row and column index. */
  function move(from: HTMLElement, dr: number, dc: number): boolean {
    const r = Number(from.dataset.r);
    const c = Number(from.dataset.c);
    const el = wrap.current?.querySelector<HTMLElement>(`[data-r="${r + dr}"][data-c="${c + dc}"]`);
    if (!el) return false;
    el.focus();
    if (el instanceof HTMLInputElement) el.select();
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    return true;
  }

  const missingText = missing.map(dm).join(", ");
  const colSpan = days.length + 2;
  return (
    <>
      <MetricRow className="ts-tiles">
        <Metric value={`${fmtHours(logged)}h`} label="Bạn đã ghi" sub={expected > 0 ? `/ ${fmtHours(expected)}h kỳ vọng` : undefined} />
        {missing.length > 0 && (
          <Metric
            value={missing.length}
            label="ngày chưa ghi"
            tone="warn"
            title={`Chưa ghi: ${missingText}`}
            onClick={() => focusCell(null, missing[0])}
          />
        )}
        {overDays.length > 0 && <Metric value={overDays.length} label="ngày vượt công suất" tone="serious" />}
      </MetricRow>

      <div className="ts-grid-scroll" ref={wrap}>
        <table ref={table} className={`ts-grid ts-mine${month ? " is-month" : ""}`} data-ts="mine">
          <thead>
            <tr>
              <th className="ts-task-h" scope="col">Việc</th>
              {days.map((d) => (
                <DayHead key={d} d={d} today={today} month={month} calendar={calendar} />
              ))}
              <th className="ts-total-h" scope="col">Tổng</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="ts-empty-row">
                  Chưa có việc nào
                </td>
              </tr>
            )}
            {groups.map((group) => (
              <Fragment key={group.project}>
                <GroupRow
                  group={group}
                  name={projectName.get(group.project)}
                  days={days}
                  today={today}
                  onToggle={() => toggleGroup(group)}
                  onPin={() => pin(group.project)}
                  onHide={() => hideProject(group.project)}
                />
                {group.open &&
                  group.rows.map((row) => {
                    const r = rows.indexOf(row);
                    return (
                      <tr key={row.key} className={`ts-row is-${row.kind}${row.total === 0 ? " is-empty" : ""}`} data-project={group.project} data-flip={`row:${row.key}`}>
                        <th className="ts-task" scope="row">
                          <div className="ts-task-in">
                            {row.task ? (
                              <StatusGlyph category={row.task.statusCategory} name={row.task.statusName} percent={row.task.percentComplete} />
                            ) : row.status ? (
                              <StatusGlyph category={row.status} title={row.status === "done" ? "Đã xong" : row.status === "indeterminate" ? "Đang làm" : "Chưa làm"} />
                            ) : (
                              <span className="ts-glyph-none" aria-hidden="true" />
                            )}
                            <button
                              type="button"
                              className="ts-open"
                              onClick={() => openRow(row)}
                              title={row.task ? `Mở ${row.key}: ${row.summary}` : `Mở ${row.key} trong tab mới (dự án ${row.project})`}
                            >
                              <span className="ts-key">{row.key}</span>
                              <span className="ts-sum">{row.summary}</span>
                              {!row.task && <Icon name="external" size={12} className="ts-open-ext" />}
                            </button>
                            {row.kind !== "logged" && row.total === 0 && (
                              <button type="button" className="ts-dismiss" aria-label={`Ẩn dòng ${row.key}`} title="Ẩn dòng này" onClick={() => closeRow(row.key)}>
                                ×
                              </button>
                            )}
                          </div>
                        </th>
                        {days.map((d, c) => (
                          <HourCell
                            key={d}
                            row={row}
                            date={d}
                            r={r}
                            c={c}
                            cell={row.cells.get(d)}
                            away={isAway(person, d)}
                            capacity={person.capacityHoursPerDay}
                            today={today}
                            ops={ops}
                            move={move}
                            openList={(rect) => setList({ rect, row, date: d })}
                          />
                        ))}
                        <td className="ts-total"><b>{row.total > 0 ? fmtHours(row.total) : ""}</b></td>
                      </tr>
                    );
                  })}
                {group.open && (
                  <tr className="ts-add-row" data-project={group.project} data-flip={`add:${group.project}`}>
                    <th className="ts-task" scope="row">
                      <div className="ts-add-in">
                        <button type="button" className="ts-add" onClick={(e) => openPicker(e.currentTarget.getBoundingClientRect(), group.project)}>
                          <Icon name="plus" size={14} />
                          Thêm việc
                        </button>
                        {(group.more > 0 || group.expanded) && (
                          <button
                            type="button"
                            className="ts-more-rows"
                            aria-expanded={group.more === 0}
                            onClick={() => (group.more > 0 ? showMore(group.project) : showLess(group))}
                          >
                            {group.more > 0 ? `Hiện thêm ${group.more} việc` : "Thu gọn"}
                            <Icon name="chevronDown" size={14} />
                          </button>
                        )}
                      </div>
                    </th>
                    <td colSpan={colSpan - 1} />
                  </tr>
                )}
              </Fragment>
            ))}
            {others.length > 0 && (
              <tr className="ts-others-row" data-flip="others">
                <th className="ts-task" scope="row">
                  <button
                    type="button"
                    className="ts-others"
                    title={`Chọn trong ${others.length} dự án bạn xem được nhưng chưa có ở đây`}
                    onClick={(e) => setPickProject(e.currentTarget.getBoundingClientRect())}
                  >
                    <Icon name="plus" size={14} />
                    Thêm dự án
                  </button>
                </th>
                <td colSpan={colSpan - 1} />
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr data-flip="foot">
              <th className="ts-task" scope="row">Cả ngày</th>
              {days.map((d) => {
                const h = hoursOn(d);
                const st = dayState(person, d, h, today, calendar);
                const worked = st === "missing" || st === "open" || st === "short" || st === "full" || st === "over";
                const hint =
                  st === "missing" ? "Chưa ghi giờ"
                  : st === "short" ? `Còn thiếu ${fmtHours(person.capacityHoursPerDay - h)}h`
                  : st === "over" ? `Vượt công suất ${fmtHours(h - person.capacityHoursPerDay)}h`
                  : st === "full" ? "Đủ ngày"
                  : st === "extra" && isAway(person, d) ? "Ghi giờ trong ngày nghỉ phép"
                  : dayLabel(d, calendar) || undefined;
                return (
                  <td key={d} className={`ts-foot st-${st} ${dayClass(d, calendar)}${d === today ? " is-today" : ""}`} title={hint}>
                    {(h > 0 || worked) && (
                      <>
                        {st === "over" && <span aria-hidden="true">▲ </span>}
                        <b>{fmtHours(h)}</b>
                        {worked && <small>/{fmtHours(person.capacityHoursPerDay)}</small>}
                      </>
                    )}
                  </td>
                );
              })}
              <td className="ts-total"><b>{fmtHours(logged)}h</b></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {list && (
        <CellList
          anchor={list.rect}
          issueKey={list.row.key}
          summary={list.row.summary}
          issueType={list.row.issueType}
          date={list.date}
          entries={cellEntries(sheet.entries, list.row.key, list.date)}
          ops={ops}
          onClose={() => setList(null)}
        />
      )}
      {pick && (
        <TaskPicker
          anchor={pick.rect}
          tasks={pick.list}
          exclude={groups.find((g) => g.project === pick.project)?.rows.map((r) => r.key) ?? NO_KEYS}
          remote={remote}
          placeholder={`Thêm việc vào ${pick.project}`}
          onPick={(t) => {
            setPick(null);
            // Not in the plan and not mine: keep what the search told us so the row has a name.
            if (!tasks.some((x) => x.id === t.id) && !(sheet.openWork ?? []).some((w) => w.key === t.id)) {
              setPicked((m) => new Map(m).set(t.id, { key: t.id, summary: t.summary, issueType: t.issueType, inProgress: t.statusCategory === "indeterminate" }));
            }
            if (dismissed.includes(t.id)) keepClosed((x) => x.filter((k) => k !== t.id));
            setAdded((a) => (a.includes(t.id) ? a : [...a, t.id]));
            const project = projectOfKey(t.id);
            if (openOverride[project] === false) setOpen(project, true);
            if (!focusCell(t.id, landDate)) landOn.current = t.id;
          }}
          onClose={() => setPick(null)}
        />
      )}
      {pickProject && (
        <CellPicker
          anchor={pickProject}
          items={others.map((p) => ({ id: p.key, label: p.name, lead: <span className="tp-key">{p.key}</span> }))}
          placeholder="Tìm dự án"
          onPick={(it) => {
            setPickProject(null);
            setExtraProjects((x) => (x.includes(it.id) ? x : [...x, it.id]));
            if (hiddenProjects.includes(it.id)) keepHidden((x) => x.filter((p) => p !== it.id));
            if (openOverride[it.id] === false) setOpen(it.id, true);
          }}
          onClose={() => setPickProject(null)}
        />
      )}
    </>
  );
}

/**
 * The line that opens a project's rows. The whole name is the open/fold button; beside it what was logged on each
 * day, the total, and the pin, which is always drawn so it is clear it can be pressed.
 */
function GroupRow({
  group,
  name,
  days,
  today,
  onToggle,
  onPin,
  onHide,
}: {
  group: ProjectGroup;
  name: string | undefined;
  days: string[];
  today: string;
  onToggle: () => void;
  onPin: () => void;
  onHide: () => void;
}) {
  const calendar = useWorkCalendar();
  const label = name ? `${group.project} ${name}` : group.project;
  return (
    <tr className={`ts-group-row${group.open ? " is-open" : ""}${group.pinned ? " is-pinned" : ""}`} data-project={group.project} data-flip={`group:${group.project}`}>
      <th className="ts-task" scope="rowgroup">
        <div className="ts-group-in">
          <button type="button" className="ts-group-toggle" aria-expanded={group.open} title={group.open ? "Thu gọn dự án" : "Mở dự án"} onClick={onToggle}>
            <Icon name="chevronRight" size={14} className="ts-chev" />
            <b>{group.project}</b>
            {name && <span className="ts-group-title">{name}</span>}
            {!group.open && group.count > 0 && <span className="ts-group-count">{group.count} việc</span>}
          </button>
          <button
            type="button"
            className="ts-pin"
            aria-pressed={group.pinned}
            aria-label={group.pinned ? `Bỏ ghim ${label}` : `Ghim ${label} lên đầu`}
            title={group.pinned ? "Bỏ ghim" : "Ghim lên đầu"}
            onClick={onPin}
          >
            <Icon name="pin" size={14} />
          </button>
          {group.hideable && !group.pinned && (
            <button type="button" className="ts-hide" aria-label={`Ẩn ${label}`} title="Ẩn dự án này" onClick={onHide}>
              <Icon name="eyeOff" size={14} />
            </button>
          )}
        </div>
      </th>
      {days.map((d) => {
        const h = group.dayTotals.get(d) ?? 0;
        return (
          <td key={d} className={`ts-group-day ${dayClass(d, calendar)}${d === today ? " is-today" : ""}`}>
            {h > 0 ? fmtHours(h) : ""}
          </td>
        );
      })}
      <td className="ts-total">
        {group.total > 0 && <span className="ts-group-total">{fmtHours(group.total)}</span>}
      </td>
    </tr>
  );
}

/** One field of the grid: hours of one task on one day. */
function HourCell({
  row,
  date,
  r,
  c,
  cell,
  away,
  capacity,
  today,
  ops,
  move,
  openList,
}: {
  row: TaskRow;
  date: string;
  r: number;
  c: number;
  cell: Cell | undefined;
  away: boolean;
  capacity: number;
  today: string;
  ops: TimesheetOps;
  move: (from: HTMLElement, dr: number, dc: number) => boolean;
  openList: (rect: DOMRect) => void;
}) {
  const calendar = useWorkCalendar();
  const hours = cell?.hours ?? 0;
  const entries = cell?.entries ?? [];
  const stored = hours > 0 ? fmtHours(hours) : "";
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const skip = useRef(false);
  const tdRef = useRef<HTMLTableCellElement>(null);
  const shown = draft ?? stored;
  const comments = entries.filter((e) => e.comment);
  const pending = entries.some((e) => e.id.startsWith("tmp-"));

  async function commit(text: string) {
    if (text === stored) {
      setDraft(null);
      setBad(false);
      return;
    }
    const hours = text.trim() ? parseHours(text) : 0;
    if (hours === null) {
      setBad(true);
      toast("Nhập số giờ, ví dụ 4, 1,5 hoặc 2h30", { tone: "error", ms: 3000 });
      return;
    }
    setBad(false);
    // Show what was understood ("2h30" → "2,5") straight away; the write goes on behind it, and a refusal puts the old value back.
    setDraft(hours > 0 ? fmtHours(hours) : "");
    await ops.setCell(row.key, row.summary, row.issueType, date, text);
    setDraft(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    switch (e.key) {
      case "Enter":
        e.preventDefault();
        if (e.shiftKey) {
          if (entries.length && tdRef.current) openList(tdRef.current.getBoundingClientRect());
          return;
        }
        // The next row takes the focus, and the blur commits this one; with nothing below, commit here and stay.
        if (!move(el, 1, 0) && draft !== null && draft !== stored) void commit(draft);
        return;
      case "ArrowDown":
        e.preventDefault();
        move(el, 1, 0);
        return;
      case "ArrowUp":
        e.preventDefault();
        move(el, -1, 0);
        return;
      case "ArrowLeft":
        if (el.selectionStart === 0) {
          e.preventDefault();
          move(el, 0, -1);
        }
        return;
      case "ArrowRight":
        if (el.selectionEnd === el.value.length) {
          e.preventDefault();
          move(el, 0, 1);
        }
        return;
      case "Escape":
        if (draft !== null) {
          // A draft is dropped first; a second Esc is the app's.
          e.stopPropagation();
          skip.current = true;
          setDraft(null);
          setBad(false);
          el.blur();
        }
        return;
    }
  }

  const tip = bad
    ? "Nhập số giờ, ví dụ 4, 1,5 hoặc 2h30"
    : comments.length
      ? comments.map((e) => e.comment).join(" · ")
      : away
        ? "Nghỉ phép"
        : dayLabel(date, calendar) || undefined;
  const cls = `ts-cell ${dayClass(date, calendar)}${away ? " is-away" : ""}${date === today ? " is-today" : ""}${hours > 0 ? " has-hours" : ""}${
    hours > capacity + 1e-9 ? " is-over" : ""
  }${pending ? " is-pending" : ""}`;
  // How much of a day this cell is: the tint is the heat map of the grid, one scale of ink.
  const tint = { ["--p" as string]: Math.min(1, hours / Math.max(capacity, 0.01)) };

  return (
    <td ref={tdRef} className={cls} title={tip} style={tint}>
      {entries.length > 1 ? (
        <button
          type="button"
          className="ts-multi"
          data-key={row.key}
          data-date={date}
          data-r={r}
          data-c={c}
          aria-label={`${row.key} ngày ${dm(date)}: ${entries.length} lần ghi, ${stored} giờ. Mở danh sách`}
          onClick={(e) => openList((e.currentTarget.parentElement ?? e.currentTarget).getBoundingClientRect())}
          onKeyDown={(e) => {
            const step: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
            const to = step[e.key];
            if (!to) return;
            e.preventDefault();
            move(e.currentTarget, to[0], to[1]);
          }}
        >
          {stored}
          <sup>×{entries.length}</sup>
        </button>
      ) : (
        <>
          <input
            className={`ts-in${bad ? " is-bad" : ""}${draft !== null ? " is-draft" : ""}`}
            value={shown}
            data-key={row.key}
            data-date={date}
            data-r={r}
            data-c={c}
            inputMode="decimal"
            autoComplete="off"
            placeholder="+"
            aria-label={`${row.key} ngày ${dm(date)} (${WEEKDAYS_LONG[weekday(date)]})`}
            aria-invalid={bad || undefined}
            onFocus={(e) => {
              setDraft((d) => d ?? stored);
              e.currentTarget.select();
            }}
            onChange={(e) => {
              setDraft(e.target.value);
              setBad(false);
            }}
            onBlur={() => {
              if (skip.current) {
                skip.current = false;
                return;
              }
              if (draft === null) return;
              if (bad) return;
              void commit(draft);
            }}
            onKeyDown={onKeyDown}
          />
          {entries.length === 1 && (
            <button
              type="button"
              className="ts-more"
              tabIndex={-1}
              aria-label="Ghi chú và chi tiết giờ ghi"
              title="Ghi chú và xoá · Shift Enter"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => openList((e.currentTarget.parentElement ?? e.currentTarget).getBoundingClientRect())}
            >
              ⋯
            </button>
          )}
          {comments.length > 0 && <span className="ts-note" aria-hidden="true" />}
        </>
      )}
    </td>
  );
}
