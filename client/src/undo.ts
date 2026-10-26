import type { Task } from "./types";

/**
 * Undo for what a drag does to the plan — a bar moved or resized (which may push
 * other bars through the dependency cascade) or a % changed — within this session.
 *
 * It restores by writing the old values back through the same PATCH a drag uses,
 * not by replaying the move in reverse: the cascade then pulls back whatever it
 * pushed, and anything it does not undo on its own is written explicitly. Nothing
 * here knows about the network; the caller applies steps one at a time and asks for
 * the next from the state that results (see ProjectWorkspace.undo).
 *
 * Deliberately NOT covered: edits made in the modal, bulk edits, status and
 * assignee changes. Those are Jira writes with side effects beyond dates (a
 * transition can notify people), and "undoing" them silently would be a second,
 * surprising write. The button says what it will undo, so the scope is visible.
 */

export interface TaskSnapshot {
  id: string;
  startDate: string | null;
  durationDays: number;
  percentComplete: number;
}

export interface UndoEntry {
  /** What the button offers to undo, e.g. "dời DEMO-5". */
  label: string;
  /** The primary task first, then whatever the cascade moved. */
  before: TaskSnapshot[];
}

export interface UndoPatch {
  startDate?: string | null;
  durationDays?: number;
  percentComplete?: number;
}

export const MAX_UNDO = 20;

export const snapshotOf = (t: Task): TaskSnapshot => ({
  id: t.id,
  startDate: t.startDate,
  durationDays: t.durationDays,
  percentComplete: t.percentComplete,
});

/** The entry for an edit that touched `ids`, from the tasks as they were BEFORE it. Null when none of them still exists. */
export function makeEntry(label: string, before: Task[], ids: string[]): UndoEntry | null {
  const byId = new Map(before.map((t) => [t.id, t]));
  const snaps = [...new Set(ids)].flatMap((id) => {
    const t = byId.get(id);
    return t ? [snapshotOf(t)] : [];
  });
  return snaps.length > 0 ? { label, before: snaps } : null;
}

/** Newest last; the oldest falls off the end of the cap. */
export function pushEntry(stack: UndoEntry[], entry: UndoEntry): UndoEntry[] {
  return [...stack, entry].slice(-MAX_UNDO);
}

/**
 * What still has to be written to bring `current` back to the entry's snapshot, in
 * order. A task already at its old values (the cascade pulled it back on its own),
 * or one that no longer exists, produces nothing — and schedule fields travel
 * together, because the server derives the due date from start + duration.
 */
export function undoSteps(entry: UndoEntry, current: Task[]): Array<{ id: string; patch: UndoPatch }> {
  const byId = new Map(current.map((t) => [t.id, t]));
  const steps: Array<{ id: string; patch: UndoPatch }> = [];
  for (const s of entry.before) {
    const t = byId.get(s.id);
    if (!t) continue;
    const patch: UndoPatch = {};
    if (t.startDate !== s.startDate || t.durationDays !== s.durationDays) {
      patch.startDate = s.startDate;
      patch.durationDays = s.durationDays;
    }
    if (t.percentComplete !== s.percentComplete) patch.percentComplete = s.percentComplete;
    if (Object.keys(patch).length > 0) steps.push({ id: s.id, patch });
  }
  return steps;
}
