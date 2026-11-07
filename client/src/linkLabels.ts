/**
 * Jira names each end of a link in English ("blocks" / "is blocked by"). The panel says the same thing in
 * Vietnamese for the stock link types; a type this site added keeps the name it was given.
 */
const VI: Record<string, string> = {
  blocks: "chặn",
  "is blocked by": "bị chặn bởi",
  "relates to": "liên quan đến",
  duplicates: "trùng với",
  "is duplicated by": "bị trùng bởi",
  clones: "sao chép của",
  "is cloned by": "được sao chép bởi",
  causes: "gây ra",
  "is caused by": "do",
};

export function linkLabel(jiraText: string): string {
  return VI[jiraText.trim().toLowerCase()] ?? jiraText;
}
