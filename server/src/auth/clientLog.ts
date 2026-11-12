/**
 * What the browser tells us it did, as log lines.
 *
 * The access log says which requests reached the server; it cannot say what the person did on the screen
 * (a drag, Ctrl+Z, a re-read of the plan) or which of those answers the screen then used. The client sends
 * small batches of events here and each becomes one JSON line (`kind: "client"`), so `jsonPayload.sid` puts one
 * tab's story beside the `access` lines and the Jira changelog.
 *
 * Pure on purpose (no Express): everything in a batch is typed by a browser and trusted as little as a display
 * name is (see identity.ts), so the rules are small and testable: bounded counts and lengths, one line each,
 * only plain values. Nothing here is stored; Cloud Logging keeps it like the other lines (privacy.html §4).
 */
import { cleanName, type Identity } from "./identity.js";

export const MAX_EVENTS_PER_BATCH = 60;
const MAX_KEYS = 24;
const MAX_ARRAY = 40;
const MAX_TEXT = 160;

type Plain = string | number | boolean | null | Plain[] | { [k: string]: Plain };

/** A value reduced to what a log line should carry: short strings, finite numbers, booleans, shallow lists/objects. */
export function plainValue(v: unknown, depth = 0): Plain | undefined {
  if (typeof v === "string") return cleanName(v, MAX_TEXT);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean" || v === null) return v;
  if (depth >= 3) return undefined;
  if (Array.isArray(v)) {
    return v.slice(0, MAX_ARRAY).flatMap((x) => {
      const p = plainValue(x, depth + 1);
      return p === undefined ? [] : [p];
    });
  }
  if (v && typeof v === "object") {
    const out: { [k: string]: Plain } = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, MAX_KEYS)) {
      const p = plainValue(x, depth + 1);
      if (p !== undefined) out[cleanName(k, 40)] = p;
    }
    return out;
  }
  return undefined;
}

const EVENT_NAME = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{1,24}$/;

/** The lines to write for one POST body `{ sid, events: [{ n, t, e, d }] }`; anything malformed is dropped, never thrown. */
export function clientLogLines(who: Identity, body: unknown, projectKey: string | null): string[] {
  const b = body as { sid?: unknown; events?: unknown } | null;
  if (!b || typeof b !== "object" || !Array.isArray(b.events)) return [];
  const sid = typeof b.sid === "string" && SESSION_ID.test(b.sid) ? b.sid : "?";
  const name = cleanName(who.displayName);
  const lines: string[] = [];
  for (const raw of b.events.slice(0, MAX_EVENTS_PER_BATCH)) {
    const ev = raw as { n?: unknown; t?: unknown; e?: unknown; d?: unknown } | null;
    if (!ev || typeof ev.e !== "string" || !EVENT_NAME.test(ev.e)) continue;
    const at = typeof ev.t === "number" && Number.isFinite(ev.t) ? new Date(ev.t) : null;
    const data = plainValue(ev.d);
    lines.push(
      JSON.stringify({
        severity: "INFO",
        message: `[client] ${name || who.accountId} ${ev.e}`,
        kind: "client",
        accountId: who.accountId,
        userName: name,
        projectKey: projectKey ? cleanName(projectKey, 40) : null,
        sid,
        n: typeof ev.n === "number" && Number.isFinite(ev.n) ? ev.n : null,
        // The browser's clock, to the millisecond: it orders this tab's events; the server's own timestamp is the line's.
        clientAt: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null,
        event: ev.e,
        data: data ?? null,
      })
    );
  }
  return lines;
}
