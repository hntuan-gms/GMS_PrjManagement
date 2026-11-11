import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { api } from "../api";
import {
  BOOKING_WEEKS,
  OTHER,
  axisDays,
  bookedCounts,
  bookingGap,
  bookingWindow,
  buildBooked,
  dayAtPx,
  dragRange,
  draftsFromLoad,
  filterBooked,
  fmtBookingHours,
  rowsOf,
  spanPx,
  weekCells,
  weekStart,
  type Axis,
  type BookedFilter,
  type BookedPerson,
  type BookingRow,
} from "../bookingModel";
import { csvName, downloadCsv } from "../csv";
import { weekColumnLabel } from "../dateLabels";
import { addDays, buildResourceLoad, todayIso } from "../resourceAllocation";
import { overloadWindow, pct, SOON_LABEL } from "../resourceColumns";
import { dm } from "../timesheetRange";
import { toast } from "../toast";
import type { Booking, JiraUser, ResourceAbsence, Session, Task } from "../types";
import { useBookings } from "../useBookings";
import { viewCacheScope } from "../viewCache";
import Avatar from "./Avatar";
import BookingEditor, { type AnchorRect, type BookingValues, type LeaveValues } from "./BookingEditor";
import { overlayOpen } from "../shortcuts";
import { useDialogs } from "./dialogContext";
import { Icon } from "./Icons";
import Popover from "./Popover";
import Spinner from "./Spinner";
import { useWorkCalendar } from "./workCalendarContext";

/*
 * Booking: who is promised to which project, when, for how many hours a day.
 *
 * One component, two scopes. On the rail ("site") it is a person across every project; inside the Resource
 * lens ("project") it is the same table cut to the project being viewed, with what the tasks already
 * assigned would need beside what is booked. A person is a line of weekly totals (the same skyline as
 * Mức tải) and opens into one line per project, where a booking is a bar: drag on an empty stretch to
 * make one, drag an edge or the body to change it, press it to edit. Every change is saved as it is made.
 *
 * Who sees whom is decided by the server (server/src/booking.ts); this file draws what it is given and
 * offers to edit only what is marked `editable` / `writable`.
 */

type Zoom = "week" | "month";
const PX_PER_DAY: Record<Zoom, number> = { week: 18, month: 6 };
const NAME_W = 264;
const LANE_H = 26;
const TOTAL = "__total__";
const LEAVE = "__leave__";

interface Props {
  session: Session;
  scope: "site" | "project";
  /** First in the toolbar: the Resource lens puts its mode switch here. */
  lead?: ReactNode;
  /** The project's tasks ("project" scope): what the work already assigned would need, beside what is booked. */
  tasks?: Task[];
  /** Open this person and put the cursor on them (Nhịp dự án's "Book thêm"). Each new `nonce` is a new request. */
  focusPerson?: { accountId: string; nonce: number } | null;
}

type Editing =
  | { kind: "booking"; anchor: AnchorRect; accountId: string; booking: Booking | null; projectKey: string | null; from: string; to: string; row: string }
  | { kind: "leave"; anchor: AnchorRect; accountId: string; absence: ResourceAbsence | null; from: string; to: string; row: string };

type Drag =
  | { kind: "create"; accountId: string; rowKey: string; start: string; day: string; moved: boolean }
  | { kind: "bar"; id: string; mode: "move" | "start" | "end"; startX: number; startY: number; delta: number };

const zoomKey = "gms.booking.zoom";
function readZoom(): Zoom {
  try {
    return localStorage.getItem(zoomKey) === "month" ? "month" : "week";
  } catch {
    return "week";
  }
}

const sorted = (a: string, b: string): [string, string] => (a <= b ? [a, b] : [b, a]);

export default function BookingView({ session, scope, lead, tasks, focusPerson = null }: Props) {
  const today = todayIso();
  const calendar = useWorkCalendar();
  const dialogs = useDialogs();
  const me = session.user.accountId;
  const projectKey = scope === "project" ? (session.project?.key ?? null) : null;

  const [zoom, setZoomState] = useState<Zoom>(readZoom);
  const [shift, setShift] = useState(0);
  const { from, to } = useMemo(() => bookingWindow(today, shift), [today, shift]);
  const axis: Axis = useMemo(() => ({ from, to, pxPerDay: PX_PER_DAY[zoom] }), [from, to, zoom]);
  const trackW = axisDays(axis) * axis.pxPerDay;

  const cacheScope = viewCacheScope(session.site.cloudId, me, session.project?.key ?? "");
  const { sheet, error, ops, reload } = useBookings({ from, to, project: projectKey, cacheScope });

  const [text, setText] = useState("");
  const [filter, setFilter] = useState<BookedFilter>("all");
  const [opened, setOpened] = useState<ReadonlySet<string> | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** Whose line a dragged bar is over (it will be handed to them on release), and the line J/K/N/Enter act on. */
  const [dropPerson, setDropPerson] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const setZoom = (z: Zoom) => {
    setZoomState(z);
    try {
      localStorage.setItem(zoomKey, z);
    } catch {
      /* private window: not remembered */
    }
  };

  const soon = useMemo(() => overloadWindow(today), [today]);
  const booked = useMemo(
    () => (sheet ? buildBooked({ people: sheet.people, bookings: sheet.bookings, absences: sheet.absences, from, to, soon, calendar }) : []),
    [sheet, from, to, soon, calendar]
  );
  const counts = useMemo(() => bookedCounts(booked), [booked]);
  const shown = useMemo(() => filterBooked(booked, text, filter, me), [booked, text, filter, me]);

  const projectName = useMemo(() => new Map((sheet?.projects ?? []).map((p) => [p.key, p.name])), [sheet]);
  const writable = useMemo(() => (sheet?.projects ?? []).filter((p) => p.writable), [sheet]);
  const canWrite = useCallback((key: string) => writable.some((p) => p.key === key), [writable]);
  const canBook = writable.length > 0;
  const canEditLeave = (accountId: string) => accountId === me || (sheet?.role ?? "member") !== "member";

  // Until someone opens or closes a row: a short list is open, and so are you.
  const isOpen = (accountId: string) => (opened ? opened.has(accountId) : booked.length <= 3 || accountId === me);
  const toggle = (accountId: string) => {
    const base = new Set(booked.filter((p) => isOpen(p.person.accountId)).map((p) => p.person.accountId));
    if (base.has(accountId)) base.delete(accountId);
    else base.add(accountId);
    setOpened(base);
  };

  // Opens at today, like the load table. Again when the window or the zoom changes the pixel under it.
  const scrollToToday = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const span = spanPx(axis, today, today);
    el.scrollLeft = span ? Math.max(0, span.left - axis.pxPerDay * 7) : 0;
  }, [axis, today]);
  const ready = !!sheet;
  useLayoutEffect(() => {
    if (ready) scrollToToday();
  }, [ready, scrollToToday]);

  // What the tasks already assigned on this project claim, per person (the Resource lens only).
  const load = useMemo(() => {
    if (scope !== "project" || !tasks || !sheet) return null;
    return buildResourceLoad({
      tasks,
      users: sheet.people,
      profiles: sheet.people.map((p) => ({ accountId: p.accountId, role: p.role, skills: p.skills, capacityHoursPerDay: p.capacityHoursPerDay, costPerDay: null, notes: null })),
      absences: sheet.absences,
      defaultCapacityHours: sheet.defaultCapacityHours,
      from,
      to,
      includeIdle: true,
      calendar,
    });
  }, [scope, tasks, sheet, from, to, calendar]);

  /** Assigned against booked on this project in the two weeks ahead; null when they agree (within an hour). */
  const gapOf = useCallback(
    (accountId: string): { assigned: number; booked: number } | null => {
      if (!load || !projectKey || !sheet) return null;
      return bookingGap({
        person: load.people.find((p) => p.accountId === accountId),
        bookings: sheet.bookings,
        absences: sheet.absences.filter((a) => a.accountId === accountId),
        accountId,
        projectKey,
        soon,
        calendar,
      });
    },
    [load, projectKey, sheet, soon, calendar]
  );

  // -------------------------------------------------------------------------------------------------------------
  // Drawing a new bar, and moving one

  const personOf = (accountId: string) => booked.find((p) => p.person.accountId === accountId)?.person;

  function creatable(accountId: string, rowKey: string): boolean {
    if (rowKey === LEAVE) return canEditLeave(accountId);
    if (rowKey === OTHER) return false;
    if (rowKey === TOTAL) return canBook;
    return canWrite(rowKey);
  }

  function onTrackDown(e: PointerEvent<HTMLDivElement>, accountId: string, rowKey: string) {
    if (e.button !== 0 || editing || (e.target as HTMLElement).closest(".bk-bar")) return;
    if (!creatable(accountId, rowKey)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const day = dayAtPx(axis, e.clientX - rect.left);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ kind: "create", accountId, rowKey, start: day, day, moved: false });
  }

  function onTrackMove(e: PointerEvent<HTMLDivElement>) {
    if (drag?.kind !== "create") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const day = dayAtPx(axis, e.clientX - rect.left);
    if (day !== drag.day) setDrag({ ...drag, day, moved: true });
  }

  function onTrackUp(e: PointerEvent<HTMLDivElement>) {
    if (drag?.kind !== "create") return;
    setDrag(null);
    let [f, t] = sorted(drag.start, drag.day);
    // A plain click means "this week": Monday to Friday of the week under the pointer.
    if (!drag.moved) {
      f = weekStart(f);
      t = addDays(f, 4);
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const span = spanPx(axis, f, t);
    const anchor: AnchorRect = { left: rect.left + (span?.left ?? 0), top: rect.top, bottom: rect.bottom, width: span?.width ?? 0 };
    if (drag.rowKey === LEAVE) setEditing({ kind: "leave", anchor, accountId: drag.accountId, absence: null, from: f, to: t, row: LEAVE });
    else {
      const key = drag.rowKey === TOTAL ? (projectKey && canWrite(projectKey) ? projectKey : writable.length === 1 ? writable[0].key : null) : drag.rowKey;
      setEditing({ kind: "booking", anchor, accountId: drag.accountId, booking: null, projectKey: key, from: f, to: t, row: drag.rowKey });
    }
  }

  function onBarDown(e: PointerEvent<HTMLElement>, b: Booking) {
    if (e.button !== 0 || !b.editable || editing) return;
    e.stopPropagation();
    const handle = (e.target as HTMLElement).dataset.handle as "start" | "end" | undefined;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ kind: "bar", id: b.id, mode: handle ?? "move", startX: e.clientX, startY: e.clientY, delta: 0 });
  }

  /**
   * Another person's line under the pointer, when a bar may be handed to them: only by its body, and only onto
   * their total line or their line of the same project (a bar dropped on a different project's line, or on leave,
   * would be a different promise, and stays with its owner).
   */
  function personUnder(x: number, y: number, b: Booking): string | null {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>(".bk-row");
    const id = hit?.closest<HTMLElement>(".bk-person")?.dataset.person;
    if (!hit || !id || id === b.accountId) return null;
    const sameProject = hit.dataset.project === (b.projectKey ?? "other");
    return hit.classList.contains("bk-row-person") || sameProject ? id : null;
  }

  function onBarMove(e: PointerEvent<HTMLElement>) {
    if (drag?.kind !== "bar") return;
    const delta = Math.round((e.clientX - drag.startX) / axis.pxPerDay);
    if (delta !== drag.delta) setDrag({ ...drag, delta });
    if (drag.mode === "move") {
      const b = sheet?.bookings.find((x) => x.id === drag.id);
      const over = b ? personUnder(e.clientX, e.clientY, b) : null;
      if (over !== dropPerson) setDropPerson(over);
    }
  }

  function onBarUp(e: PointerEvent<HTMLElement>, b: Booking) {
    if (drag?.kind !== "bar") return;
    const d = drag;
    setDrag(null);
    setDropPerson(null);
    const target = d.mode === "move" ? personUnder(e.clientX, e.clientY, b) : null;
    if (d.delta === 0 && !target) {
      // A press without moving opens the bar; one dragged off its line and dropped nowhere does nothing.
      if (d.mode === "move" && Math.abs(e.clientY - d.startY) < 6) openBooking(b, e.currentTarget);
      return;
    }
    // Only what changed is sent: the other end, or the person, may have been changed by someone else meanwhile.
    const next = dragRange(b, d.mode, d.delta);
    const patch: { accountId?: string; from?: string; to?: string } = {};
    if (target) patch.accountId = target;
    if (next.from !== b.from) patch.from = next.from;
    if (next.to !== b.to) patch.to = next.to;
    if (target) setOpened(new Set([...booked.filter((p) => isOpen(p.person.accountId)).map((p) => p.person.accountId), target]));
    if (Object.keys(patch).length > 0) void ops.update(b, patch);
  }

  const rectOf = (el: Element): AnchorRect => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, bottom: r.bottom, width: r.width };
  };

  function openBooking(b: Booking, el: Element) {
    if (!b.editable) return;
    setEditing({ kind: "booking", anchor: rectOf(el), accountId: b.accountId, booking: b, projectKey: b.projectKey, from: b.from, to: b.to, row: b.projectKey ?? OTHER });
  }

  function onBarKey(e: KeyboardEvent<HTMLElement>, b: Booking) {
    if (!b.editable) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openBooking(b, e.currentTarget);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      void ops.remove(b);
    }
  }

  /** "+" beside a name: next week, Monday to Friday, ready to be typed over. */
  function bookNextWeek(accountId: string, el: Element) {
    const f = addDays(weekStart(today), 7);
    setOpened(new Set([...booked.filter((p) => isOpen(p.person.accountId)).map((p) => p.person.accountId), accountId]));
    setEditing({
      kind: "booking",
      anchor: rectOf(el),
      accountId,
      booking: null,
      projectKey: projectKey && canWrite(projectKey) ? projectKey : writable.length === 1 ? writable[0].key : null,
      from: f,
      to: addDays(f, 4),
      row: TOTAL,
    });
  }

  // J / K between people, Enter opens or closes one, N books the one the cursor is on (the workspace's keys, shortcuts.ts).
  const latest = useRef({ shown, toggle, bookNextWeek, canBook, editing });
  latest.current = { shown, toggle, bookNextWeek, canBook, editing };
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  useEffect(() => {
    const onMove = (ev: Event) => {
      const delta = (ev as CustomEvent<{ delta: number }>).detail?.delta ?? 1;
      const list = latest.current.shown;
      if (list.length === 0) return;
      setCursor((cur) => {
        const i = list.findIndex((p) => p.person.accountId === cur);
        const at = i < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, i + delta));
        return list[at].person.accountId;
      });
    };
    const onNew = () => {
      const { canBook: ok, shown: list, editing: busy } = latest.current;
      if (!ok || busy || list.length === 0) return;
      const cur = cursorRef.current;
      const id = cur && list.some((p) => p.person.accountId === cur) ? cur : list[0].person.accountId;
      setCursor(id);
      const el = document.querySelector<HTMLElement>(`.bk-person[data-person="${CSS.escape(id)}"] .bk-name`);
      if (el) latest.current.bookNextWeek(id, el);
    };
    const onEnter = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Enter" || e.target !== document.body || overlayOpen()) return;
      if (cursorRef.current) latest.current.toggle(cursorRef.current);
    };
    window.addEventListener("gms:booking-move", onMove);
    window.addEventListener("gms:booking-new", onNew);
    window.addEventListener("keydown", onEnter);
    return () => {
      window.removeEventListener("gms:booking-move", onMove);
      window.removeEventListener("gms:booking-new", onNew);
      window.removeEventListener("keydown", onEnter);
    };
  }, []);
  // "Book thêm" from the report: that person's line is opened and under the cursor once the sheet is here.
  const focused = useRef(0);
  useEffect(() => {
    if (!focusPerson || focusPerson.nonce === focused.current || !sheet) return;
    if (!booked.some((p) => p.person.accountId === focusPerson.accountId)) return;
    focused.current = focusPerson.nonce;
    setCursor(focusPerson.accountId);
    setOpened(new Set([...booked.filter((p) => isOpen(p.person.accountId)).map((p) => p.person.accountId), focusPerson.accountId]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPerson, sheet, booked]);
  useEffect(() => {
    if (cursor) document.querySelector(`.bk-person[data-person="${CSS.escape(cursor)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function commitBooking(v: BookingValues) {
    if (editing?.kind !== "booking") return;
    const e = editing;
    setEditing(null);
    if (!e.booking) {
      if (!v.projectKey) return;
      const person = personOf(e.accountId);
      void ops.create({ accountId: e.accountId, projectKey: v.projectKey, from: v.from, to: v.to, hoursPerDay: v.hoursPerDay, status: v.status, note: v.note }).then((saved) => {
        if (!saved || !person || !sheet) return;
        // Not refused, said: the days this pushes the person past what they have.
        const days = buildBooked({ people: [person], bookings: [...sheet.bookings.filter((b) => b.id !== saved.id), saved], absences: sheet.absences, from: v.from, to: v.to, soon, calendar })[0].days;
        const over = days.filter((d) => d.capacity > 0 && d.booked > d.capacity + 1e-6).length;
        if (over > 0) toast(`${person.displayName} vượt công suất ${over} ngày`, { action: { label: "Hoàn tác", run: () => void ops.remove(saved) } });
      });
      return;
    }
    const b = e.booking;
    const patch: Partial<Pick<Booking, "from" | "to" | "hoursPerDay" | "status" | "note">> = {};
    if (v.from !== b.from) patch.from = v.from;
    if (v.to !== b.to) patch.to = v.to;
    if (v.hoursPerDay !== b.hoursPerDay) patch.hoursPerDay = v.hoursPerDay;
    if (v.status !== b.status) patch.status = v.status;
    if (v.note !== b.note) patch.note = v.note;
    if (Object.keys(patch).length > 0) void ops.update(b, patch);
  }

  function commitLeave(v: LeaveValues) {
    if (editing?.kind !== "leave") return;
    const e = editing;
    setEditing(null);
    if (!e.absence) {
      void ops.addLeave(e.accountId, v.from, v.to, v.reason);
      return;
    }
    const a = e.absence;
    const patch: { from?: string; to?: string; reason?: string | null } = {};
    if (v.from !== a.from) patch.from = v.from;
    if (v.to !== a.to) patch.to = v.to;
    if (v.reason !== a.reason) patch.reason = v.reason;
    if (Object.keys(patch).length > 0) void ops.updateLeave(a, patch);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Menu actions

  async function bookFromLoad() {
    if (!load || !projectKey || !sheet) return;
    const drafts = draftsFromLoad(load.people, sheet.bookings, projectKey);
    if (drafts.length === 0) {
      toast("Việc đã giao đều đã có booking");
      return;
    }
    const people = new Set(drafts.map((d) => d.accountId)).size;
    const ok = await dialogs.confirm({
      title: "Book từ việc đã giao",
      message: `Tạo ${drafts.length} booking Dự kiến cho ${people} người, theo giờ của việc đã giao trên ${projectKey}?`,
      confirmLabel: "Tạo",
    });
    if (!ok) return;
    let done = 0;
    for (const d of drafts) {
      if (await ops.create({ ...d, projectKey, status: "tentative", note: null }, { quiet: true })) done++;
    }
    toast(done === drafts.length ? `Đã tạo ${done} booking` : `Đã tạo ${done}/${drafts.length} booking`, { tone: done === drafts.length ? "success" : "error" });
    reload();
  }

  function exportCsv() {
    if (!sheet) return;
    const name = new Map(sheet.people.map((p) => [p.accountId, p.displayName]));
    const rows = sheet.bookings
      .slice()
      .sort((a, b) => (name.get(a.accountId) ?? "").localeCompare(name.get(b.accountId) ?? "", "vi") || a.from.localeCompare(b.from))
      .map((b) => [name.get(b.accountId) ?? b.accountId, b.projectKey ?? "Dự án khác", b.from, b.to, b.hoursPerDay, b.status === "confirmed" ? "Chắc" : "Dự kiến", b.note ?? ""]);
    downloadCsv(csvName("booking", today), [["Người", "Dự án", "Từ", "Đến", "Giờ/ngày", "Trạng thái", "Ghi chú"], ...rows]);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Header columns

  const weeks = useMemo(() => {
    const out: Array<{ start: string; left: number; isNow: boolean }> = [];
    for (let i = 0; i < BOOKING_WEEKS; i++) {
      const start = addDays(from, i * 7);
      out.push({ start, left: i * 7 * axis.pxPerDay, isNow: today >= start && today <= addDays(start, 6) });
    }
    return out;
  }, [from, axis.pxPerDay, today]);

  const months = useMemo(() => {
    const out: Array<{ label: string; left: number; width: number }> = [];
    let cursor = from;
    while (cursor <= to) {
      const [y, m] = cursor.split("-").map(Number);
      const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
      const end = addDays(next, -1) > to ? to : addDays(next, -1);
      const span = spanPx(axis, cursor, end)!;
      out.push({ label: `Tháng ${m}/${y}`, left: span.left, width: span.width });
      cursor = next;
    }
    return out;
  }, [from, to, axis]);

  const todaySpan = spanPx(axis, today, today);
  const gridStyle = { "--bk-day": `${axis.pxPerDay}px`, "--bk-name": `${NAME_W}px`, "--bk-track": `${trackW}px` } as CSSProperties;
  const single = booked.length <= 1;

  // -------------------------------------------------------------------------------------------------------------

  function barStyle(b: Pick<Booking, "from" | "to">, lane: number): CSSProperties | null {
    const span = spanPx(axis, b.from, b.to);
    return span ? { left: span.left, width: Math.max(span.width - 2, 4), top: 3 + lane * LANE_H } : null;
  }

  function renderBar(b: Booking, lane: number) {
    const live = drag?.kind === "bar" && drag.id === b.id ? { ...b, ...dragRange(b, drag.mode, drag.delta) } : b;
    const style = barStyle(live, lane);
    if (!style) return null;
    const named = b.projectKey ? `${b.projectKey} · ` : "";
    const title = `${named}${fmtBookingHours(b.hoursPerDay)}/ngày · ${dm(live.from)}–${dm(live.to)} · ${b.status === "confirmed" ? "Chắc" : "Dự kiến"}${b.note ? ` · ${b.note}` : ""}`;
    return (
      <div
        key={b.id}
        className={`bk-bar is-${b.status}${b.projectKey ? "" : " is-other"}${b.editable ? " is-editable" : ""}${drag?.kind === "bar" && drag.id === b.id ? " is-dragging" : ""}`}
        style={style}
        title={title}
        role={b.editable ? "button" : "img"}
        aria-label={title}
        tabIndex={b.editable ? 0 : undefined}
        data-booking={b.id}
        onPointerDown={(e) => onBarDown(e, b)}
        onPointerMove={onBarMove}
        onPointerUp={(e) => onBarUp(e, b)}
        onKeyDown={(e) => onBarKey(e, b)}
      >
        {b.editable && <i className="bk-handle is-start" data-handle="start" />}
        <span className="bk-bar-text">{fmtBookingHours(b.hoursPerDay)}</span>
        {b.note && <span className="bk-bar-note">{b.note}</span>}
        {b.editable && <i className="bk-handle is-end" data-handle="end" />}
      </div>
    );
  }

  function renderGhost(accountId: string, rowKey: string, lane = 0) {
    let f: string | null = null;
    let t: string | null = null;
    if (drag?.kind === "create" && drag.accountId === accountId && drag.rowKey === rowKey) [f, t] = sorted(drag.start, drag.day);
    else if (editing && editing.accountId === accountId && editing.row === rowKey) {
      // The bar being typed in the panel, on the line it was drawn on.
      const isNew = editing.kind === "leave" ? !editing.absence : !editing.booking;
      if (isNew) [f, t] = [editing.from, editing.to];
    }
    if (!f || !t) return null;
    const style = barStyle({ from: f, to: t }, lane);
    return style ? <div className="bk-bar is-ghost" style={style} aria-hidden="true" /> : null;
  }

  function renderProjectRow(p: BookedPerson, row: BookingRow) {
    const id = p.person.accountId;
    const can = creatable(id, row.key);
    const gap = row.key === projectKey ? gapOf(id) : null;
    return (
      <div key={row.key} className={`bk-row bk-row-project${row.key === OTHER ? " is-other" : ""}`} data-project={row.key === OTHER ? "other" : row.key}>
        <div className="bk-name bk-name-project">
          {row.key === OTHER ? (
            <span className="bk-project-other" title="Dự án bạn không xem được trên Jira">
              Dự án khác
            </span>
          ) : (
            <>
              <span className="bk-project-key">{row.key}</span>
              <span className="bk-project-name">{projectName.get(row.key) ?? ""}</span>
            </>
          )}
          {gap && (
            <span className="bk-gap" title={`${SOON_LABEL}: việc đã giao ${gap.assigned}h, đã book ${gap.booked}h`}>
              giao {gap.assigned}h · book {gap.booked}h
            </span>
          )}
        </div>
        <div
          className={`bk-track${can ? " is-creatable" : ""}`}
          style={{ height: row.laneCount * LANE_H + 6 }}
          onPointerDown={(e) => onTrackDown(e, id, row.key)}
          onPointerMove={onTrackMove}
          onPointerUp={onTrackUp}
        >
          {row.bookings.map((b) => renderBar(b, row.lanes.get(b.id) ?? 0))}
          {renderGhost(id, row.key)}
        </div>
      </div>
    );
  }

  function renderLeaveRow(p: BookedPerson, absences: ResourceAbsence[]) {
    const id = p.person.accountId;
    const can = canEditLeave(id);
    if (!can && absences.length === 0) return null;
    return (
      <div className="bk-row bk-row-leave" data-project="leave">
        <div className="bk-name bk-name-project">
          <span className="bk-project-other">Nghỉ</span>
        </div>
        <div
          className={`bk-track${can ? " is-creatable" : ""}`}
          style={{ height: LANE_H + 6 }}
          onPointerDown={(e) => onTrackDown(e, id, LEAVE)}
          onPointerMove={onTrackMove}
          onPointerUp={onTrackUp}
        >
          {absences.map((a) => {
            const style = barStyle(a, 0);
            if (!style) return null;
            const title = `Nghỉ ${dm(a.from)}–${dm(a.to)}${a.reason ? ` · ${a.reason}` : ""}`;
            return (
              <button
                key={a.id}
                type="button"
                className="bk-bar is-leave"
                style={style}
                title={title}
                aria-label={title}
                disabled={!can}
                onClick={(e) => setEditing({ kind: "leave", anchor: rectOf(e.currentTarget), accountId: id, absence: a, from: a.from, to: a.to, row: LEAVE })}
              >
                <span className="bk-bar-text">{a.reason ?? "Nghỉ"}</span>
              </button>
            );
          })}
          {renderGhost(id, LEAVE)}
        </div>
      </div>
    );
  }

  function renderPerson(p: BookedPerson) {
    const id = p.person.accountId;
    const open = isOpen(id);
    const cells = weekCells(p.days);
    const absences = sheet!.absences.filter((a) => a.accountId === id);
    const rows = open ? rowsOf(sheet!.bookings, id, projectKey && canWrite(projectKey) ? projectKey : null) : [];
    const over = p.soon.overDays;
    return (
      <div key={id} className={`bk-person${open ? " is-open" : ""}${id === me ? " is-me" : ""}${dropPerson === id ? " is-drop" : ""}${cursor === id ? " is-cursor" : ""}`} data-person={id}>
        <div className="bk-row bk-row-person">
          <div className="bk-name">
            <button type="button" className="bk-toggle" aria-expanded={open} onClick={() => toggle(id)} title={open ? "Thu gọn" : "Mở"}>
              <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
              <Avatar name={p.person.displayName} avatarUrl={p.person.avatarUrl} className="bk-avatar" decorative />
              <span className="bk-person-name">{p.person.displayName}</span>
              {p.person.role && <span className="bk-person-role">{p.person.role}</span>}
            </button>
            {over > 0 && (
              <span className="bk-over" title={`${SOON_LABEL}: vượt công suất ${over} ngày`}>
                vượt {over} ngày
              </span>
            )}
            {canBook && (
              <button type="button" className="bk-add" onClick={(e) => bookNextWeek(id, e.currentTarget)} title="Book" aria-label={`Book ${p.person.displayName}`}>
                <Icon name="plus" size={14} />
              </button>
            )}
          </div>
          <div
            className={`bk-track bk-track-total${canBook ? " is-creatable" : ""}`}
            onPointerDown={(e) => onTrackDown(e, id, TOTAL)}
            onPointerMove={onTrackMove}
            onPointerUp={onTrackUp}
          >
            {cells.map((c) => {
              const span = spanPx(axis, c.start, c.end);
              if (!span) return null;
              return (
                <div
                  key={c.start}
                  className={`bk-cell band-${c.band}`}
                  style={{ left: span.left, width: span.width, "--load": Math.min(1, c.ratio) } as CSSProperties}
                  title={c.capacity > 0 ? `${dm(c.start)}–${dm(c.end)}: ${c.booked}h / ${c.capacity}h · ${pct(c.ratio)}` : `${dm(c.start)}–${dm(c.end)}: nghỉ`}
                >
                  {c.booked > 0 && <span className="rv-sky" aria-hidden="true" />}
                  {c.booked > 0 && zoom === "week" && <span className="bk-cell-pct">{pct(c.ratio)}</span>}
                </div>
              );
            })}
            {renderGhost(id, TOTAL)}
          </div>
        </div>
        {open && rows.map((row) => renderProjectRow(p, row))}
        {open && renderLeaveRow(p, absences)}
      </div>
    );
  }

  const editingPerson = editing ? personOf(editing.accountId) : undefined;

  return (
    <div className={`bk-wrap is-${scope}`}>
      <div className="tf-bar bk-toolbar">
        {lead}
        {!single && (
          <>
            <div className="tf-search bk-search">
              <Icon name="search" size={14} className="tf-search-icon" />
              <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Tìm người" aria-label="Tìm người, vai trò, kỹ năng" />
            </div>
            <div className="seg-group bk-scope" role="group" aria-label="Ai được hiện">
              <button type="button" data-filter="all" className={filter === "all" ? "active" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                Tất cả {counts.all}
              </button>
              {counts.over > 0 && (
                <button type="button" data-filter="over" className={`is-risk${filter === "over" ? " active" : ""}`} aria-pressed={filter === "over"} onClick={() => setFilter(filter === "over" ? "all" : "over")} title={`Vượt công suất trong ${SOON_LABEL}`}>
                  Quá tải {counts.over}
                </button>
              )}
              {counts.free > 0 && (
                <button type="button" data-filter="free" className={filter === "free" ? "active" : ""} aria-pressed={filter === "free"} onClick={() => setFilter(filter === "free" ? "all" : "free")} title={`Còn ít nhất một ngày chưa book trong ${SOON_LABEL}`}>
                  Còn trống {counts.free}
                </button>
              )}
            </div>
          </>
        )}
        <span className="bd-spacer" />
        <div className="seg-group" role="group" aria-label="Độ rộng cột">
          <button type="button" data-zoom="week" className={zoom === "week" ? "active" : ""} aria-pressed={zoom === "week"} onClick={() => setZoom("week")}>
            Tuần
          </button>
          <button type="button" data-zoom="month" className={zoom === "month" ? "active" : ""} aria-pressed={zoom === "month"} onClick={() => setZoom("month")}>
            Tháng
          </button>
        </div>
        <button type="button" className="tb-btn bk-nav" onClick={() => setShift((s) => s - 13)} aria-label="Lùi ba tháng" title="Lùi ba tháng">
          <Icon name="chevronLeft" size={14} />
        </button>
        <button
          type="button"
          className="tb-btn"
          onClick={() => {
            if (shift !== 0) setShift(0);
            else scrollToToday();
          }}
        >
          Hôm nay
        </button>
        <button type="button" className="tb-btn bk-nav" onClick={() => setShift((s) => s + 13)} aria-label="Tới ba tháng" title="Tới ba tháng">
          <Icon name="chevronRight" size={14} />
        </button>
        {canBook && <PersonAdder onPick={ops.addPerson} />}
        {sheet && (
          <Popover className="tb-btn bk-more" align="end" role="menu" caret={false} menuLabel="Tuỳ chọn" ariaLabel="Tuỳ chọn" label={<Icon name="more" size={16} />}>
            {({ close }) => (
              <>
                {scope === "project" && projectKey && canWrite(projectKey) && (
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item bk-from-load"
                    onClick={() => {
                      close();
                      void bookFromLoad();
                    }}
                  >
                    <Icon name="layers" size={14} />
                    Book từ việc đã giao
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item bk-export"
                  disabled={sheet.bookings.length === 0}
                  onClick={() => {
                    close();
                    exportCsv();
                  }}
                >
                  <Icon name="download" size={14} />
                  Xuất CSV
                </button>
                <div className="menu-sep" role="separator" />
                <div className="bk-legend" role="group" aria-label="Chú giải">
                  <span>
                    <i className="bk-swatch is-confirmed" /> Chắc
                  </span>
                  <span>
                    <i className="bk-swatch is-tentative" /> Dự kiến
                  </span>
                  <span>
                    <i className="bk-swatch is-over" /> Vượt công suất
                  </span>
                  <span>
                    <i className="bk-swatch is-leave" /> Nghỉ
                  </span>
                </div>
              </>
            )}
          </Popover>
        )}
      </div>

      {error && !sheet && (
        <div className="notice notice-error bk-error">
          <span>{error}</span>
          <button type="button" className="tb-btn" onClick={reload}>
            Thử lại
          </button>
        </div>
      )}
      {!sheet && !error && <Spinner block label="Đang tải booking" />}

      {sheet && (
        <div className={`bk-scroll${drag ? " is-dragging" : ""}`} ref={scroller}>
          <div className="bk-grid" style={gridStyle}>
            <div className="bk-head">
              <div className="bk-name bk-corner">Người</div>
              <div className="bk-head-track">
                <div className="bk-months">
                  {months.map((m) => (
                    <span key={m.left} className="bk-month" style={{ left: m.left, width: m.width }}>
                      <b>{m.label}</b>
                    </span>
                  ))}
                </div>
                <div className="bk-weeks">
                  {weeks.map((w) => (
                    <span key={w.start} className={`bk-week${w.isNow ? " is-now" : ""}`} style={{ left: w.left }}>
                      {weekColumnLabel(w.start)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="bk-body">
              {todaySpan && <i className="bk-today" style={{ left: NAME_W + todaySpan.left + axis.pxPerDay / 2 }} aria-hidden="true" />}
              {shown.map(renderPerson)}
              {shown.length === 0 && <div className="bk-none">Không có ai khớp</div>}
            </div>
          </div>
        </div>
      )}

      {editing?.kind === "booking" && (
        <BookingEditor
          kind="booking"
          anchor={editing.anchor}
          who={`${editingPerson?.displayName ?? ""}${editing.projectKey ? ` · ${editing.projectKey}` : ""}`}
          initial={{
            projectKey: editing.projectKey,
            from: editing.from,
            to: editing.to,
            hoursPerDay: editing.booking?.hoursPerDay ?? editingPerson?.capacityHoursPerDay ?? sheet?.defaultCapacityHours ?? 8,
            status: editing.booking?.status ?? "tentative",
            note: editing.booking?.note ?? null,
          }}
          projects={!editing.booking && !editing.projectKey ? writable : undefined}
          capacityHoursPerDay={editingPerson?.capacityHoursPerDay ?? sheet?.defaultCapacityHours ?? 8}
          onCommit={commitBooking}
          onCancel={() => setEditing(null)}
          onDelete={
            editing.booking
              ? () => {
                  const b = editing.booking!;
                  setEditing(null);
                  void ops.remove(b);
                }
              : undefined
          }
        />
      )}
      {editing?.kind === "leave" && (
        <BookingEditor
          kind="leave"
          anchor={editing.anchor}
          who={`${editingPerson?.displayName ?? ""} · Nghỉ`}
          initial={{ from: editing.from, to: editing.to, reason: editing.absence?.reason ?? null }}
          onCommit={commitLeave}
          onCancel={() => setEditing(null)}
          onDelete={
            editing.absence
              ? () => {
                  const a = editing.absence!;
                  setEditing(null);
                  void ops.removeLeave(a);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

/** "+ Người": someone who has no row yet (not on this team, nothing booked), found by name on the site. */
function PersonAdder({ onPick }: { onPick: (u: JiraUser) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<JiraUser[] | null>(null);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) return;
    let alive = true;
    const t = setTimeout(() => {
      api
        .searchBookingPeople(text)
        .then((r) => alive && setFound(r))
        .catch(() => alive && setFound([]));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const results = q.trim().length < 2 ? null : found;
  return (
    <Popover className="tb-btn bk-add-person" align="end" caret={false} menuLabel="Thêm người" menuClassName="bk-person-menu" title="Thêm người để book" label={<><Icon name="plus" size={14} /> Người</>}>
      {({ close }) => (
        <>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tên" aria-label="Tìm người trên Jira" autoFocus />
          <div className="menu-scroll">
            {results?.map((u) => (
              <button
                key={u.accountId}
                type="button"
                className="menu-item"
                onClick={() => {
                  onPick(u);
                  setQ("");
                  close();
                }}
              >
                <Avatar name={u.displayName} avatarUrl={u.avatarUrl} className="bk-avatar" decorative />
                {u.displayName}
              </button>
            ))}
            {results && results.length === 0 && <div className="bk-none">Không thấy ai</div>}
          </div>
        </>
      )}
    </Popover>
  );
}
