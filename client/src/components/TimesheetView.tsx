import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import { localToday, roundHours } from "../taskForm";
import type { Session, Task, Timesheet, TimesheetPerson, WorklogEntry } from "../types";
import NumberInput from "./NumberInput";

/**
 * Timesheet: hours each member logged in Jira, per day, against their capacity.
 *
 * Everything shown is Jira's worklogs (server/src/timesheet.ts) — logging here
 * is logging in Jira, under the signed-in user's name, which is the only author
 * Jira will accept. Capacity and leave come from the Nguồn lực tab's profiles,
 * defaulting to a full working day.
 */

type Mode = "week" | "month";
type Selection = { accountId: string; date: string | null } | null;

const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekday = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay();
const isWeekend = (iso: string) => weekday(iso) === 0 || weekday(iso) === 6;
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function rangeOf(mode: Mode, anchor: string): { from: string; to: string } {
  if (mode === "week") {
    const from = addDays(anchor, -((weekday(anchor) + 6) % 7));
    return { from, to: addDays(from, 6) };
  }
  const from = `${anchor.slice(0, 7)}-01`;
  const next = new Date(from + "T00:00:00Z");
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from, to: addDays(next.toISOString().slice(0, 10), -1) };
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

const away = (p: TimesheetPerson, d: string) => p.absences.some((a) => a.from <= d && d <= a.to);

/** Sequential ramp over the share of a day's capacity; "over" is a state, not a darker blue. */
function band(hours: number, capacity: number): "none" | "low" | "mid" | "full" | "over" {
  if (hours <= 0) return "none";
  const r = hours / Math.max(capacity, 0.01);
  if (r > 1.05) return "over";
  if (r >= 0.95) return "full";
  if (r >= 0.5) return "mid";
  return "low";
}

export default function TimesheetView({
  session,
  tasks,
  onOpenEdit,
  onTasksChanged,
}: {
  session: Session;
  tasks: Task[];
  onOpenEdit: (task: Task) => void;
  onTasksChanged: () => void;
}) {
  const today = localToday();
  const [mode, setMode] = useState<Mode>("week");
  const [anchor, setAnchor] = useState(today);
  const { from, to } = rangeOf(mode, anchor);
  const [selection, setSelection] = useState<Selection>(null);
  const [logFor, setLogFor] = useState<{ date: string; issueKey?: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const me = session.user.accountId;

  // Loading and error are derived from which request the last result answered,
  // rather than reset in the effect. A reload of the same range keeps showing
  // the old figures until the new ones land; a new range starts blank.
  const range = `${from}|${to}`;
  const requestKey = `${range}|${reloadKey}`;
  const [result, setResult] = useState<{ key: string; sheet?: Timesheet; error?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .getTimesheet(from, to)
      .then((sheet) => alive && setResult({ key: requestKey, sheet }))
      .catch(
        (e) =>
          alive &&
          setResult({ key: requestKey, error: e instanceof ApiError || e instanceof Error ? e.message : "Không tải được timesheet." })
      );
    return () => {
      alive = false;
    };
  }, [from, to, requestKey]);
  const loading = result?.key !== requestKey;
  const sheet = result?.sheet && result.key.startsWith(`${range}|`) ? result.sheet : null;
  const error = result?.key === requestKey ? (result.error ?? null) : null;

  const days = useMemo(() => eachDay(from, to), [from, to]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const grid = useMemo(() => {
    const cell = new Map<string, number>();
    const dayTotal = new Map<string, number>();
    for (const e of sheet?.entries ?? []) {
      const k = `${e.authorAccountId}|${e.date}`;
      cell.set(k, (cell.get(k) ?? 0) + e.hours);
      dayTotal.set(e.date, (dayTotal.get(e.date) ?? 0) + e.hours);
    }
    // "Expected" counts only working days already reached: a Wednesday view of
    // this week shouldn't call Thursday and Friday missing.
    const rows = (sheet?.people ?? []).map((p) => {
      let total = 0;
      let expected = 0;
      const missing: string[] = [];
      for (const d of days) {
        const h = cell.get(`${p.accountId}|${d}`) ?? 0;
        total += h;
        if (!isWeekend(d) && !away(p, d) && d <= today) {
          expected += p.capacityHoursPerDay;
          if (h === 0 && d < today) missing.push(d);
        }
      }
      return { person: p, total: roundHours(total), expected, missing };
    });
    return { cell, dayTotal, rows };
  }, [sheet, days, today]);

  const totals = useMemo(() => {
    const logged = grid.rows.reduce((s, r) => s + r.total, 0);
    const expected = grid.rows.reduce((s, r) => s + r.expected, 0);
    const withGaps = grid.rows.filter((r) => !r.person.outsider && r.missing.length > 0).length;
    let overDays = 0;
    for (const r of grid.rows) {
      for (const d of days) {
        if (band(grid.cell.get(`${r.person.accountId}|${d}`) ?? 0, r.person.capacityHoursPerDay) === "over") overDays++;
      }
    }
    return { logged: roundHours(logged), expected, withGaps, overDays };
  }, [grid, days]);

  const detail = useMemo(() => {
    if (!selection || !sheet) return null;
    const person = sheet.people.find((p) => p.accountId === selection.accountId);
    if (!person) return null;
    const entries = sheet.entries.filter(
      (e) => e.authorAccountId === selection.accountId && (!selection.date || e.date === selection.date)
    );
    return { person, entries };
  }, [selection, sheet]);

  function shift(dir: -1 | 1) {
    if (mode === "week") setAnchor(addDays(from, dir * 7));
    else {
      const d = new Date(from + "T00:00:00Z");
      d.setUTCMonth(d.getUTCMonth() + dir);
      setAnchor(d.toISOString().slice(0, 10));
    }
    setSelection(null);
  }

  async function removeEntry(e: WorklogEntry) {
    if (!confirm(`Xoá ${e.hours}h đã ghi cho ${e.issueKey} ngày ${dm(e.date)}?`)) return;
    try {
      await api.deleteWorklog(e.issueKey, e.id);
      setReloadKey((k) => k + 1);
      onTasksChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Không xoá được.");
    }
  }

  const rangeLabel = mode === "week" ? `${dm(from)} – ${dm(to)}/${to.slice(0, 4)}` : `Tháng ${Number(from.slice(5, 7))}/${from.slice(0, 4)}`;
  const pct = totals.expected > 0 ? Math.round((totals.logged / totals.expected) * 100) : null;

  return (
    <div className="ts-wrap">
      <div className="ts-toolbar">
        <div className="segmented-control">
          <button className={`segmented-btn ${mode === "week" ? "active" : ""}`} onClick={() => setMode("week")}>
            Tuần
          </button>
          <button className={`segmented-btn ${mode === "month" ? "active" : ""}`} onClick={() => setMode("month")}>
            Tháng
          </button>
        </div>
        <button onClick={() => shift(-1)} aria-label="Kỳ trước">‹</button>
        <b className="ts-range">{rangeLabel}</b>
        <button onClick={() => shift(1)} aria-label="Kỳ sau">›</button>
        <button onClick={() => setAnchor(today)} disabled={today >= from && today <= to}>
          Hôm nay
        </button>
        <span className="bd-spacer" />
        {loading && <span className="bd-muted">Đang tải từ Jira...</span>}
        <button className="primary" onClick={() => setLogFor({ date: today >= from && today <= to ? today : from })}>
          + Ghi giờ
        </button>
      </div>

      {error && <div className="notice notice-error"><span>{error}</span></div>}

      {sheet && (
        <>
          <div className="ts-tiles">
            <div className="ts-tile">
              <span className="ts-tile-label">Đã ghi</span>
              <b className="ts-tile-value">{totals.logged}h</b>
              <span className="ts-tile-sub">
                {pct !== null ? `${pct}% so với ${totals.expected}h kỳ vọng đến hôm nay` : "Chưa tới ngày làm việc nào"}
              </span>
            </div>
            <div className={`ts-tile ${totals.withGaps > 0 ? "is-warn" : ""}`}>
              <span className="ts-tile-label">Còn ngày chưa ghi</span>
              <b className="ts-tile-value">
                {totals.withGaps > 0 && <span aria-hidden="true">● </span>}
                {totals.withGaps} người
              </b>
              <span className="ts-tile-sub">Ngày làm việc đã qua (trước hôm nay), không nghỉ, chưa có giờ</span>
            </div>
            <div className={`ts-tile ${totals.overDays > 0 ? "is-over" : ""}`}>
              <span className="ts-tile-label">Vượt công suất</span>
              <b className="ts-tile-value">
                {totals.overDays > 0 && <span aria-hidden="true">▲ </span>}
                {totals.overDays} ngày-người
              </b>
              <span className="ts-tile-sub">Ghi nhiều hơn số giờ/ngày của người đó</span>
            </div>
          </div>

          <div className="ts-grid-scroll">
            <table className={`ts-grid ${mode === "month" ? "is-month" : ""}`}>
              <thead>
                <tr>
                  <th className="ts-person-h">Thành viên</th>
                  {days.map((d) => (
                    <th key={d} className={`${isWeekend(d) ? "is-weekend" : ""} ${d === today ? "is-today" : ""}`}>
                      <span className="ts-wd">{WEEKDAYS[weekday(d)]}</span>
                      <span className="ts-dd">{mode === "week" ? dm(d) : d.slice(8, 10)}</span>
                    </th>
                  ))}
                  <th className="ts-total-h">Tổng / kỳ vọng</th>
                </tr>
              </thead>
              <tbody>
                {grid.rows.map(({ person: p, total, expected, missing }) => (
                  <tr key={p.accountId} className={selection?.accountId === p.accountId ? "is-selected" : ""}>
                    <th className="ts-person">
                      <button className="ts-person-btn" onClick={() => setSelection({ accountId: p.accountId, date: null })}>
                        <span className="bd-avatar">{initials(p.displayName)}</span>
                        <span className="ts-name">{p.displayName}</span>
                        {p.accountId === me && <span className="ts-tag">bạn</span>}
                        {p.outsider && <span className="ts-tag" title="Có ghi giờ nhưng không nằm trong danh sách thành viên dự án">ngoài DA</span>}
                      </button>
                    </th>
                    {days.map((d) => {
                      const h = roundHours(grid.cell.get(`${p.accountId}|${d}`) ?? 0);
                      const off = away(p, d);
                      const b = band(h, p.capacityHoursPerDay);
                      const gap = missing.includes(d);
                      const selected = selection?.accountId === p.accountId && selection.date === d;
                      return (
                        <td
                          key={d}
                          className={`ts-cell band-${b} ${isWeekend(d) ? "is-weekend" : ""} ${off ? "is-away" : ""} ${
                            d === today ? "is-today" : ""
                          } ${selected ? "is-selected" : ""}`}
                          onClick={() => setSelection({ accountId: p.accountId, date: d })}
                          title={
                            off
                              ? "Nghỉ phép"
                              : gap
                                ? "Chưa ghi giờ"
                                : h > 0
                                  ? `${h}h / ${p.capacityHoursPerDay}h${b === "over" ? " — vượt công suất" : ""}`
                                  : undefined
                          }
                        >
                          {h > 0 ? (
                            <>
                              {b === "over" && <span aria-hidden="true">▲</span>}
                              {h}
                            </>
                          ) : off ? (
                            <span className="ts-away">Nghỉ</span>
                          ) : gap ? (
                            <span className="ts-gap" aria-label="Chưa ghi giờ">●</span>
                          ) : null}
                        </td>
                      );
                    })}
                    <td className="ts-total">
                      <b>{total}h</b>
                      <span className="bd-muted"> / {expected}h</span>
                      <span className="ts-meter" aria-hidden="true">
                        <span style={{ width: `${expected > 0 ? Math.min(100, (total / expected) * 100) : 0}%` }} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th className="ts-person">Cả nhóm</th>
                  {days.map((d) => (
                    <td key={d} className={isWeekend(d) ? "is-weekend" : ""}>
                      {roundHours(grid.dayTotal.get(d) ?? 0) || ""}
                    </td>
                  ))}
                  <td className="ts-total">
                    <b>{totals.logged}h</b>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="ts-legend">
            <span><i className="band-low" /> dưới 50% công suất</span>
            <span><i className="band-mid" /> 50–95%</span>
            <span><i className="band-full" /> đủ ngày</span>
            <span><i className="band-over" />▲ vượt công suất</span>
            <span><span className="ts-gap">●</span> ngày làm việc chưa ghi</span>
            <span><span className="ts-away">Nghỉ</span> nghỉ phép (tab Nguồn lực)</span>
          </div>

          {detail && (
            <div className="ts-detail">
              <div className="ts-detail-head">
                <b>{detail.person.displayName}</b>
                <span className="bd-muted">
                  {selection?.date ? `${WEEKDAYS[weekday(selection.date)]} ${dm(selection.date)}` : rangeLabel} ·{" "}
                  {roundHours(detail.entries.reduce((s, e) => s + e.hours, 0))}h
                </span>
                <span className="bd-spacer" />
                {detail.person.accountId === me && (
                  <button onClick={() => setLogFor({ date: selection?.date ?? today })}>+ Ghi giờ {selection?.date ? "ngày này" : ""}</button>
                )}
                <button className="text-btn" onClick={() => setSelection(null)}>Đóng</button>
              </div>
              {detail.entries.length === 0 ? (
                <div className="bd-muted ts-empty">
                  Không có giờ nào được ghi.
                  {detail.person.accountId !== me && " Jira chỉ cho mỗi người tự ghi giờ của mình."}
                </div>
              ) : (
                <ul className="ts-entries">
                  {detail.entries.map((e) => {
                    const task = byId.get(e.issueKey);
                    return (
                      <li key={e.id}>
                        {!selection?.date && <span className="ts-entry-date">{dm(e.date)}</span>}
                        <button className="text-btn ts-key" onClick={() => task && onOpenEdit(task)} disabled={!task}>
                          {e.issueKey}
                        </button>
                        <span className="ts-entry-sum" title={e.summary}>{e.summary}</span>
                        {e.comment && <span className="ts-entry-comment" title={e.comment}>“{e.comment}”</span>}
                        <b className="ts-entry-h">{e.hours}h</b>
                        {e.mine && (
                          <button className="att-remove" onClick={() => removeEntry(e)} aria-label="Xoá giờ đã ghi" title="Xoá">
                            ✕
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {logFor && (
        <LogWorkModal
          tasks={tasks}
          me={me}
          initialDate={logFor.date}
          onClose={() => setLogFor(null)}
          onLogged={() => {
            setReloadKey((k) => k + 1);
            onTasksChanged();
          }}
        />
      )}
    </div>
  );
}

function LogWorkModal({
  tasks,
  me,
  initialDate,
  onClose,
  onLogged,
}: {
  tasks: Task[];
  me: string;
  initialDate: string;
  onClose: () => void;
  onLogged: () => void;
}) {
  // Your own open work first — that is what you are logging against nine times in ten.
  const options = useMemo(() => {
    const open = tasks.filter((t) => t.issueType.toLowerCase() !== "epic");
    const rank = (t: Task) => (t.assigneeAccountId === me ? 0 : 1) + (t.statusCategory === "done" ? 2 : 0);
    return [...open].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  }, [tasks, me]);
  const [issueKey, setIssueKey] = useState(options[0]?.id ?? "");
  const [date, setDate] = useState(initialDate);
  const [hours, setHours] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!issueKey || !hours) return;
    setSaving(true);
    setError(null);
    try {
      await api.logWork({ issueKey, date, hours, comment: comment || null });
      onLogged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không ghi được giờ.");
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal bd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-id">Ghi giờ làm việc</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <label className="field">
          <span>Công việc</span>
          <select value={issueKey} onChange={(e) => setIssueKey(e.target.value)}>
            {options.map((t) => (
              <option key={t.id} value={t.id}>
                {t.assigneeAccountId === me ? "★ " : ""}
                {t.id} · {t.summary.slice(0, 60)}
                {t.statusCategory === "done" ? " (đã xong)" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="field-row">
          <label className="field">
            <span>Ngày</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Số giờ</span>
            <NumberInput autoFocus value={hours} min={0.02} max={24} allowEmpty placeholder="VD: 1,5" onChange={setHours} />
          </label>
        </div>
        <label className="field">
          <span>Ghi chú</span>
          <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Đã làm gì (không bắt buộc)" />
        </label>
        <p className="bd-muted">Giờ được ghi lên Jira dưới tên của bạn — Jira không cho ghi hộ người khác.</p>
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-footer">
          <span className="bd-spacer" />
          <button onClick={onClose}>Huỷ</button>
          <button className="primary" onClick={submit} disabled={saving || !hours || !issueKey}>
            {saving ? "Đang ghi..." : "Ghi giờ"}
          </button>
        </div>
      </div>
    </div>
  );
}
