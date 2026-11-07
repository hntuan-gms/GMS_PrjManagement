/**
 * What the task panel asks Jira for, kept in memory so the next open shows it at once.
 *
 * Opening a task used to send about eleven requests, five of them lists that belong to the whole project
 * (priorities, labels, components, versions, issue types), and every box said "Đang tải…" until its own
 * answer came. Now an answer already held is shown the moment the panel opens and is read again behind it
 * (stale-while-revalidate), the project's lists are read once for ten minutes, and `prefetchTaskDetail`
 * starts a task's reads when its row is selected, a beat before the double-click that opens it.
 *
 * Memory only, never storage: descriptions and comments are what a person may see by Jira's permissions,
 * and this must not outlive the tab. The scope (site + account + project, like viewCache) is set by the
 * workspace; another scope starts empty, and logout clears everything.
 */

interface Entry {
  value?: unknown;
  /** When `value` arrived, ms. */
  at: number;
  /** The read in flight, shared by everyone who asks meanwhile. */
  inflight?: Promise<unknown>;
}

const store = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
let scope = "";

/** A project's own lists (priorities, labels…) change rarely, and each costs a Jira call. */
export const LIST_MAX_AGE_MS = 10 * 60_000;
/** One task's reads: reopening within this window shows the held answer and asks nothing. */
export const TASK_MAX_AGE_MS = 20_000;

const MAX_ENTRIES = 400;

const keyOf = (kind: string, id: string) => `${kind}|${id}`;

export function setDetailScope(next: string): void {
  if (next === scope) return;
  scope = next;
  store.clear();
}

export function clearDetailCache(): void {
  store.clear();
  scope = "";
}

/** The held answer, or undefined. Never starts a read. */
export function peekDetail<T>(kind: string, id = ""): T | undefined {
  return store.get(keyOf(kind, id))?.value as T | undefined;
}

export function detailAge(kind: string, id = "", now = Date.now()): number {
  const e = store.get(keyOf(kind, id));
  return e && e.value !== undefined ? now - e.at : Infinity;
}

/** Replace what is held (a write the panel made itself) and tell whoever shows it. */
export function putDetail<T>(kind: string, id: string, value: T): void {
  const k = keyOf(kind, id);
  const prev = store.get(k);
  store.delete(k);
  store.set(k, { value, at: Date.now(), inflight: prev?.inflight });
  trim();
  listeners.get(k)?.forEach((fn) => fn());
}

/** Forget one answer, so the next ask reads Jira. */
export function dropDetail(kind: string, id = ""): void {
  store.delete(keyOf(kind, id));
}

/** Forget everything held about one task (it changed in a way its reads show: status, attachments…). */
export function dropTaskDetail(id: string): void {
  for (const k of [...store.keys()]) if (k.endsWith(`|${id}`)) store.delete(k);
}

function trim(): void {
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value as string;
    store.delete(oldest);
  }
}

/**
 * Read `kind`/`id` unless it is held and young enough. Concurrent callers share one request, and a failed
 * read leaves the held answer (if any) in place. Resolves with the freshest answer there is.
 */
export function loadDetail<T>(kind: string, id: string, fetcher: () => Promise<T>, maxAgeMs: number): Promise<T> {
  const k = keyOf(kind, id);
  const held = store.get(k);
  // Strictly younger: a max age of 0 means "read again", even within the same millisecond.
  if (held?.value !== undefined && Date.now() - held.at < maxAgeMs) return Promise.resolve(held.value as T);
  if (held?.inflight) return held.inflight as Promise<T>;
  const mine = scope;
  const p = fetcher().then(
    (value) => {
      // The panel moved to another project while this was out: the answer belongs to a scope that is gone.
      if (mine !== scope) return value;
      const cur = store.get(k);
      store.delete(k);
      store.set(k, { value, at: Date.now() });
      trim();
      if (!cur || cur.value !== value) listeners.get(k)?.forEach((fn) => fn());
      return value;
    },
    (e) => {
      const cur = store.get(k);
      if (cur) store.set(k, { value: cur.value, at: cur.at });
      throw e;
    }
  );
  const base = held ?? { at: 0 };
  store.set(k, { ...base, inflight: p });
  return p;
}

/** Tell `fn` when `kind`/`id` changes (a read landed, or `putDetail`). Returns the way to stop. */
export function subscribeDetail(kind: string, id: string, fn: () => void): () => void {
  const k = keyOf(kind, id);
  let set = listeners.get(k);
  if (!set) listeners.set(k, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(k);
  };
}
