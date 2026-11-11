import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fmtBookingHours, parseBookingHours } from "../bookingModel";
import type { BookingStatus } from "../types";
import { useLayer } from "../useLayer";
import DateField from "./DateField";
import { Icon } from "./Icons";

export interface AnchorRect {
  left: number;
  top: number;
  bottom: number;
  width: number;
}

export interface BookingValues {
  projectKey: string | null;
  from: string;
  to: string;
  hoursPerDay: number;
  status: BookingStatus;
  note: string | null;
}

export interface LeaveValues {
  from: string;
  to: string;
  reason: string | null;
}

interface Common {
  anchor: AnchorRect;
  /** Who it is about: the one line of context the panel carries. */
  who: string;
  onCancel: () => void;
  onDelete?: () => void;
}

type Props =
  | (Common & {
      kind: "booking";
      initial: BookingValues;
      /** Offered only when the booking has no project yet (drawn on a person's total line). */
      projects?: Array<{ key: string; name: string }>;
      capacityHoursPerDay: number;
      onCommit: (v: BookingValues) => void;
    })
  | (Common & { kind: "leave"; initial: LeaveValues; onCommit: (v: LeaveValues) => void });

const PANEL_W = 320;

/**
 * The small panel a booking (or a leave period) is typed into, anchored to its bar.
 *
 * No Save button: Enter or a click anywhere else keeps it, Esc drops it. What does not parse keeps the panel
 * open with the field marked, so a wrong "4hh" is never silently turned into something else.
 */
export default function BookingEditor(props: Props) {
  const { anchor, who, onCancel, onDelete } = props;
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const [from, setFrom] = useState(props.initial.from);
  const [to, setTo] = useState(props.initial.to);
  const [hours, setHours] = useState(props.kind === "booking" ? fmtBookingHours(props.initial.hoursPerDay) : "");
  const [status, setStatus] = useState<BookingStatus>(props.kind === "booking" ? props.initial.status : "tentative");
  const [text, setText] = useState((props.kind === "booking" ? props.initial.note : props.initial.reason) ?? "");
  const [projectKey, setProjectKey] = useState(props.kind === "booking" ? props.initial.projectKey : null);
  const [bad, setBad] = useState<"hours" | "range" | "project" | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayer("booking-editor", true, { onEscape: onCancel });

  useLayoutEffect(() => {
    const h = panel.current?.offsetHeight ?? 220;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - PANEL_W - 8));
    const below = anchor.bottom + 6;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, anchor.top - h - 6) : below;
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    first.current?.focus();
    first.current?.select();
  }, []);

  const commit = () => {
    if (to < from) return setBad("range");
    if (props.kind === "leave") {
      props.onCommit({ from, to, reason: text.trim() || null });
      return;
    }
    const h = parseBookingHours(hours, props.capacityHoursPerDay);
    if (h === null) return setBad("hours");
    if (!projectKey) return setBad("project");
    props.onCommit({ projectKey, from, to, hoursPerDay: h, status, note: text.trim() || null });
  };
  // The listener below is registered once; it must run the commit of the latest render.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) commitRef.current();
    };
    // After this tick: the pointer-up that opened the panel must not be read as a click outside it.
    const t = setTimeout(() => document.addEventListener("pointerdown", onDown, true), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, []);

  return (
    <div
      ref={panel}
      className="bk-editor"
      role="dialog"
      aria-label={props.kind === "booking" ? "Booking" : "Nghỉ"}
      style={{ left: pos?.left ?? anchor.left, top: pos?.top ?? anchor.bottom + 6, visibility: pos ? "visible" : "hidden" }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          // A date still being typed commits on blur; let it, then read the state it set.
          (e.target as HTMLElement).blur();
          setTimeout(() => commitRef.current(), 0);
        }
      }}
    >
      <div className="bk-ed-head">
        <span className="bk-ed-who">{who}</span>
        {onDelete && (
          <button type="button" className="bk-ed-del" onClick={onDelete} title="Xoá" aria-label="Xoá">
            <Icon name="trash" size={14} />
          </button>
        )}
      </div>

      {props.kind === "booking" && props.projects && (
        <label className="bk-ed-row">
          <span>Dự án</span>
          <select
            className={bad === "project" ? "is-bad" : ""}
            value={projectKey ?? ""}
            onChange={(e) => {
              setProjectKey(e.target.value || null);
              setBad(null);
            }}
            aria-label="Dự án"
          >
            {!projectKey && <option value="">Chọn dự án</option>}
            {props.projects.map((p) => (
              <option key={p.key} value={p.key}>
                {p.key} · {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {props.kind === "booking" && (
        <div className="bk-ed-row">
          <span>Giờ/ngày</span>
          <input
            ref={first}
            className={`bk-ed-hours${bad === "hours" ? " is-bad" : ""}`}
            value={hours}
            onChange={(e) => {
              setHours(e.target.value);
              setBad(null);
            }}
            aria-label="Giờ mỗi ngày"
            aria-invalid={bad === "hours"}
            title="4h, 4,5 hoặc 50%"
            inputMode="decimal"
          />
          <div className="seg-group bk-ed-status" role="group" aria-label="Trạng thái">
            <button type="button" className={status === "tentative" ? "active" : ""} aria-pressed={status === "tentative"} onClick={() => setStatus("tentative")}>
              Dự kiến
            </button>
            <button type="button" className={status === "confirmed" ? "active" : ""} aria-pressed={status === "confirmed"} onClick={() => setStatus("confirmed")}>
              Chắc
            </button>
          </div>
        </div>
      )}

      <div className={`bk-ed-row bk-ed-dates${bad === "range" ? " is-bad" : ""}`}>
        <span>Từ</span>
        <DateField
          value={from}
          ariaLabel="Từ ngày"
          onChange={(iso) => {
            setFrom(iso);
            setBad(null);
          }}
        />
        <span>đến</span>
        <DateField
          value={to}
          base={from}
          ariaLabel="Đến ngày"
          onChange={(iso) => {
            setTo(iso);
            setBad(null);
          }}
        />
      </div>

      <input
        ref={props.kind === "leave" ? first : undefined}
        className="bk-ed-note"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={props.kind === "booking" ? "Ghi chú" : "Lý do"}
        aria-label={props.kind === "booking" ? "Ghi chú" : "Lý do"}
        maxLength={props.kind === "booking" ? 500 : 200}
      />
    </div>
  );
}
