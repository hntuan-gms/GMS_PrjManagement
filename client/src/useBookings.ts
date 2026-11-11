import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { fmtBookingHours } from "./bookingModel";
import { toast } from "./toast";
import type { Booking, BookingPerson, BookingSheet, BookingStatus, JiraUser, ResourceAbsence } from "./types";
import { isViewFresh, readViewCache, writeViewCache } from "./viewCache";
import { warmInFlight } from "./warmViews";

/*
 * The bookings of one window, and every way of changing them.
 *
 * Like the hours grid (useTimesheet): a change shows at once and is confirmed behind it, a refusal puts the
 * list back and says why. Nothing re-reads the window after a write; the answer of each write is the row.
 */

const why = (err: unknown) => (err instanceof Error ? err.message : "Máy chủ không nhận.");
const failed = (what: string, err: unknown) => toast(`${what}: ${why(err)}`, { tone: "error", sticky: true });

export interface BookingDraftInput {
  accountId: string;
  projectKey: string;
  from: string;
  to: string;
  hoursPerDay: number;
  status: BookingStatus;
  note: string | null;
}

export interface BookingOps {
  create: (input: BookingDraftInput, opts?: { quiet?: boolean }) => Promise<Booking | null>;
  update: (b: Booking, patch: Partial<Pick<Booking, "accountId" | "from" | "to" | "hoursPerDay" | "status" | "note">>) => Promise<boolean>;
  remove: (b: Booking) => Promise<boolean>;
  addLeave: (accountId: string, from: string, to: string, reason: string | null) => Promise<boolean>;
  updateLeave: (a: ResourceAbsence, patch: { from?: string; to?: string; reason?: string | null }) => Promise<boolean>;
  removeLeave: (a: ResourceAbsence) => Promise<boolean>;
  /** A row for someone not in the list yet, so they can be booked. Kept until the window is read again. */
  addPerson: (u: JiraUser) => void;
}

type Loaded = { key: string; sheet?: BookingSheet; error?: string } | null;

export function useBookings(opts: { from: string; to: string; project: string | null; cacheScope: string }) {
  const { from, to, project, cacheScope } = opts;
  const params = `${from}|${to}|${project ?? ""}`;
  const [reloadKey, setReloadKey] = useState(0);
  const requestKey = `${params}|${reloadKey}`;
  const [result, setResult] = useState<Loaded>(null);

  useEffect(() => {
    let alive = true;
    // Fetched ahead when the project opened (warmViews.ts) and nothing changed since: no second request.
    const showAhead = () => {
      if (reloadKey !== 0 || !isViewFresh(cacheScope, "bookings", params)) return false;
      const ahead = readViewCache<BookingSheet>(cacheScope, "bookings", params);
      if (!ahead) return false;
      setResult({ key: requestKey, sheet: ahead });
      return true;
    };
    const fetchNow = () =>
      api
        .getBookings(from, to, project)
        .then((sheet) => {
          writeViewCache(cacheScope, "bookings", params, sheet);
          if (alive) setResult({ key: requestKey, sheet });
        })
        .catch((e) => alive && setResult({ key: requestKey, error: why(e) }));
    if (showAhead()) return;
    const pending = reloadKey === 0 ? warmInFlight(cacheScope, "bookings", params) : null;
    if (pending) void pending.then(() => alive && !showAhead() && fetchNow());
    else void fetchNow();
    return () => {
      alive = false;
    };
  }, [from, to, project, params, requestKey, reloadKey, cacheScope]);

  const loading = result?.key !== requestKey;
  const sheet =
    result?.sheet && result.key.startsWith(`${params}|`) ? result.sheet : (readViewCache<BookingSheet>(cacheScope, "bookings", params) ?? null);
  const error = result?.key === requestKey ? (result.error ?? null) : null;

  const live = useRef<BookingSheet | null>(null);
  useEffect(() => {
    live.current = sheet;
  }, [sheet]);
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const [, bump] = useState(0);
  const patch = useCallback(
    (fn: (s: BookingSheet) => BookingSheet) => {
      const cur = live.current;
      if (!cur) return;
      const next = fn(cur);
      live.current = next;
      writeViewCache(cacheScope, "bookings", paramsRef.current, next);
      setResult((r) => (r?.sheet && r.key.startsWith(`${paramsRef.current}|`) ? { ...r, sheet: next } : r));
      bump((n) => n + 1);
    },
    [cacheScope]
  );

  const setBookings = useCallback((fn: (bs: Booking[]) => Booking[]) => patch((s) => ({ ...s, bookings: fn(s.bookings) })), [patch]);
  const setAbsences = useCallback((fn: (as: ResourceAbsence[]) => ResourceAbsence[]) => patch((s) => ({ ...s, absences: fn(s.absences) })), [patch]);

  const tmp = useRef(0);

  const create = useCallback(
    async (input: BookingDraftInput, o?: { quiet?: boolean }): Promise<Booking | null> => {
      const draft: Booking = { id: `tmp-${++tmp.current}-${Date.now()}`, ...input, editable: true };
      setBookings((bs) => [...bs, draft]);
      try {
        const saved = await api.createBooking(input);
        setBookings((bs) => bs.map((b) => (b.id === draft.id ? saved : b)));
        return saved;
      } catch (err) {
        setBookings((bs) => bs.filter((b) => b.id !== draft.id));
        if (!o?.quiet) failed("Không book được", err);
        return null;
      }
    },
    [setBookings]
  );

  const update = useCallback<BookingOps["update"]>(
    async (b, next) => {
      const before = b;
      setBookings((bs) => bs.map((x) => (x.id === b.id ? { ...x, ...next } : x)));
      // Still being created: it has no id on the server yet, and the create's answer will replace it.
      if (b.id.startsWith("tmp-")) return true;
      try {
        const saved = await api.updateBooking(b.id, next);
        setBookings((bs) => bs.map((x) => (x.id === b.id ? saved : x)));
        return true;
      } catch (err) {
        setBookings((bs) => bs.map((x) => (x.id === b.id ? before : x)));
        failed("Không sửa được booking", err);
        return false;
      }
    },
    [setBookings]
  );

  const remove = useCallback<BookingOps["remove"]>(
    async (b) => {
      setBookings((bs) => bs.filter((x) => x.id !== b.id));
      try {
        await api.deleteBooking(b.id);
        toast(`Đã xoá booking ${fmtBookingHours(b.hoursPerDay)}/ngày`, {
          action: {
            label: "Hoàn tác",
            run: () =>
              b.projectKey &&
              void create({ accountId: b.accountId, projectKey: b.projectKey, from: b.from, to: b.to, hoursPerDay: b.hoursPerDay, status: b.status, note: b.note }),
          },
        });
        return true;
      } catch (err) {
        setBookings((bs) => [...bs, b]);
        failed("Không xoá được booking", err);
        return false;
      }
    },
    [setBookings, create]
  );

  const addLeave = useCallback<BookingOps["addLeave"]>(
    async (accountId, f, t, reason) => {
      const draft: ResourceAbsence = { id: `tmp-${++tmp.current}`, accountId, from: f, to: t, reason };
      setAbsences((as) => [...as, draft]);
      try {
        const saved = await api.addLeave(accountId, f, t, reason);
        setAbsences((as) => as.map((a) => (a.id === draft.id ? saved : a)));
        return true;
      } catch (err) {
        setAbsences((as) => as.filter((a) => a.id !== draft.id));
        failed("Không lưu được kỳ nghỉ", err);
        return false;
      }
    },
    [setAbsences]
  );

  const updateLeave = useCallback<BookingOps["updateLeave"]>(
    async (a, next) => {
      setAbsences((as) => as.map((x) => (x.id === a.id ? { ...x, ...next } : x)));
      try {
        const saved = await api.updateLeave(a.id, next);
        setAbsences((as) => as.map((x) => (x.id === a.id ? saved : x)));
        return true;
      } catch (err) {
        setAbsences((as) => as.map((x) => (x.id === a.id ? a : x)));
        failed("Không sửa được kỳ nghỉ", err);
        return false;
      }
    },
    [setAbsences]
  );

  const removeLeave = useCallback<BookingOps["removeLeave"]>(
    async (a) => {
      setAbsences((as) => as.filter((x) => x.id !== a.id));
      try {
        await api.deleteLeave(a.id);
        toast("Đã xoá kỳ nghỉ", { action: { label: "Hoàn tác", run: () => void addLeave(a.accountId, a.from, a.to, a.reason) } });
        return true;
      } catch (err) {
        setAbsences((as) => [...as, a]);
        failed("Không xoá được kỳ nghỉ", err);
        return false;
      }
    },
    [setAbsences, addLeave]
  );

  const addPerson = useCallback<BookingOps["addPerson"]>(
    (u) =>
      patch((s) => {
        if (s.people.some((p) => p.accountId === u.accountId)) return s;
        const person: BookingPerson = { ...u, capacityHoursPerDay: s.defaultCapacityHours, role: null, skills: [] };
        return { ...s, people: [...s.people, person] };
      }),
    [patch]
  );

  const ops: BookingOps = { create, update, remove, addLeave, updateLeave, removeLeave, addPerson };
  return { sheet, loading, error, ops, reload: () => setReloadKey((k) => k + 1) };
}
