import { issueTypeLook } from "../issueTypeLook";

/**
 * Issue type glyphs: one stroke set, one drawing per kind of issue, chosen from the real Jira
 * name by `issueTypeLook` (which holds the drawings and says which kinds are tinted: bugs red,
 * Issue orange, Task and Sub-task blue, Epic purple). The real name is the <title>.
 *
 * Never index a map by `type` here: the value is Jira's own name behind an unchecked cast, and
 * a lookup that returned undefined for a localised type once blanked the whole app (a throw
 * during a row's render unmounts the tree). `issueTypeLook` always returns a drawing.
 */
export default function IssueTypeIcon({ type, label, size = 16 }: { type: string; label?: string; size?: number }) {
  const { path, tone } = issueTypeLook(type, label);
  return (
    <svg
      className={`issue-icon${tone ? ` is-${tone}` : ""}`}
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
