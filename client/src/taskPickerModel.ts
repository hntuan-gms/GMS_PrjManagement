import { fold } from "./fold";
import type { Task } from "./types";

/*
 * Which tasks a task picker lists for what was typed (plan 0-2). Pure, so ranking is tested without a
 * browser: a key or title match, no diacritics, open work before finished work, at most 30 rows.
 */

export const TASK_PICK_LIMIT = 30;

export interface TaskPickOptions {
  /** Ids that must not be offered: the task itself, and its descendants when choosing a parent. */
  exclude?: Iterable<string>;
  /** Only tasks this accepts (an Epic or Story as a parent). */
  filter?: (task: Task) => boolean;
  limit?: number;
}

/** Why a task matched, best first. 0 = the key itself ("AI-33", or just "33"). */
function matchScore(task: Task, fq: string, words: string[]): number | null {
  const key = fold(task.id); // "ai 33"
  const num = key.split(" ").pop() ?? "";
  const digits = /^\d+$/.test(fq);
  if (key === fq || (digits && num === fq)) return 0;
  if (key.startsWith(fq) || (digits && num.startsWith(fq))) return 1;
  const title = fold(task.summary);
  const titleWords = title.split(" ");
  if (words.every((w) => titleWords.some((tw) => tw.startsWith(w)))) return 2;
  if (key.includes(fq) || words.every((w) => title.includes(w))) return 3;
  return null;
}

export function rankTasks(tasks: readonly Task[], query: string, opts: TaskPickOptions = {}): Task[] {
  const excluded = new Set(opts.exclude ?? []);
  const limit = opts.limit ?? TASK_PICK_LIMIT;
  const fq = fold(query);
  const words = fq.split(" ").filter(Boolean);

  const rows: Array<{ task: Task; score: number; done: boolean; index: number }> = [];
  tasks.forEach((task, index) => {
    if (excluded.has(task.id)) return;
    if (opts.filter && !opts.filter(task)) return;
    const score = fq ? matchScore(task, fq, words) : 0;
    if (score === null) return;
    rows.push({ task, score, done: task.statusCategory === "done", index });
  });

  // An exact key always leads, even when the task is finished: someone who typed AI-33 wants AI-33.
  // After that open work comes before finished work, then the better match, then the plan's own order.
  const exact = (r: { score: number }) => (fq && r.score === 0 ? 0 : 1);
  rows.sort(
    (a, b) =>
      exact(a) - exact(b) ||
      Number(a.done) - Number(b.done) ||
      a.score - b.score ||
      a.index - b.index
  );
  return rows.slice(0, limit).map((r) => r.task);
}

/** A task and everything beneath it in the WBS: what a parent picker must not offer for that task. */
export function descendantIds(tasks: readonly Task[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const t of tasks) {
    if (!t.wbsParentId) continue;
    const list = children.get(t.wbsParentId) ?? [];
    list.push(t.id);
    children.set(t.wbsParentId, list);
  }
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    for (const c of children.get(stack.pop()!) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
    }
  }
  return out;
}

/** An issue found on Jira by `GET /clockwork/issues`: enough of one to be listed, named and logged on. */
export interface RemoteIssue {
  key: string;
  summary: string;
  issueType: string;
  inProgress?: boolean;
  /** Finished: still found (time is logged after closing), listed after open work. */
  done?: boolean;
}

/** A found issue as the picker's own kind of row. Only what a picker and a name need; not a loaded task. */
export function remoteAsTask(r: RemoteIssue): Task {
  return { id: r.key, summary: r.summary, issueType: r.issueType, statusCategory: r.done ? "done" : r.inProgress ? "indeterminate" : "new" } as unknown as Task;
}

/**
 * Found issues after the ones already in the plan, never twice (a key the plan has is the plan's own row),
 * and never one the caller excluded (rows already on the sheet).
 */
export function mergeRemote(local: readonly Task[], remote: readonly RemoteIssue[], exclude: Iterable<string> = []): Task[] {
  const taken = new Set<string>([...local.map((t) => t.id), ...exclude]);
  const out: Task[] = [];
  for (const r of remote) {
    if (taken.has(r.key)) continue;
    taken.add(r.key);
    out.push(remoteAsTask(r));
  }
  return out;
}
