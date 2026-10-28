import type { ReactNode } from "react";

export type IconName =
  | "logo"
  | "chevronDown"
  | "chevronLeft"
  | "chevronRight"
  | "search"
  | "plus"
  | "x"
  | "check"
  | "help"
  | "eye"
  | "importExport"
  | "download"
  | "upload"
  | "columns"
  | "critical"
  | "link"
  | "layers"
  | "undo"
  | "collapseAll"
  | "expandAll"
  | "sync"
  | "logout"
  | "user"
  | "users"
  | "lock"
  | "alert"
  | "switch"
  | "external"
  | "trash"
  | "subtask"
  | "info"
  | "chevronUp"
  | "equals"
  | "collapseColumn"
  | "clock"
  | "grip"
  | "edit";

/** One outline family (24 grid, 2px stroke) so the header and toolbar read as a set.
 * Inline rather than an icon package: a few dozen paths isn't worth a dependency, and
 * `IssueTypeIcon` already sets the precedent in this codebase. */
const PATHS: Record<IconName, ReactNode> = {
  logo: (
    <>
      <path d="M4 6h9" />
      <path d="M8 12h12" />
      <path d="M6 18h8" />
    </>
  ),
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  help: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5" />
      <path d="M12 17.5v.01" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  importExport: (
    <>
      <path d="M7 4v16" />
      <path d="M3 8l4-4 4 4" />
      <path d="M17 20V4" />
      <path d="M13 16l4 4 4-4" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v11" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </>
  ),
  upload: (
    <>
      <path d="M12 21V10" />
      <path d="M7 15l5-5 5 5" />
      <path d="M5 3h14" />
    </>
  ),
  columns: (
    <>
      <rect x="3" y="4" width="5" height="16" rx="1.2" />
      <rect x="9.5" y="4" width="5" height="16" rx="1.2" />
      <rect x="16" y="4" width="5" height="16" rx="1.2" />
    </>
  ),
  critical: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h13l-2.5 4L18 12H5" />
    </>
  ),
  link: (
    <>
      <path d="M9 17H7a5 5 0 0 1 0-10h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <path d="M8 12h8" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="M3 16l9 5 9-5" />
      <path d="M3 12l9 5 9-5" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </>
  ),
  collapseAll: (
    <>
      <path d="m7 20 5-5 5 5" />
      <path d="m7 4 5 5 5-5" />
    </>
  ),
  expandAll: (
    <>
      <path d="m7 15 5 5 5-5" />
      <path d="m7 9 5-5 5 5" />
    </>
  ),
  sync: (
    <>
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 21v-5h5" />
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
      <path d="M16 3.1a4 4 0 0 1 0 7.8" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 10v4" />
      <path d="M12 16.8v.1" />
    </>
  ),
  external: (
    <>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </>
  ),
  subtask: (
    <>
      <path d="M6 3v10a3 3 0 0 0 3 3h9" />
      <path d="M15 12l3 4-3 4" />
    </>
  ),
  switch: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-5" />
      <path d="M12 8v.01" />
    </>
  ),
  chevronUp: <path d="M6 15l6-6 6 6" />,
  equals: (
    <>
      <path d="M5 9h14" />
      <path d="M5 15h14" />
    </>
  ),
  collapseColumn: (
    <>
      <path d="M11 17l-5-5 5-5" />
      <path d="M18 17l-5-5 5-5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  grip: (
    <>
      <path d="M9 6v.01" />
      <path d="M15 6v.01" />
      <path d="M9 12v.01" />
      <path d="M15 12v.01" />
      <path d="M9 18v.01" />
      <path d="M15 18v.01" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
      <path d="M13.5 6.5l4 4" />
    </>
  ),
};

/** Decorative by default (`aria-hidden`): every icon here sits beside visible text or
 * inside a control that carries its own `aria-label`. */
export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
