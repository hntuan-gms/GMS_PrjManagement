import type { Task } from "./types";

/**
 * The colour of a status lozenge in the WBS table, the way Jira draws one: the whole name on a tinted
 * background. The team's mapping, by the workflow's own status name:
 *   Closed, Done, Reject, Cancel → green · In Progress, Resolved → yellow · Open → grey · Reopen, Pending → orange.
 * Names are compared folded (case, spaces, hyphens, diacritics removed), so "In-Progress", "IN PROGRESS"
 * and "Inprogress" are one name, and "Rejected"/"Cancelled"/"Reopened" match their stems. A name the
 * mapping does not list follows its Jira category: done → green, in progress → yellow, to do → grey.
 */
export type StatusTone = "green" | "yellow" | "grey" | "orange";

function fold(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function statusTone(category: Task["statusCategory"], name?: string): StatusTone {
  const k = name ? fold(name) : "";
  // "reopen" before "open": the one is a word inside the other.
  if (k.startsWith("reopen") || k === "pending") return "orange";
  if (k === "closed" || k === "close" || k === "done" || k.startsWith("reject") || k.startsWith("cancel")) return "green";
  if (k === "inprogress" || k.startsWith("resolve")) return "yellow";
  if (k === "open") return "grey";
  if (category === "done") return "green";
  if (category === "indeterminate") return "yellow";
  return "grey";
}
