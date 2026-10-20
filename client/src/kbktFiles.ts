/**
 * File-level rules of the KBKT import that the dialog needs before (or without)
 * asking the server — kept React-free so they can be tested. The server applies
 * the same rules (server/src/kbkt/specs.ts); this copy only decides what the
 * dialog pre-fills and which file of a code it uploads.
 */

/** "AI-33_1E127_….xlsx" → "AI-33". "AI-xx_…" has no Story yet → null. */
export function storyKeyFromFileName(fileName: string): string | null {
  const m = /^([A-Za-z][A-Za-z0-9]*-\d+)_/.exec(fileName.split(/[/\\]/).pop() ?? fileName);
  return m ? m[1].toUpperCase() : null;
}

/** "…_v3.xlsx" → 3; no suffix → 0. */
export function fileVersion(fileName: string): number {
  const m = /_v(\d+)\.xlsx$/i.exec(fileName);
  return m ? Number(m[1]) : 0;
}

/**
 * Which files are superseded: of several workbooks with the same test code, only
 * the highest _vN is imported (ties: the one modified last) — jira_sync.py's
 * pick_files. Returns, per superseded file id, the name of the file that wins.
 */
export function supersededBy(
  files: Array<{ id: string; name: string; code: string | null; lastModified: number }>
): Map<string, string> {
  const best = new Map<string, { id: string; name: string; rank: [number, number] }>();
  for (const f of files) {
    if (!f.code) continue;
    const rank: [number, number] = [fileVersion(f.name), f.lastModified];
    const cur = best.get(f.code);
    if (!cur || rank[0] > cur.rank[0] || (rank[0] === cur.rank[0] && rank[1] > cur.rank[1])) {
      best.set(f.code, { id: f.id, name: f.name, rank });
    }
  }
  const out = new Map<string, string>();
  for (const f of files) {
    const winner = f.code ? best.get(f.code) : undefined;
    if (winner && winner.id !== f.id) out.set(f.id, winner.name);
  }
  return out;
}

/**
 * Sunday of next week, the default due date for new issues (the script's
 * next_week_sunday). Pure date arithmetic on the ISO string, in UTC, so the
 * browser's timezone can't shift it a day (BUG-04).
 */
export function nextWeekSunday(todayIso: string): string {
  const [y, m, d] = todayIso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0 … Sunday = 6
  date.setUTCDate(date.getUTCDate() + 13 - weekday);
  return date.toISOString().slice(0, 10);
}

/** The `story` query parameter: omitted (from the file name), "new", or an explicit key. */
export function storyParam(input: string, fromFileName: string | null): string | undefined {
  const v = input.trim().toUpperCase();
  if (fromFileName && v === fromFileName) return undefined;
  return v || "new";
}
