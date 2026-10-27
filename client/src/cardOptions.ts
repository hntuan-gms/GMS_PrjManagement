import type { BoardIssue } from "./types";
import { canonicalIssueType, priorityTone } from "./boardModel";

/**
 * What a board card shows and how it is tinted — Jira's "Card layout" and "Card colors" for this
 * app's own board. Remembered per board in this browser (nothing here is Jira's data), like which
 * columns are folded.
 *
 * Pure and React-free so the rules are testable: which fields are on by default, which colour an
 * issue gets under each scheme, and how sub-tasks are grouped under their parent.
 */

export type CardField = "type" | "key" | "priority" | "estimate" | "due" | "assignee" | "epic" | "labels" | "versions" | "subtasks";

export type CardColorBy = "none" | "priority" | "type" | "epic" | "assignee";

export interface CardOptions {
  fields: Record<CardField, boolean>;
  colorBy: CardColorBy;
  /** Hide a sub-task's own card while its parent card is on screen (it is listed on the parent). */
  mergeSubtasks: boolean;
}

export const CARD_FIELDS: Array<{ id: CardField; label: string }> = [
  { id: "type", label: "Loại việc" },
  { id: "key", label: "Mã" },
  { id: "priority", label: "Độ ưu tiên" },
  { id: "estimate", label: "Ước lượng" },
  { id: "due", label: "Hạn" },
  { id: "assignee", label: "Người phụ trách" },
  { id: "epic", label: "Epic" },
  { id: "labels", label: "Nhãn" },
  { id: "versions", label: "Phiên bản" },
  { id: "subtasks", label: "Sub-task" },
];

export const COLOR_SCHEMES: Array<{ id: CardColorBy; label: string }> = [
  { id: "none", label: "Không tô màu" },
  { id: "priority", label: "Theo độ ưu tiên" },
  { id: "type", label: "Theo loại việc" },
  { id: "epic", label: "Theo Epic" },
  { id: "assignee", label: "Theo người phụ trách" },
];

/** What a card showed before this was configurable, plus the sub-task line (it only appears when there are any). */
export const DEFAULT_CARD_OPTIONS: CardOptions = {
  fields: {
    type: true,
    key: true,
    priority: true,
    estimate: true,
    due: true,
    assignee: true,
    epic: true,
    labels: false,
    versions: false,
    subtasks: true,
  },
  colorBy: "none",
  mergeSubtasks: false,
};

const storageKey = (boardKey: string) => `gms.board.cardOptions.${boardKey}`;

/** Whatever was stored, laid over the defaults, so a field added later starts at its default. */
export function parseCardOptions(raw: unknown): CardOptions {
  const out: CardOptions = { ...DEFAULT_CARD_OPTIONS, fields: { ...DEFAULT_CARD_OPTIONS.fields } };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (r.fields && typeof r.fields === "object") {
    for (const { id } of CARD_FIELDS) {
      const v = (r.fields as Record<string, unknown>)[id];
      if (typeof v === "boolean") out.fields[id] = v;
    }
  }
  if (COLOR_SCHEMES.some((c) => c.id === r.colorBy)) out.colorBy = r.colorBy as CardColorBy;
  if (typeof r.mergeSubtasks === "boolean") out.mergeSubtasks = r.mergeSubtasks;
  return out;
}

export function readCardOptions(boardKey: string): CardOptions {
  try {
    const raw = localStorage.getItem(storageKey(boardKey));
    return parseCardOptions(raw ? JSON.parse(raw) : null);
  } catch {
    return parseCardOptions(null);
  }
}

export function writeCardOptions(boardKey: string, options: CardOptions): void {
  try {
    localStorage.setItem(storageKey(boardKey), JSON.stringify(options));
  } catch {
    // Private mode: the choice just isn't remembered.
  }
}

/** True when anything differs from the defaults — what lights the toolbar button. */
export function isCustomized(o: CardOptions): boolean {
  return (
    o.colorBy !== DEFAULT_CARD_OPTIONS.colorBy ||
    o.mergeSubtasks !== DEFAULT_CARD_OPTIONS.mergeSubtasks ||
    CARD_FIELDS.some(({ id }) => o.fields[id] !== DEFAULT_CARD_OPTIONS.fields[id])
  );
}

/* ----------------------------------------------------------------- colours */

// Hues for "by Epic / by person": fixed saturation and lightness, only the hue varies, so any two
// neighbours still look like one matched set (the same reasoning as the Gantt's bar palette).
const HUES = [4, 18, 32, 155, 172, 189, 206, 223, 250, 271, 291, 315, 335, 352];

export function hueOf(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return HUES[hash % HUES.length];
}

const TYPE_COLOR: Record<ReturnType<typeof canonicalIssueType>, string> = {
  Bug: "var(--color-danger)",
  Story: "var(--color-success)",
  Epic: "hsl(271 55% 52%)",
  "Sub-task": "var(--color-text-muted)",
  Task: "var(--color-primary)",
};

/** The accent colour of a card's left edge under a scheme, or null for none (also: no Epic / no owner). */
export function cardAccent(issue: BoardIssue, colorBy: CardColorBy): string | null {
  switch (colorBy) {
    case "priority": {
      const tone = priorityTone(issue.priority);
      return tone === "high" ? "var(--color-danger)" : tone === "mid" ? "var(--color-warning)" : tone === "low" ? "var(--color-primary)" : null;
    }
    case "type":
      return TYPE_COLOR[canonicalIssueType(issue.issueType)];
    case "epic":
      return issue.epicKey ? `hsl(${hueOf(issue.epicKey)} 60% 50%)` : null;
    case "assignee":
      return issue.assigneeAccountId ? `hsl(${hueOf(issue.assigneeAccountId)} 60% 50%)` : null;
    default:
      return null;
  }
}

/* ---------------------------------------------------------------- sub-tasks */

/** Sub-tasks grouped under their parent's key, in board order. */
export function subtasksByParent(issues: BoardIssue[]): Map<string, BoardIssue[]> {
  const out = new Map<string, BoardIssue[]>();
  for (const i of issues) {
    if (!i.subtask || !i.parentKey) continue;
    const list = out.get(i.parentKey) ?? [];
    list.push(i);
    out.set(i.parentKey, list);
  }
  return out;
}

export function subtaskProgress(children: BoardIssue[]): { done: number; total: number } {
  return { done: children.filter((c) => c.statusCategory === "done").length, total: children.length };
}

/**
 * With `merge` on, a sub-task whose parent is also being shown drops out of the list — it is on
 * the parent's card. One whose parent is filtered away or in another column set stays, so no work
 * silently disappears from the board.
 */
export function withoutMergedSubtasks(shown: BoardIssue[], merge: boolean): BoardIssue[] {
  if (!merge) return shown;
  const keys = new Set(shown.map((i) => i.key));
  return shown.filter((i) => !(i.subtask && i.parentKey && keys.has(i.parentKey)));
}
