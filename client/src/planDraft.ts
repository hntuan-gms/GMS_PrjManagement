import { computeOptimisticCascade } from "./dependencyCascade";
import type { Task } from "./types";

/*
 * "Bản nháp kế hoạch" (plan §3.2 F1, §6.1.6): move bars around without writing to Jira, see what
 * the cascade does, then apply — or drop it. Jira has no notion of trying a schedule out: every
 * drag there is a write and a notification.
 *
 * The draft keeps the plan as it was when the draft began (`base`) and the person's own moves in
 * order (`edits`). What the screen shows is `base` with the edits replayed through the same
 * client-side cascade the optimistic drag already uses (dependencyCascade.computeOptimisticCascade),
 * so the preview is what the server will do. Applying sends only the person's own moves, in order —
 * the server cascades the rest exactly as it would have for a live drag.
 *
 * Pure and tested; ProjectWorkspace holds the state.
 */

export interface DraftEdit {
  id: string;
  startDate: string;
  durationDays: number;
}

export interface PlanDraft {
  /** The plan when the draft began. */
  base: Task[];
  /** The person's moves, in the order made (a task may appear more than once). */
  edits: DraftEdit[];
}

export function startDraft(tasks: Task[]): PlanDraft {
  return { base: tasks, edits: [] };
}

/** One more move; returns the new draft and the plan to show. */
export function addDraftEdit(draft: PlanDraft, shown: Task[], edit: DraftEdit): { draft: PlanDraft; tasks: Task[] } {
  const cascade = computeOptimisticCascade(shown, edit.id, edit.startDate, edit.durationDays);
  return {
    draft: { ...draft, edits: [...draft.edits, edit] },
    tasks: shown.map((t) => cascade.get(t.id) ?? t),
  };
}

/**
 * What to send when applying: the last move of each task, ordered by when that last move was made
 * (a task moved, then moved again after another one, is sent after it).
 */
export function compactEdits(edits: DraftEdit[]): DraftEdit[] {
  const last = new Map<string, number>();
  edits.forEach((e, i) => last.set(e.id, i));
  return edits.filter((e, i) => last.get(e.id) === i);
}

export interface DraftChange {
  id: string;
  summary: string;
  from: { start: string | null; end: string | null };
  to: { start: string | null; end: string | null };
  /** Moved by the person, or pushed along by the cascade. */
  kind: "edited" | "pushed";
}

/** Every task whose dates differ between `base` and `shown`, edited ones first. */
export function draftChanges(draft: PlanDraft, shown: Task[]): DraftChange[] {
  const before = new Map(draft.base.map((t) => [t.id, t]));
  const edited = new Set(draft.edits.map((e) => e.id));
  const out: DraftChange[] = [];
  for (const t of shown) {
    const b = before.get(t.id);
    if (!b) continue;
    if (b.startDate === t.startDate && b.dueDate === t.dueDate) continue;
    out.push({
      id: t.id,
      summary: t.summary,
      from: { start: b.startDate, end: b.dueDate },
      to: { start: t.startDate, end: t.dueDate },
      kind: edited.has(t.id) ? "edited" : "pushed",
    });
  }
  return out.sort((a, b) => Number(a.kind === "pushed") - Number(b.kind === "pushed") || a.id.localeCompare(b.id, "vi", { numeric: true }));
}

/** The plan's last day (latest due date), or null with no dated task. */
export function planEnd(tasks: Task[]): string | null {
  let end: string | null = null;
  for (const t of tasks) if (t.dueDate && (!end || t.dueDate > end)) end = t.dueDate;
  return end;
}

/**
 * Fresh data arrived while drafting (a refresh, another person's change): the draft keeps its moves
 * and replays them on the new plan, so the preview never silently snaps back to Jira's dates.
 */
export function replayDraft(draft: PlanDraft, fresh: Task[]): { draft: PlanDraft; tasks: Task[] } {
  let shown = fresh;
  for (const e of draft.edits) {
    const cascade = computeOptimisticCascade(shown, e.id, e.startDate, e.durationDays);
    shown = shown.map((t) => cascade.get(t.id) ?? t);
  }
  return { draft: { ...draft, base: fresh }, tasks: shown };
}
