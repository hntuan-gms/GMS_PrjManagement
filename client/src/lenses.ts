/** The workspace's places and lenses, shared by the header, the rail and the keyboard layer. */

/**
 * "today" is the rail's home page and "settings" the project's settings page; the other four are lenses on one
 * plan. The timesheet is no place of its own: it is the "Giờ đã ghi" mode of the Nhân lực lens.
 */
export type WorkspaceView = "today" | "gantt" | "board" | "resource" | "report" | "settings";

/** The three ways to look at the same people: planned load, hours logged, skills. */
export type ResourceMode = "load" | "ts" | "skills";
export const RESOURCE_MODES: ResourceMode[] = ["load", "ts", "skills"];

const VIEW_IDS: WorkspaceView[] = ["today", "gantt", "board", "resource", "report", "settings"];

/**
 * Reads a `?view=` value or a remembered one. "plan" is the old name of the plan lens, and "timesheet"
 * (links, saved values, e2e) now means Nhân lực in its "Giờ đã ghi" mode.
 */
export function parseView(raw: string | null | undefined): { view: WorkspaceView; resourceMode?: ResourceMode } | null {
  if (!raw) return null;
  if (raw === "plan") return { view: "gantt" };
  if (raw === "timesheet") return { view: "resource", resourceMode: "ts" };
  return (VIEW_IDS as string[]).includes(raw) ? { view: raw as WorkspaceView } : null;
}

export const LENSES: Array<{ id: WorkspaceView; label: string; key: string }> = [
  { id: "gantt", label: "Kế hoạch", key: "1" },
  { id: "board", label: "Bảng", key: "2" },
  { id: "resource", label: "Nhân lực", key: "3" },
  { id: "report", label: "Nhịp dự án", key: "4" },
];

export type SyncState =
  | { kind: "ok"; at: string | null }
  | { kind: "reading" }
  | { kind: "limited"; minutes: number }
  | { kind: "error"; message: string };

