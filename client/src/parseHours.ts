import { isAssignableType, type Task, type WorklogEntry } from "./types";

/*
 * Typing hours straight into a Giờ đã ghi cell (plan F5). Pure and React-free so the forms people
 * actually type are tested: "4", "1.5", "1,5", "2h", "2h30", "2:30", "90m", "45p".
 */

export const MAX_HOURS_PER_ENTRY = 24;

/** Hours for what was typed, rounded to 1/100 h, or null when it is not a duration worth logging (0, over 24, text). */
export function parseHours(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/,/g, ".").replace(/\s+/g, "");
  if (!s) return null;
  let hours: number | null = null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d+(?:\.\d+)?|\.\d+)(?:h|g)?$/.exec(s))) {
    hours = Number(m[1]);
  } else if ((m = /^(\d+)(?:h|g|:)(\d{1,2})(?:m|p)?$/.exec(s))) {
    if (Number(m[2]) >= 60) return null;
    hours = Number(m[1]) + Number(m[2]) / 60;
  } else if ((m = /^(\d+(?:\.\d+)?)(?:m|p|ph)$/.exec(s))) {
    hours = Number(m[1]) / 60;
  }
  if (hours === null || !Number.isFinite(hours)) return null;
  hours = Math.round(hours * 100) / 100;
  return hours > 0 && hours <= MAX_HOURS_PER_ENTRY ? hours : null;
}

/**
 * The tasks a person is offered to log against, in the order they are most likely meant: the one they
 * logged against last, then their own work in progress, then the rest of their own open work, then
 * everything else. Epics are containers and take no time. The picker keeps this order for an empty
 * search (finished work still sinks to the bottom there).
 */
export function orderTasksForLogging(
  tasks: readonly Task[],
  me: string,
  entries: ReadonlyArray<Pick<WorklogEntry, "issueKey" | "date" | "mine">>
): Task[] {
  let last: string | null = null;
  let lastDate = "";
  for (const e of entries) {
    if (e.mine && e.date >= lastDate) {
      last = e.issueKey;
      lastDate = e.date;
    }
  }
  const rank = (t: Task) => {
    if (t.id === last) return 0;
    if (t.assigneeAccountId === me && t.statusCategory === "indeterminate") return 1;
    if (t.assigneeAccountId === me && t.statusCategory !== "done") return 2;
    return 3;
  };
  return tasks
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => isAssignableType(t.issueType))
    .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
    .map(({ t }) => t);
}
