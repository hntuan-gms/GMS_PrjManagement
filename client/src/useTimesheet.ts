import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { toast } from "./toast";
import type { Timesheet, WorklogEntry } from "./types";
import { cellEntries, planCell, replacingEntry, withEntry, withoutEntries } from "./timesheetModel";
import { isViewFresh, readViewCache, writeViewCache } from "./viewCache";
import { warmInFlight } from "./warmViews";

/*
 * The hours of one period, and every way of changing them.
 *
 * A write shows at once and is confirmed behind it: the cell the person just typed in must not wait for Jira.
 * Several writes to one cell (type 2, correct to 3) run one after another and each plans its work from the
 * list as it is when its turn comes, so "3" after a still-running "2" becomes an update of that worklog, not a
 * second one. A refusal puts the list back as it was and says why in a toast. Nothing re-reads the whole
 * period after a save (that is a Jira read per keystroke); the plan's own hours (`spentHours`) are refreshed
 * once things have been quiet for a few seconds.
 */

const failed = (what: string, err: unknown) =>
  toast(`${what}: ${err instanceof Error ? err.message : "Jira không nhận."}`, { tone: "error", sticky: true });

type Loaded = { key: string; sheet?: Timesheet; error?: string } | null;

export interface TimesheetOps {
  /** Types `text` into the cell of task × day: creates, changes or clears the worklog as the text says. */
  setCell: (issueKey: string, summary: string, issueType: string, date: string, text: string) => Promise<"saved" | "invalid" | "failed">;
  /** Changes one existing worklog (the list of a cell). */
  editEntry: (entry: WorklogEntry, patch: { hours?: number; comment?: string | null }) => Promise<boolean>;
  /** Adds a worklog to a cell that already has some. */
  addEntry: (issueKey: string, summary: string, issueType: string, date: string, hours: number, comment: string | null) => Promise<boolean>;
  removeEntry: (entry: WorklogEntry) => Promise<boolean>;
}

export function useTimesheet(opts: {
  from: string;
  to: string;
  cacheScope: string;
  me: string;
  meName: string;
  onTasksChanged: () => void;
}) {
  const { from, to, cacheScope, me, meName, onTasksChanged } = opts;
  const range = `${from}|${to}`;
  const [reloadKey, setReloadKey] = useState(0);
  const requestKey = `${range}|${reloadKey}`;
  const [result, setResult] = useState<Loaded>(null);

  useEffect(() => {
    let alive = true;
    // Fetched ahead when the project opened (warmViews.ts) and nothing changed since: no second read of Jira.
    const showAhead = () => {
      if (reloadKey !== 0 || !isViewFresh(cacheScope, "timesheet", range)) return false;
      const ahead = readViewCache<Timesheet>(cacheScope, "timesheet", range);
      if (!ahead) return false;
      setResult({ key: requestKey, sheet: ahead });
      return true;
    };
    const fetchNow = () =>
      api
        .getTimesheet(from, to)
        .then((sheet) => {
          writeViewCache(cacheScope, "timesheet", range, sheet);
          if (alive) setResult({ key: requestKey, sheet });
        })
        .catch(
          (e) => alive && setResult({ key: requestKey, error: e instanceof ApiError || e instanceof Error ? e.message : "Không tải được bảng giờ." })
        );
    if (showAhead()) return;
    // Still on its way: wait for that answer rather than send the same request again.
    const pending = reloadKey === 0 ? warmInFlight(cacheScope, "timesheet", range) : null;
    if (pending) void pending.then(() => alive && !showAhead() && fetchNow());
    else void fetchNow();
    return () => {
      alive = false;
    };
  }, [from, to, range, requestKey, reloadKey, cacheScope]);

  const loading = result?.key !== requestKey;
  // Until this range's answer lands, the last one seen for it beats a blank page.
  const sheet = result?.sheet && result.key.startsWith(`${range}|`) ? result.sheet : (readViewCache<Timesheet>(cacheScope, "timesheet", range) ?? null);
  const error = result?.key === requestKey ? (result.error ?? null) : null;

  // The list the next write plans from: updated the moment a write is applied, not when React next renders.
  const live = useRef<Timesheet | null>(null);
  useEffect(() => {
    live.current = sheet;
  }, [sheet]);
  const rangeRef = useRef(range);
  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  const [, bump] = useState(0);
  const patch = useCallback(
    (fn: (entries: WorklogEntry[]) => WorklogEntry[]) => {
      const cur = live.current;
      if (!cur) return;
      const next = { ...cur, entries: fn(cur.entries) };
      live.current = next;
      writeViewCache(cacheScope, "timesheet", rangeRef.current, next);
      // The loaded answer when this period has one; otherwise the cache just written is what renders.
      setResult((r) => (r?.sheet && r.key.startsWith(`${rangeRef.current}|`) ? { ...r, sheet: next } : r));
      bump((n) => n + 1);
    },
    [cacheScope]
  );

  // One chain per cell: its writes run in the order they were asked for.
  const chains = useRef(new Map<string, Promise<unknown>>());
  const enqueue = useCallback(<T,>(cell: string, job: () => Promise<T>): Promise<T> => {
    const prev = chains.current.get(cell) ?? Promise.resolve();
    const run = prev.then(job, job);
    chains.current.set(cell, run.catch(() => undefined));
    return run;
  }, []);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tasksChanged = useRef(onTasksChanged);
  useEffect(() => {
    tasksChanged.current = onTasksChanged;
  }, [onTasksChanged]);
  const quietThenRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => tasksChanged.current(), 4000);
  }, []);
  useEffect(
    () => () => {
      // Leaving the lens with a refresh waiting: do it now, the plan's "đã ghi" column must not stay behind.
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        tasksChanged.current();
      }
    },
    []
  );

  const tmpCount = useRef(0);

  const create = useCallback(
    async (issueKey: string, summary: string, issueType: string, date: string, hours: number, comment: string | null): Promise<boolean> => {
      const draft: WorklogEntry = {
        id: `tmp-${++tmpCount.current}-${Date.now()}`,
        issueKey,
        summary,
        issueType,
        authorAccountId: me,
        authorName: meName,
        date,
        hours,
        comment,
        mine: true,
      };
      patch((es) => withEntry(es, draft));
      try {
        const saved = await api.logWork({ issueKey, date, hours, comment });
        patch((es) => replacingEntry(es, draft.id, { ...saved, summary: saved.summary || summary, issueType: saved.issueType || issueType }));
        quietThenRefresh();
        return true;
      } catch (err) {
        patch((es) => withoutEntries(es, new Set([draft.id])));
        failed(`Không ghi được ${hours}h cho ${issueKey}`, err);
        return false;
      }
    },
    [patch, quietThenRefresh, me, meName]
  );

  const change = useCallback(
    async (entry: WorklogEntry, next: { hours?: number; comment?: string | null }): Promise<boolean> => {
      const before = entry;
      const after = { ...entry, ...(next.hours !== undefined ? { hours: next.hours } : {}), ...(next.comment !== undefined ? { comment: next.comment } : {}) };
      patch((es) => replacingEntry(es, entry.id, after));
      try {
        const saved = await api.updateWorklog(entry.issueKey, entry.id, {
          ...(next.hours !== undefined ? { hours: next.hours } : {}),
          ...(next.comment !== undefined ? { comment: next.comment } : {}),
        });
        patch((es) => replacingEntry(es, entry.id, { ...after, ...saved, summary: saved.summary || after.summary }));
        quietThenRefresh();
        return true;
      } catch (err) {
        patch((es) => replacingEntry(es, entry.id, before));
        failed(`Không sửa được giờ của ${entry.issueKey}`, err);
        return false;
      }
    },
    [patch, quietThenRefresh]
  );

  const remove = useCallback(
    async (entry: WorklogEntry, undoable: boolean): Promise<boolean> => {
      patch((es) => withoutEntries(es, new Set([entry.id])));
      try {
        await api.deleteWorklog(entry.issueKey, entry.id);
        quietThenRefresh();
        if (undoable) {
          toast(`Đã xoá ${entry.hours}h của ${entry.issueKey}`, {
            action: { label: "Hoàn tác", run: () => void enqueue(`${entry.issueKey}|${entry.date}`, () => create(entry.issueKey, entry.summary, entry.issueType, entry.date, entry.hours, entry.comment)) },
          });
        }
        return true;
      } catch (err) {
        patch((es) => withEntry(es, entry));
        failed(`Không xoá được giờ của ${entry.issueKey}`, err);
        return false;
      }
    },
    [patch, quietThenRefresh, enqueue, create]
  );

  const ops: TimesheetOps = {
    setCell: (issueKey, summary, issueType, date, text) =>
      enqueue(`${issueKey}|${date}`, async () => {
        const entries = cellEntries(live.current?.entries ?? [], issueKey, date);
        const plan = planCell(text, entries);
        switch (plan.kind) {
          case "noop":
            return "saved" as const;
          case "invalid":
            return "invalid" as const;
          case "create":
            return (await create(issueKey, summary, issueType, date, plan.hours, null)) ? ("saved" as const) : ("failed" as const);
          case "update":
            return (await change(plan.entry, { hours: plan.hours })) ? ("saved" as const) : ("failed" as const);
          case "delete":
            return (await remove(plan.entries[0], true)) ? ("saved" as const) : ("failed" as const);
        }
      }),
    editEntry: (entry, next) => enqueue(`${entry.issueKey}|${entry.date}`, () => change(live.current?.entries.find((e) => e.id === entry.id) ?? entry, next)),
    addEntry: (issueKey, summary, issueType, date, hours, comment) => enqueue(`${issueKey}|${date}`, () => create(issueKey, summary, issueType, date, hours, comment)),
    removeEntry: (entry) => enqueue(`${entry.issueKey}|${entry.date}`, () => remove(live.current?.entries.find((e) => e.id === entry.id) ?? entry, true)),
  };

  return { sheet, loading, error, ops, reload: () => setReloadKey((k) => k + 1) };
}
