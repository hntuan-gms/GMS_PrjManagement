/** One page of a Jira endpoint that pages by `startAt` (project/search and its kin). */
export interface StartAtPage<T> {
  values: T[];
  isLast?: boolean;
  total?: number;
}

/**
 * Every page of a startAt-paged list. The first page says how many there are in all, so the rest are asked
 * for together instead of one after another — a user with 300 projects was six round trips in a row (each
 * ~0.15–0.8 s). Without a total, or if the pages together come up short of it, the remainder is read the old
 * way, one page at a time, so nothing is ever silently missing.
 */
export async function readAllPages<T>(readPage: (startAt: number) => Promise<StartAtPage<T>>, maxPages = 20): Promise<T[]> {
  const first = await readPage(0);
  const out = [...first.values];
  if (first.isLast || first.values.length === 0) return out;

  const step = first.values.length;
  if (typeof first.total === "number" && first.total > step) {
    const pages = Math.min(Math.ceil(first.total / step), maxPages);
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => readPage((i + 1) * step)));
    for (const page of rest) out.push(...page.values);
    // A page can come back shorter than asked (what the user may browse is filtered after paging): carry on
    // from what we have until Jira says it is the last page.
    if (out.length >= first.total) return out;
  }

  let startAt = out.length;
  for (let page = 0; page < maxPages; page++) {
    const res = await readPage(startAt);
    out.push(...res.values);
    if (res.isLast || res.values.length === 0) break;
    startAt += res.values.length;
  }
  return out;
}
