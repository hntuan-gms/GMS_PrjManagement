import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "../toast";
import { orderTasksForLogging, parseHours } from "../parseHours";
import { expectation, isAway } from "../timesheetDays";
import {
  buildMyRows,
  cellEntries,
  dayState,
  fmtHours,
  myDayTotals,
  stableOrder,
  type Cell,
  type TaskRow,
} from "../timesheetModel";
import type { Task, Timesheet, TimesheetPerson } from "../types";
import type { TimesheetOps } from "../useTimesheet";
import { useWorkCalendar } from "./workCalendarContext";
import { dayLabel } from "../workCalendar";
import { dayClass } from "../timesheetDays";
import Metric, { MetricRow } from "./Metric";
import StatusGlyph from "./StatusGlyph";
import TaskPicker from "./TaskPicker";
import { CellList, DayHead } from "./TimesheetParts";
import { WEEKDAYS_LONG, dm, weekday } from "../timesheetRange";

const NO_KEYS: string[] = [];

/**
 * "Của tôi": my hours as task × day, every cell a field. Type 4, 1,5 or 2h30 and press Enter: it is logged in Jira
 * under your name and the next row's cell is under the cursor, like a spreadsheet. A task you have not logged on yet
 * is already a row when it is yours and open, so a normal day is typing three numbers. Clearing a cell removes the
 * worklog (with "Hoàn tác"); a cell holding several worklogs opens its list.
 */
export default function TimesheetMine({
  sheet,
  days,
  month,
  today,
  me,
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

  // Tasks picked with "+ Thêm việc" this session, the ones dropped again, and the order rows were first shown in:
  // a row keeps its place when it gets its first hours instead of jumping up under the cursor.
  const [added, setAdded] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [order, setOrder] = useState<{ range: string; keys: string[] }>({ range: rangeKey, keys: [] });
  const [forRange, setForRange] = useState(rangeKey);
  if (forRange !== rangeKey) {
    // A new period starts without last period's hand-picked rows.
    setForRange(rangeKey);
    setAdded([]);
    setDismissed([]);
  }
  const placed = useMemo(() => (order.range === rangeKey ? order.keys : NO_KEYS), [order, rangeKey]);
  const rows = useMemo(
    () => buildMyRows({ entries: sheet.entries, tasks, me, added, order: placed }).filter((r) => !(dismissed.includes(r.key) && r.total === 0)),
    [sheet.entries, tasks, me, added, placed, dismissed]
  );
  const nextOrder = stableOrder(placed, rows.map((r) => r.key));
  if (order.range !== rangeKey || nextOrder.length !== order.keys.length || nextOrder.some((k, i) => k !== order.keys[i])) {
    setOrder({ range: rangeKey, keys: nextOrder });
  }

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
  const [pick, setPick] = useState<DOMRect | null>(null);
  // A row just picked takes the cursor on today's cell as soon as it is drawn.
  const landOn = useRef<string | null>(null);
  const landDate = days.includes(today) ? today : days[0];
  useEffect(() => {
    if (landOn.current && focusCell(landOn.current, landDate)) landOn.current = null;
  }, [rows.length, landDate]);

  const loggable = useMemo(() => orderTasksForLogging(tasks, me, sheet.entries), [tasks, me, sheet.entries]);
  const shownKeys = useMemo(() => rows.map((r) => r.key), [rows]);

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
        <table className={`ts-grid ts-mine${month ? " is-month" : ""}`} data-ts="mine">
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
            {rows.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="ts-empty-row">
                  Chưa có việc nào
                </td>
              </tr>
            )}
            {rows.map((row, r) => (
              <tr key={row.key} className={`ts-row is-${row.kind}`}>
                <th className="ts-task" scope="row">
                  <div className="ts-task-in">
                    {row.task ? <StatusGlyph category={row.task.statusCategory} name={row.task.statusName} percent={row.task.percentComplete} /> : <span className="ts-glyph-none" aria-hidden="true" />}
                    <button type="button" className="ts-key" onClick={() => row.task && onOpenTask(row.task)} disabled={!row.task} title={row.task ? "Mở việc" : "Việc ngoài dự án này"}>
                      {row.key}
                    </button>
                    <span className="ts-sum" title={row.summary}>{row.summary}</span>
                    {row.kind === "suggested" && <span className="ts-hint" title="Việc của bạn đang mở">gợi ý</span>}
                    {row.kind !== "logged" && row.total === 0 && (
                      <button type="button" className="ts-dismiss" aria-label={`Bỏ dòng ${row.key}`} title="Bỏ dòng này" onClick={() => setDismissed((x) => [...x, row.key])}>
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
            ))}
            <tr className="ts-add-row">
              <th className="ts-task" scope="row">
                <button type="button" className="ts-add" onClick={(e) => setPick(e.currentTarget.getBoundingClientRect())}>
                  + Thêm việc
                </button>
              </th>
              <td colSpan={colSpan - 1} />
            </tr>
          </tbody>
          <tfoot>
            <tr>
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
          anchor={pick}
          tasks={loggable}
          exclude={shownKeys}
          placeholder="Thêm việc vào bảng giờ"
          onPick={(t) => {
            setPick(null);
            setDismissed((x) => x.filter((k) => k !== t.id));
            setAdded((a) => (a.includes(t.id) ? a : [...a, t.id]));
            if (!focusCell(t.id, landDate)) landOn.current = t.id;
          }}
          onClose={() => setPick(null)}
        />
      )}
    </>
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
