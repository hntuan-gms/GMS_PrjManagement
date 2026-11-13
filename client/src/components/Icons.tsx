import type { ReactNode } from "react";

export type IconName =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "codeBlock"
  | "heading"
  | "listBullet"
  | "listNumber"
  | "quote"
  | "image"
  | "copy"
  | "stop"
  | "maximize"
  | "restore"
  | "refresh"
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
  | "eyeOff"
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
  | "calendar"
  | "grip"
  | "edit"
  | "sun"
  | "moon"
  | "monitor"
  | "plan"
  | "board"
  | "pulse"
  | "chat"
  | "settings"
  | "keyboard"
  | "dot"
  | "send"
  | "pin"
  | "filter"
  | "paperclip"
  | "menu"
  | "print"
  | "more";

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
  eyeOff: (
    <>
      <path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.4 3.3" />
      <path d="M6.6 6.6C3.6 8.5 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M3 3l18 18" />
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
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
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
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  plan: (
    <>
      <path d="M4 6h9" />
      <path d="M8 12h11" />
      <path d="M6 18h7" />
    </>
  ),
  board: (
    <>
      <rect x="3.5" y="4" width="5" height="16" rx="1.5" />
      <rect x="10.5" y="4" width="5" height="10" rx="1.5" />
      <rect x="17.5" y="4" width="3" height="13" rx="1.5" />
    </>
  ),
  pulse: <path d="M3 12h4l2.5-6 5 12 2.5-6H21" />,
  chat: <path d="M20 15a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" />,
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />,
  send: <path d="M5 12h13M13 6l6 6-6 6" />,
  pin: <path d="M9 4h6l-1 5 3 3H7l3-3-1-5ZM12 15v5" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  bold: <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />,
  italic: <path d="M10 5h8M6 19h8M14 5l-4 14" />,
  strike: <path d="M4 12h16M16.5 7.5C16 5.8 14.3 5 12 5c-2.8 0-4.5 1.3-4.5 3.2 0 1.4.9 2.3 2.7 2.8M7.5 16.2C8 18 9.8 19 12.3 19c2.9 0 4.7-1.3 4.7-3.3" />,
  code: <path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5" />,
  codeBlock: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M10 10l-2.5 2 2.5 2M14 10l2.5 2-2.5 2" />
    </>
  ),
  heading: <path d="M6 5v14M18 5v14M6 12h12" />,
  listBullet: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  listNumber: <path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M3.8 13.5c.3-.6.9-1 1.6-1 .9 0 1.4.6 1.4 1.2 0 1-2.9 2.3-2.9 3.3h3" />,
  quote: <path d="M5 7h5v5c0 2.5-1.5 4.5-4 5M14 7h5v5c0 2.5-1.5 4.5-4 5" />,
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M20.5 16l-5-5-9 8.5" />
    </>
  ),
  paperclip: <path d="M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  print: (
    <>
      <path d="M7 9V3.5h10V9" />
      <rect x="3.5" y="9" width="17" height="8" rx="1.5" />
      <path d="M7 14h10v6.5H7z" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h8" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
  maximize: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  restore: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  refresh: <path d="M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5" />,
  more: (
    <>
      <path d="M6 12h.01" />
      <path d="M12 12h.01" />
      <path d="M18 12h.01" />
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
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
