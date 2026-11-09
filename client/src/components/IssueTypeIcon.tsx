import type { IssueTypeName } from "../types";
import { issueTypeLook } from "../issueTypeLook";

/**
 * Issue type glyphs: one stroke set. The type is the shape; the real Jira name is the <title>.
 * Three kinds are tinted so they can be told apart while scanning (`issueTypeLook`): bugs red,
 * "Issue" orange, Task and Sub-task blue (`--type-*` tokens). An Epic gets the darker ink
 * because it is a container the eye should find; Story and unknown types stay in quiet ink.
 *
 * Drawn on a 16px grid, 1.5px strokes, round caps — the same rules as Icons.tsx.
 */
const PATHS: Record<IssueTypeName, string> = {
  // A lightning bolt: the container that carries a phase.
  Epic: "M8.9 1.8 3.8 9h3.6l-.9 5.2 5.3-7.4H8.2z",
  // A bookmark.
  Story: "M4.5 2.5h7v11l-3.5-2.4-3.5 2.4z",
  // A checked box.
  Task: "M3 3h10v10H3z M5.6 8.1l1.7 1.7 3.2-3.4",
  // A beetle: body, head and legs.
  Bug: "M5.2 6.2a2.8 2.8 0 0 1 5.6 0v3.6a2.8 2.8 0 0 1-5.6 0z M6.3 4.1 5 2.8 M9.7 4.1 11 2.8 M5.2 7.6H2.8 M13.2 7.6h-2.4 M5.2 10H3.2 M12.8 10h-2 M8 6.6v5.6",
  // A box with a branch going down into it: work under another.
  "Sub-task": "M3.5 2.5v5.5h4 M7.5 5.5h5v7h-5z",
};

/**
 * `IssueTypeName` is a hard-coded union but the value is not: taskService maps
 * Jira's own name through with an unchecked cast, so a team-managed or localised project
 * delivers names this map has never seen ("Nhiệm vụ", "Improvement"…). Indexing PATHS
 * directly returned undefined for those once and blanked the whole app (a throw during a
 * row's render unmounts the tree). Unknown types get a neutral glyph instead, and the real
 * name still reaches the user through the <title> tooltip.
 */
const UNKNOWN = "M3 3h10v10H3z M5.5 6.2h5 M5.5 8.4h5 M5.5 10.6h3";

export default function IssueTypeIcon({ type, label, size = 16 }: { type: string; label?: string; size?: number }) {
  const { glyph, tone } = issueTypeLook(type, label);
  const path = glyph ? PATHS[glyph] : UNKNOWN;
  const epic = type === "Epic";
  return (
    <svg
      className={`issue-icon${epic ? " is-epic" : ""}${tone ? ` is-${tone}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-type={type}
    >
      <title>{label ?? type}</title>
      <path d={path} />
    </svg>
  );
}
