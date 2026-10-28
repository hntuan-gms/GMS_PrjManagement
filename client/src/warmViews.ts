import { api } from "./api";
import { readStoredBoardId } from "./boardModel";
import { todayIso } from "./resourceAllocation";
import { localToday } from "./taskForm";
import { rangeOf } from "./timesheetRange";
import type { ProgressScope } from "./types";
import { markViewFresh, writeViewCache } from "./viewCache";

/** Key of a progress overview in the view cache — shared with the tab that reads it. */
export const overviewParams = (asOf: string, scope: ProgressScope) =>
  JSON.stringify([asOf, scope.assignee ?? "", scope.epic ?? "", [...(scope.types ?? [])].sort()]);

/**
 * Bảng, Chấm công and Báo cáo used to start asking Jira only when their tab was clicked, so every first
 * visit waited 1–4 s. These ask for what each tab opens on as soon as the project is open, and leave the
 * answers in the view cache (marked fresh), so the tab paints at once and does not ask again.
 *
 * A failure is ignored here: the tab asks for itself when it is opened, exactly as before.
 */
const inFlight = new Map<string, Promise<void>>();

function warm<T>(scope: string, view: string, params: string, fetch: () => Promise<T>): Promise<void> {
  // The same answer asked for twice at once (React runs a mount effect twice in development, and a reload on a
  // pinned tab starts the workspace twice over) is one request.
  const id = `${scope}|${view}|${params}`;
  const running = inFlight.get(id);
  if (running) return running;
  const startedAt = Date.now();
  const run = (async () => {
    try {
      const answer = await fetch();
      writeViewCache(scope, view, params, answer);
      markViewFresh(scope, view, params, startedAt);
    } catch {
      // The tab will ask when it is opened.
    } finally {
      inFlight.delete(id);
    }
  })();
  inFlight.set(id, run);
  return run;
}

/**
 * The progress overview computes from the same task read as /api/tasks (the server shares one read
 * between concurrent callers), so this one is started together with the tasks — it costs no extra Jira read.
 */
export function warmProgress(scope: string): Promise<void> {
  const asOf = todayIso();
  const none: ProgressScope = { types: [] };
  return warm(scope, "progress", overviewParams(asOf, none), () => api.getProgress(asOf, none));
}

/** The board and this week's timesheet: Jira reads of their own, so they wait until the plan is on screen. */
export function warmBoardAndTimesheet(scope: string, projectKey: string): Promise<void> {
  const boardId = readStoredBoardId(projectKey);
  const { from, to } = rangeOf("week", localToday());
  return Promise.all([
    warm(scope, "board", String(boardId), () => api.getBoard(boardId)),
    warm(scope, "timesheet", `${from}|${to}`, () => api.getTimesheet(from, to)),
  ]).then(() => undefined);
}
