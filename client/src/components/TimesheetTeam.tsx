import { Fragment, useMemo, useState } from "react";
import { roundHours } from "../taskForm";
import { dayClass, isAway } from "../timesheetDays";
import { dayState, fmtHours, isOddCapacity, personRows, type TeamRow } from "../timesheetModel";
import type { Task, Timesheet } from "../types";
import { dayLabel } from "../workCalendar";
import Avatar from "./Avatar";
import { DayHead } from "./TimesheetParts";
import { dm } from "../timesheetRange";
import { useWorkCalendar } from "./workCalendarContext";

/**
 * "Cả nhóm": who logged what, one row per person, read-only (Jira lets nobody log for someone else).
 * The page is built to answer "who is behind?": you first, then whoever owes the most days, the figure that says so
 * at the end of the row rather than a mark in every empty cell. A row opens into that person's own tasks.
 */
export default function TimesheetTeam({
  sheet,
  rows,
  days,
  month,
  today,
  me,
  tasks,
  onOpenTask,
  onEditMine,
}: {
  sheet: Timesheet;
  /** Already filtered and sorted (buildTeamRows → filterTeam), so the toolbar's counts and the page agree. */
  rows: TeamRow[];
  days: string[];
  month: boolean;
  today: string;
  me: string;
  tasks: Task[];
  onOpenTask: (task: Task) => void;
  /** A click on one of your own cells: go and edit it. */
  onEditMine: (date: string) => void;
}) {
  const calendar = useWorkCalendar();
  const [open, setOpen] = useState<string | null>(null);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const dayTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) for (const [d, h] of r.hoursByDay) m.set(d, (m.get(d) ?? 0) + h);
    return m;
  }, [rows]);
  const grand = roundHours(rows.reduce((s, r) => s + r.total, 0));

  if (rows.length === 0) return <div className="ts-empty-row ts-none">Không có ai khớp bộ lọc.</div>;

  return (
    <div className="ts-grid-scroll">
      <table className={`ts-grid ts-team${month ? " is-month" : ""}`} data-ts="team">
        <thead>
          <tr>
            <th className="ts-person-h" scope="col">Thành viên</th>
            {days.map((d) => (
              <DayHead key={d} d={d} today={today} month={month} calendar={calendar} />
            ))}
            <th className="ts-total-h" scope="col">Tổng / kỳ vọng</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const p = row.person;
            const isMe = p.accountId === me;
            const opened = open === p.accountId;
            const items = opened ? personRows(sheet.entries, p.accountId) : [];
            const odd = isOddCapacity(p);
            return (
              <Fragment key={p.accountId}>
                <tr className={`ts-prow${opened ? " is-open" : ""}${isMe ? " is-me" : ""}`}>
                  <th className="ts-person" scope="row">
                    <button
                      type="button"
                      className="ts-person-btn"
                      aria-expanded={opened}
                      onClick={() => setOpen(opened ? null : p.accountId)}
                      title={opened ? "Thu lại" : "Xem việc đã ghi"}
                    >
                      <span className="ts-caret" aria-hidden="true">{opened ? "▾" : "▸"}</span>
                      <Avatar name={p.displayName} avatarUrl={p.avatarUrl} className="bd-avatar" decorative />
                      <span className="ts-name">{p.displayName}</span>
                      {isMe && <span className="ts-tag">bạn</span>}
                      {p.outsider && <span className="ts-tag" title="Có ghi giờ nhưng không nằm trong danh sách thành viên dự án">ngoài dự án</span>}
                    </button>
                  </th>
                  {days.map((d) => {
                    const h = row.hoursByDay.get(d) ?? 0;
                    const st = dayState(p, d, h, today, calendar);
                    const off = isAway(p, d);
                    return (
                      <td
                        key={d}
                        className={`ts-cell ${dayClass(d, calendar)}${off ? " is-away" : ""}${d === today ? " is-today" : ""}${h > 0 ? " has-hours" : ""}${st === "over" ? " is-over" : ""}`}
                        style={{ ["--p" as string]: Math.min(1, h / Math.max(p.capacityHoursPerDay, 0.01)) }}
                        title={off ? "Nghỉ phép" : h > 0 ? `${fmtHours(h)}h / ${fmtHours(p.capacityHoursPerDay)}h${st === "over" ? ", vượt công suất" : ""}` : dayLabel(d, calendar) || undefined}
                      >
                        {isMe ? (
                          <button type="button" className="ts-cell-btn" onClick={() => onEditMine(d)} aria-label={`Sửa giờ của bạn ngày ${dm(d)}`}>
                            {st === "over" && <span aria-hidden="true">▲</span>}
                            {h > 0 ? fmtHours(h) : ""}
                          </button>
                        ) : (
                          <span className="ts-cell-val">
                            {st === "over" && <span aria-hidden="true">▲</span>}
                            {h > 0 ? fmtHours(h) : off ? <span className="ts-away">nghỉ</span> : ""}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="ts-total">
                    <span className="ts-total-line">
                      {row.missing.length > 0 && (
                        <span className="ts-owes" title={`Chưa ghi: ${row.missing.map(dm).join(", ")}`}>
                          thiếu {row.missing.length} ngày
                        </span>
                      )}
                      {row.booked > 0 && (
                        <span className={`ts-booked${row.offBooking ? " is-off" : ""}`} title={row.offBooking ? "Giờ đã ghi khác giờ được book quá 20%" : "Giờ được book trong kỳ"}>
                          book {fmtHours(row.booked)}h
                        </span>
                      )}
                      {odd && (
                        <span className="ts-odd" title={`Công suất ${fmtHours(p.capacityHoursPerDay)}h/ngày: có thể nhập nhầm trong hồ sơ nhân lực`}>
                          {fmtHours(p.capacityHoursPerDay)}h/ngày?
                        </span>
                      )}
                      <span className="ts-total-num">
                        <b>{fmtHours(row.total)}h</b>
                        <span className="bd-muted"> / {fmtHours(row.expected)}h</span>
                      </span>
                    </span>
                    <span className="ts-meter" aria-hidden="true">
                      <span style={{ width: `${row.expected > 0 ? Math.min(100, (row.total / row.expected) * 100) : 0}%` }} />
                    </span>
                  </td>
                </tr>
                {opened && items.length === 0 && (
                  <tr className="ts-trow">
                    <th className="ts-task" scope="row"><div className="ts-task-in"><span className="ts-sum ts-muted">Chưa ghi giờ nào trong kỳ này.</span></div></th>
                    <td colSpan={days.length + 1} />
                  </tr>
                )}
                {opened &&
                  items.map((it) => {
                    const t = byId.get(it.key);
                    return (
                      <tr key={it.key} className="ts-trow">
                        <th className="ts-task" scope="row">
                          <div className="ts-task-in">
                            <button type="button" className="ts-key" onClick={() => t && onOpenTask(t)} disabled={!t}>
                              {it.key}
                            </button>
                            <span className="ts-sum" title={it.summary}>{it.summary}</span>
                          </div>
                        </th>
                        {days.map((d) => {
                          const c = it.cells.get(d);
                          const notes = c?.entries.filter((e) => e.comment).map((e) => e.comment) ?? [];
                          return (
                            <td key={d} className={`ts-cell ${dayClass(d, calendar)}${d === today ? " is-today" : ""}`} title={notes.length ? notes.join(" · ") : undefined}>
                              <span className="ts-cell-val ts-sub">{c ? fmtHours(c.hours) : ""}</span>
                            </td>
                          );
                        })}
                        <td className="ts-total"><b>{fmtHours(it.total)}h</b></td>
                      </tr>
                    );
                  })}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th className="ts-task" scope="row">Cả nhóm</th>
            {days.map((d) => (
              <td key={d} className={`ts-foot ${dayClass(d, calendar)}${d === today ? " is-today" : ""}`}>
                {dayTotals.get(d) ? <b>{fmtHours(dayTotals.get(d) ?? 0)}</b> : ""}
              </td>
            ))}
            <td className="ts-total"><b>{fmtHours(grand)}h</b></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

