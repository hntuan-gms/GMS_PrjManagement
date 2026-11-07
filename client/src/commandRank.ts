import { fold } from "./csvImport";

/**
 * The order of Ctrl K's search results, tasks and commands together. One list, one ladder:
 *
 *   0 the task key is exactly what was typed
 *   1 the task key starts with it
 *   2 a command whose label starts with it
 *   3 every word found as typed, diacritics included ("nháp" is in "bản nháp", not in "đăng nhập")
 *   4 every word found with diacritics ignored
 *
 * Same step: commands before tasks (a command is what a verb in the box usually means), then
 * unfinished tasks before finished ones, then the order they came in. Typing "nháp" used to open
 * the task "Dựng API đăng nhập" because folded, both matched and tasks were listed first.
 */
export interface RankTask {
  id: string;
  summary: string;
  assigneeName?: string | null;
  statusCategory?: string;
}
export interface RankCommand {
  label: string;
  aliases?: string;
  group: string;
}
export type Ranked<T extends RankTask, C extends RankCommand> = { kind: "task"; task: T } | { kind: "command"; cmd: C };

export function rankSearch<T extends RankTask, C extends RankCommand>(
  query: string,
  tasks: T[],
  commands: C[],
  taskLimit = 8
): Array<Ranked<T, C>> {
  const q = query.trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  const fq = fold(q);
  const wordsExact = lower.split(/\s+/).filter(Boolean);
  const wordsFolded = fq.split(" ").filter(Boolean);
  const upper = q.toUpperCase();

  const scored: Array<{ item: Ranked<T, C>; score: number; order: number; done: boolean }> = [];
  let order = 0;
  for (const task of tasks) {
    const key = task.id.toUpperCase();
    const text = `${task.id} ${task.summary} ${task.assigneeName ?? ""}`;
    let score: number | null = null;
    if (key === upper) score = 0;
    else if (key.startsWith(upper)) score = 1;
    else if (wordsExact.every((w) => text.toLowerCase().includes(w))) score = 3;
    else if (wordsFolded.every((w) => fold(text).includes(w))) score = 4;
    if (score !== null) scored.push({ item: { kind: "task", task }, score, order: order++, done: task.statusCategory === "done" });
  }
  // Only the best tasks count against the limit, so a long project cannot push the commands out.
  const tasksKept = scored.sort(rankOrder).slice(0, taskLimit);
  const all = [...tasksKept];
  for (const cmd of commands) {
    // Typed with accents, the label must start with exactly that ("nháp" is not "Nhập…"); without, accents are ignored.
    const startsWith = fq !== lower ? cmd.label.toLowerCase().startsWith(lower) : fold(cmd.label).startsWith(fq);
    const text = `${cmd.label} ${cmd.aliases ?? ""} ${cmd.group}`;
    let score: number | null = null;
    if (startsWith) score = 2;
    else if (wordsExact.every((w) => text.toLowerCase().includes(w))) score = 3;
    else if (wordsFolded.every((w) => fold(text).includes(w))) score = 4;
    if (score !== null) all.push({ item: { kind: "command", cmd }, score, order: order++, done: false });
  }
  return all.sort(rankOrder).map((s) => s.item);
}

function rankOrder(
  a: { item: { kind: string }; score: number; order: number; done: boolean },
  b: { item: { kind: string }; score: number; order: number; done: boolean }
): number {
  if (a.score !== b.score) return a.score - b.score;
  if (a.item.kind !== b.item.kind) return a.item.kind === "command" ? -1 : 1;
  if (a.done !== b.done) return Number(a.done) - Number(b.done);
  return a.order - b.order;
}
