/**
 * The batching rules of the tab's action log (see actionLog.ts for what it is for). Pure, so it can be tested.
 *
 * A record of what this tab did, sent to the server so it can sit beside the access log and Jira's own history.
 *
 * Why it exists: a drag or a Ctrl+Z is drawn at once and written to Jira seconds later, in a queue; when the
 * screen and Jira disagree, the access log (which requests ran) and the Jira changelog (what they wrote) cannot
 * say what the person did or which answer the screen then used. Each event is a name and a few plain values
 * (task keys, dates, counts) — never descriptions, comments or names of people. Batched, best effort: a failed
 * send is dropped, and nothing here may ever slow or break an edit.
 */
export interface LogEvent {
  /** Counts up within this tab: orders events whose clocks tie. */
  n: number;
  /** The browser's clock, ms. */
  t: number;
  e: string;
  d?: unknown;
}

export interface ActionLogOptions {
  send: (batch: { sid: string; events: LogEvent[] }) => void;
  now?: () => number;
  /** Events held at most this long before a send. */
  flushMs?: number;
  /** The oldest events are dropped beyond this many waiting. */
  maxWaiting?: number;
  /** One request carries at most this many (the server takes 60). */
  batchSize?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  sid?: string;
}

export function createActionLog(opts: ActionLogOptions) {
  const now = opts.now ?? Date.now;
  const flushMs = opts.flushMs ?? 1500;
  const maxWaiting = opts.maxWaiting ?? 400;
  const batchSize = opts.batchSize ?? 50;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const sid = opts.sid ?? Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  let waiting: LogEvent[] = [];
  let counter = 0;
  let timer: unknown = null;

  function flush() {
    timer = null;
    while (waiting.length > 0) {
      const events = waiting.slice(0, batchSize);
      waiting = waiting.slice(batchSize);
      try {
        opts.send({ sid, events });
      } catch {
        // Logging never gets in the way.
      }
    }
  }

  function log(e: string, d?: unknown) {
    waiting.push({ n: ++counter, t: now(), e, d });
    if (waiting.length > maxWaiting) waiting = waiting.slice(-maxWaiting);
    if (timer === null) timer = setTimer(flush, flushMs);
  }

  return { log, flush, sid, pending: () => waiting.length };
}
