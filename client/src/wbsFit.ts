/**
 * What the WBS table keeps when it gets narrow. The name is the only thing that tells one row from another, so
 * it keeps a floor and the columns give way instead: first the ones on the right go (the % and the rest),
 * then the person shrinks to an avatar, then the status to its glyph. Pure, so the order is tested.
 */
export const MIN_NAME_PX = 200;
/** Width of a column cut down to its icon. */
export const COMPACT_WIDTH: Record<string, number> = { assignee: 36, status: 30 };
/** The two that survive to the end, shrunk rather than removed. */
const KEEP = ["status", "assignee"] as const;

export interface FitColumn {
  id: string;
  width: number;
}
export interface Fitted<C extends FitColumn> {
  columns: Array<C & { compact: boolean; fitWidth: number }>;
  /** Total width the shown columns take. */
  width: number;
}

export function fitColumns<C extends FitColumn>(all: C[], available: number): Fitted<C> {
  let shown = [...all];
  const compact = new Set<string>();
  const w = (c: C) => (compact.has(c.id) ? COMPACT_WIDTH[c.id] : c.width);
  const total = () => shown.reduce((s, c) => s + w(c), 0);
  // 1. Drop from the right, never the two that can shrink.
  while (total() > available) {
    let at = -1;
    for (let i = shown.length - 1; i >= 0; i--) {
      if (!(KEEP as readonly string[]).includes(shown[i].id)) {
        at = i;
        break;
      }
    }
    if (at < 0) break;
    shown = shown.filter((_, i) => i !== at);
  }
  // 2. The person is an avatar, then 3. the status is a glyph.
  for (const id of ["assignee", "status"]) {
    if (total() <= available) break;
    if (shown.some((c) => c.id === id)) compact.add(id);
  }
  const columns = shown.map((c) => ({ ...c, compact: compact.has(c.id), fitWidth: w(c) }));
  return { columns, width: columns.reduce((s, c) => s + c.fitWidth, 0) };
}
