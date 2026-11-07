import type { DependencyType, Predecessor } from "./types";

/*
 * Predecessors as one line of text ("5FS+2, 7SS") and back (plan C5/D3). Pure. A bare number is a key
 * of this project, so the project prefix never has to be typed; a full key is accepted when it belongs
 * to the same project (the server refuses cross-project edges, so the text refuses them first).
 */

export type ParsePredecessors = { ok: true; predecessors: Predecessor[] } | { ok: false; error: string };

const TYPES: DependencyType[] = ["FS", "SS", "FF", "SF"];
// [KEY-]number [type] [+/-lag] [d|n]
const PIECE = /^(?:([A-Za-z][A-Za-z0-9_]*)-)?(\d+)\s*(fs|ss|ff|sf)?\s*(?:([+-])\s*(\d+))?\s*(?:d|n)?$/i;

const cleanPrefix = (p: string) => p.trim().replace(/-+$/, "").toUpperCase();

/**
 * "5", "DEMO-5", "5FS+2", "5ss-1" or several joined by commas. Empty text is an empty list. The first
 * piece that cannot be read, points outside the project or repeats an earlier task is named in the error.
 */
export function parsePredecessors(text: string, keyPrefix: string): ParsePredecessors {
  const prefix = cleanPrefix(keyPrefix);
  const pieces = text
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: Predecessor[] = [];
  for (const piece of pieces) {
    const m = PIECE.exec(piece);
    if (!m) return { ok: false, error: `Không đọc được “${piece}”. Viết như 5, DEMO-5, 5FS+2.` };
    const [, project, num, type, sign, lag] = m;
    if (project && prefix && project.toUpperCase() !== prefix) {
      return { ok: false, error: `“${piece}” thuộc dự án khác. Chỉ nối được việc trong ${prefix}.` };
    }
    const taskId = `${prefix}-${Number(num)}`;
    if (out.some((p) => p.taskId === taskId)) return { ok: false, error: `“${piece}” bị lặp.` };
    out.push({
      taskId,
      type: (type ? type.toUpperCase() : "FS") as DependencyType,
      lagDays: lag ? (sign === "-" ? -1 : 1) * Number(lag) : 0,
    });
  }
  return { ok: true, predecessors: out };
}

/** `[{DEMO-5, FS, 2}, {DEMO-7, SS, 0}]` → "5FS+2, 7SS": the key prefix dropped, the lag only when set. */
export function formatPredecessors(list: readonly Predecessor[]): string {
  return list
    .map((p) => {
      const num = p.taskId.includes("-") ? p.taskId.slice(p.taskId.lastIndexOf("-") + 1) : p.taskId;
      const type = TYPES.includes(p.type) ? p.type : "FS";
      const lag = p.lagDays ? `${p.lagDays > 0 ? "+" : "-"}${Math.abs(p.lagDays)}` : "";
      return `${num}${type}${lag}`;
    })
    .join(", ");
}
