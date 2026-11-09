/** The workspace's places and lenses, shared by the header, the rail and the keyboard layer. */

/**
 * "today" is the rail's home page, "timesheet" (Clockwork, the hours logged) a place of its own on the rail and
 * "settings" the project's settings page; the other four are lenses on one plan.
 */
export type WorkspaceView = "today" | "gantt" | "board" | "resource" | "report" | "timesheet" | "settings";

/** The two ways to look at the same people on the Resource lens: planned load and skills. */
export type ResourceMode = "load" | "skills";
export const RESOURCE_MODES: ResourceMode[] = ["load", "skills"];

const VIEW_IDS: WorkspaceView[] = ["today", "gantt", "board", "resource", "report", "timesheet", "settings"];

/** Reads a `?view=` value or a remembered one. "plan" is the old name of the plan lens. */
export function parseView(raw: string | null | undefined): { view: WorkspaceView } | null {
  if (!raw) return null;
  if (raw === "plan") return { view: "gantt" };
  return (VIEW_IDS as string[]).includes(raw) ? { view: raw as WorkspaceView } : null;
}

export const LENSES: Array<{ id: WorkspaceView; label: string; key: string }> = [
  { id: "gantt", label: "List", key: "1" },
  { id: "board", label: "Board", key: "2" },
  { id: "resource", label: "Resource", key: "3" },
  { id: "report", label: "Report", key: "4" },
];

export type SyncState =
  | { kind: "ok"; at: string | null }
  | { kind: "reading" }
  | { kind: "limited"; minutes: number }
  | { kind: "error"; message: string };


/** The `?view=` value for a place. */
export function viewParam(view: WorkspaceView): string {
  return view;
}

/** The query string with `view` set to this place and every other parameter (project, report…) kept. */
export function withViewParam(search: string, view: WorkspaceView): string {
  const q = new URLSearchParams(search);
  q.set("view", viewParam(view));
  const s = q.toString();
  return s ? `?${s}` : "";
}
