/**
 * One at a time per key.
 *
 * A schedule write is several Jira calls (the task, then each successor the cascade moves) and takes seconds. Two of
 * them for the same project running side by side interleave: log of 2026-11-12, a page reload cut a request off
 * on the browser's side, the server carried on with it, and the batch the page sent as it left started 4 s later;
 * Jira's history shows the old request pushing GPM-313 to 15/12 at :09.8 and the batch putting it back at :13.0, in
 * between the two cascades' writes. The final dates were right only because the batch happened to write last.
 * Writes of one project now wait for each other, in the order they arrived, so what the last request asks for is
 * what Jira ends up holding.
 *
 * In memory, per process: it covers what one instance serves, which is how the service runs (see "Known constraints").
 */
export function createKeyedMutex() {
  const tails = new Map<string, Promise<void>>();
  return async function run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = tails.get(key) ?? Promise.resolve();
    // After the previous one settles, whichever way it went: a failed write must not block the ones behind it.
    const result = prev.then(() => fn());
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    tails.set(key, tail);
    try {
      return await result;
    } finally {
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}
