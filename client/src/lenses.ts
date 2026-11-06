/** The workspace's places and lenses, shared by the header, the rail and the keyboard layer. */

/** "today" and "timesheet" are places on the rail; the other four are lenses on one plan. */
export type WorkspaceView = "today" | "gantt" | "board" | "timesheet" | "resource" | "report";

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

