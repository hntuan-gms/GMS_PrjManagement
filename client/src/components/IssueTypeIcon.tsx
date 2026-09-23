import type { IssueTypeName } from "../types";

/**
 * Jira-style issue type glyphs: a small rounded, coloured square per type (same
 * colour-coding Jira itself uses — purple Epic, green Story, blue Task/Sub-task,
 * red Bug) with a simple white icon, drawn inline rather than pulled from Jira's
 * own icon set (which isn't ours to ship).
 */
const CONFIG: Record<IssueTypeName, { fill: string; path: string }> = {
  Epic: {
    fill: "#904ee2",
    path: "M8.6 2.2 3.9 8.6h2.7l-1 5.2 5.5-7h-2.9z",
  },
  Story: {
    fill: "#65ba43",
    path: "M4 2.8h8v10.4l-4-2.6-4 2.6z",
  },
  Task: {
    fill: "#4bade8",
    path: "M4.3 8.3l2.3 2.3 5.1-5.1 1 1-6.1 6.1-3.3-3.3z",
  },
  Bug: {
    fill: "#e5493a",
    path:
      "M8 3.2c1.1 0 2 .8 2.2 1.8h1.4l-1.1 1.3c.2.4.3.9.3 1.3v.2h1.6v1.2h-1.6c-.1 1-.5 1.9-1.1 2.5l1.1 1.1-.9.9-1.2-1.2c-.4.2-.9.3-1.4.3s-1-.1-1.4-.3l-1.2 1.2-.9-.9 1.1-1.1c-.6-.6-1-1.5-1.1-2.5H2.2V7.8h1.6v-.2c0-.5.1-.9.3-1.3L3 5h1.4c.2-1 1.1-1.8 2.2-1.8z",
  },
  "Sub-task": {
    fill: "#4bade8",
    path: "M4 3.5h2v2H4.8v3.8H8v-1.3l3 2.3-3 2.3v-1.3H3.5V5.5H4z",
  },
};

/**
 * `IssueTypeName` is a hard-coded union but the value is not: taskService maps
 * Jira's own name through with an unchecked cast (`f.issuetype?.name as
 * IssueTypeName`), so a team-managed or localised project delivers names this
 * map has never seen — "Nhiệm vụ", "Improvement", "New Feature", anything an
 * admin renamed. Indexing CONFIG directly returned undefined for those and threw
 * on the next property read, which blanked the entire app: this renders inside
 * every WBS row, and a throw during render unmounts the whole tree.
 *
 * Unknown types get a neutral glyph instead. The real Jira name still reaches
 * the user through the <title> tooltip, so an unrecognised type is visibly
 * "something else" rather than silently mislabelled as one of the five known ones.
 */
const UNKNOWN = { fill: "#6b778c", path: "M4.2 4.4h7.6v1.7H4.2zm0 3h7.6v1.7H4.2zm0 3h4.8v1.7H4.2z" };

export default function IssueTypeIcon({ type }: { type: string }) {
  const cfg = CONFIG[type as IssueTypeName] ?? UNKNOWN;
  return (
    <svg className="issue-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <title>{type}</title>
      <rect width="16" height="16" rx="3.5" fill={cfg.fill} />
      <path d={cfg.path} fill="#fff" />
    </svg>
  );
}
