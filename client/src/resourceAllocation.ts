import type { Task } from "./types";

export interface Overlap {
  aId: string;
  bId: string;
  /** Inclusive ISO date range shared by both tasks. */
  from: string;
  to: string;
}

/**
 * Every pair of a person's tasks whose date ranges overlap — a simple, honest
 * model of overallocation: this app has no per-assignment % allocation like MS
 * Project, so any calendar overlap between two of one person's tasks means they'd
 * need to work both at once. O(n²) over one person's tasks, which is small enough
 * in practice (tens, not thousands) that a sweep-line isn't worth the complexity.
 */
export function findOverlaps(tasks: Task[]): Overlap[] {
  const dated = tasks.filter((t) => t.startDate && t.dueDate);
  const overlaps: Overlap[] = [];
  for (let i = 0; i < dated.length; i++) {
    for (let j = i + 1; j < dated.length; j++) {
      const a = dated[i];
      const b = dated[j];
      // ISO YYYY-MM-DD strings compare lexicographically the same as chronologically.
      const from = a.startDate! > b.startDate! ? a.startDate! : b.startDate!;
      const to = a.dueDate! < b.dueDate! ? a.dueDate! : b.dueDate!;
      if (from <= to) overlaps.push({ aId: a.id, bId: b.id, from, to });
    }
  }
  return overlaps;
}
