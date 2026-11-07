import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icons";
import { parseHours } from "../parseHours";
import { fmtHours } from "../timesheetModel";
import { dayClass } from "../timesheetDays";
import { WEEKDAYS, WEEKDAYS_LONG, dm, weekday } from "../timesheetRange";
import type { TimesheetOps } from "../useTimesheet";
import { useLayer } from "../useLayer";
import type { WorklogEntry } from "../types";
import { dayLabel, type WorkCalendar } from "../workCalendar";

/** The head of one day's column: weekday over date (just the day number in a month), shaded when the project does not work it. */
export function DayHead({ d, today, month, calendar }: { d: string; today: string; month: boolean; calendar: WorkCalendar }) {
  return (
    <th className={`ts-day ${dayClass(d, calendar)}${d === today ? " is-today" : ""}`} title={dayLabel(d, calendar) || undefined} scope="col">
      <span className="ts-wd">{WEEKDAYS[weekday(d)]}</span>
      <span className="ts-dd">{month ? d.slice(8, 10) : dm(d)}</span>
    </th>
  );
}

/**
 * Everything logged in one cell of "Của tôi", as a list you can change: hours and note of each worklog, delete,
 * and "Ghi thêm". Opened from the cell's "⋯" (or Shift+Enter) — and by a cell that holds several worklogs, which
 * cannot be typed into. It follows the live entries, so a change shows here and in the grid at once.
 */
export function CellList({
  anchor,
  issueKey,
  summary,
  issueType,
  date,
  entries,
  ops,
  onClose,
}: {
  anchor: DOMRect;
  issueKey: string;
  summary: string;
  issueType: string;
  date: string;
  entries: WorklogEntry[];
  ops: TimesheetOps;
  onClose: () => void;
}) {
  useLayer("ts-cell-list", true, { onEscape: onClose });
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: anchor.bottom + 4, left: anchor.left });
  const [newHours, setNewHours] = useState("");
  const [newNote, setNewNote] = useState("");
  const [bad, setBad] = useState(false);
  const total = entries.reduce((s, e) => s + e.hours, 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    const top = anchor.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, anchor.top - 4 - h) : anchor.bottom + 4;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - w - 8));
    setPos((p) => (p.top === top && p.left === left ? p : { top, left }));
  }, [anchor, entries.length]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  function addNew() {
    const hours = parseHours(newHours);
    if (hours === null) {
      setBad(true);
      return;
    }
    void ops.addEntry(issueKey, summary, issueType, date, hours, newNote.trim() || null);
    setNewHours("");
    setNewNote("");
    setBad(false);
  }

  return createPortal(
    <div
      ref={ref}
      className="ts-list"
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label={`Giờ đã ghi ${issueKey} ngày ${dm(date)}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="ts-list-head">
        <span className="ts-list-key">{issueKey}</span>
        <span className="ts-list-sum" title={summary}>{summary}</span>
      </div>
      <div className="ts-list-date">
        {WEEKDAYS_LONG[weekday(date)]} {dm(date)} · {fmtHours(total)}h
      </div>
      <ul className="ts-list-rows">
        {entries.map((e) => (
          <ListRow key={e.id} entry={e} ops={ops} />
        ))}
      </ul>
      <div className="ts-list-new">
        <input
          className={`ts-list-hours${bad ? " is-bad" : ""}`}
          value={newHours}
          placeholder="Giờ"
          inputMode="decimal"
          aria-label="Số giờ ghi thêm"
          autoComplete="off"
          onChange={(e) => {
            setNewHours(e.target.value);
            setBad(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addNew())}
        />
        <input
          className="ts-list-note"
          value={newNote}
          placeholder="Ghi chú"
          aria-label="Ghi chú cho giờ ghi thêm"
          autoComplete="off"
          onChange={(e) => setNewNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addNew())}
        />
        <button type="button" className="ts-list-add" onClick={addNew} disabled={!newHours.trim()}>
          Ghi thêm
        </button>
      </div>
    </div>,
    document.body
  );
}

function ListRow({ entry, ops }: { entry: WorklogEntry; ops: TimesheetOps }) {
  const [hours, setHours] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const pending = entry.id.startsWith("tmp-");
  return (
    <li className={pending ? "is-pending" : undefined}>
      <input
        className={`ts-list-hours${bad ? " is-bad" : ""}`}
        value={hours ?? fmtHours(entry.hours)}
        inputMode="decimal"
        autoComplete="off"
        aria-label="Số giờ"
        disabled={pending}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setHours(e.target.value);
          setBad(false);
        }}
        onBlur={() => {
          if (hours === null) return;
          const h = parseHours(hours);
          if (h === null) return setBad(true);
          setHours(null);
          if (h !== entry.hours) void ops.editEntry(entry, { hours: h });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape" && hours !== null) {
            e.stopPropagation();
            setHours(null);
            setBad(false);
          }
        }}
      />
      <input
        className="ts-list-note"
        value={note ?? entry.comment ?? ""}
        placeholder="Ghi chú"
        autoComplete="off"
        aria-label="Ghi chú"
        disabled={pending}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          if (note === null) return;
          const next = note.trim();
          setNote(null);
          if (next !== (entry.comment ?? "")) void ops.editEntry(entry, { comment: next || null });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape" && note !== null) {
            e.stopPropagation();
            setNote(null);
          }
        }}
      />
      <button type="button" className="ts-list-del" onClick={() => void ops.removeEntry(entry)} disabled={pending} aria-label="Xoá giờ đã ghi" title="Xoá">
        <Icon name="trash" size={14} />
      </button>
    </li>
  );
}
