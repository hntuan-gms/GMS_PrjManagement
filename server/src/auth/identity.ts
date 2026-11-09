/**
 * Who is signed in, as text — for the assistant's prompt and for the access log.
 *
 * Pure on purpose (no Express, no database) so the two rules that matter can be
 * tested: a display name is typed by the person, so it must never be able to add a
 * line to a log or to the prompt; and the email is not here at all (privacy.html:
 * only the derived `staff` boolean is kept).
 */

export interface Identity {
  accountId: string;
  displayName: string;
}

/** One line, no control characters, bounded. A name is user-controlled text. */
export function cleanName(name: string | null | undefined, max = 80): string {
  // Control characters and U+2028/U+2029 (line and paragraph separators) become spaces, then runs of spaces collapse.
  const spaced = Array.from(name ?? "", (ch) => {
    const c = ch.codePointAt(0)!;
    return c < 32 || c === 127 || c === 0x2028 || c === 0x2029 ? " " : ch;
  }).join("");
  const flat = spaced.split(" ").filter(Boolean).join(" ");
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** What the assistant is told about the person it is talking to. */
export function identityLine(me: Identity | undefined): string | null {
  if (!me?.accountId) return null;
  const name = cleanName(me.displayName);
  return name ? `${name} — ${me.accountId}` : `(không rõ tên) — ${me.accountId}`;
}

export interface AccessEntry {
  method: string;
  /** Path only. A query string can carry JQL or filter text; the log has no use for it. */
  path: string;
  status: number;
  ms: number;
  projectKey: string | null;
}

/**
 * One structured line per authenticated request. Cloud Run turns a JSON line on
 * stdout into `jsonPayload`, so `jsonPayload.accountId="…"` filters in Logs Explorer
 * and `message` still reads as a sentence.
 */
export function accessLogLine(who: Identity, e: AccessEntry): string {
  const name = cleanName(who.displayName);
  return JSON.stringify({
    severity: e.status >= 500 ? "ERROR" : "INFO",
    message: `[access] ${name || who.accountId} ${e.method} ${e.path} ${e.status} ${e.ms}ms${e.projectKey ? ` ${e.projectKey}` : ""}`,
    kind: "access",
    accountId: who.accountId,
    userName: name,
    method: e.method,
    path: e.path,
    status: e.status,
    ms: e.ms,
    projectKey: e.projectKey,
  });
}

/** Written once per successful login, so "who signed in today" is one filter. */
export function loginLogLine(who: Identity, extra: { staff: boolean; siteName: string }): string {
  const name = cleanName(who.displayName);
  return JSON.stringify({
    severity: "NOTICE",
    message: `[login] ${name || who.accountId}`,
    kind: "login",
    accountId: who.accountId,
    userName: name,
    staff: extra.staff,
    site: cleanName(extra.siteName),
  });
}
