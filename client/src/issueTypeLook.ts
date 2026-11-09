import type { IssueTypeName } from "./types";

/**
 * What IssueTypeIcon draws for a Jira issue type name: which glyph and which colour.
 *
 * The name is what Jira sends, not the `IssueTypeName` union: sites rename and localise
 * types ("Sub Bug", "Sub-Bug", "Lỗi", "Issue"), so the stock names are matched exactly and
 * the rest by their folded words.
 *
 * Colours (tokens `--type-*` in tokens.css):
 *  - bug   red:    Bug and anything named as a bug (Sub Bug, Lỗi)
 *  - issue orange: the type called "Issue"
 *  - task  blue:   Task and Sub-task (the checked box and the branch)
 * Epic and Story stay ink.
 */
export type IssueTypeTone = "bug" | "issue" | "task" | null;

export interface IssueTypeLook {
  /** A stock glyph, or null for the neutral "unknown type" glyph. */
  glyph: IssueTypeName | null;
  tone: IssueTypeTone;
}

const STOCK: readonly IssueTypeName[] = ["Epic", "Story", "Task", "Bug", "Sub-task"];

function fold(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[\s\-_/]+/g, "");
}

/**
 * `type` picks the glyph (call sites that map through `canonicalIssueType` pass the mapped
 * name); `label` is the real Jira name when it differs, and decides the colour.
 */
export function issueTypeLook(type: string, label?: string): IssueTypeLook {
  const t = fold(type);
  const real = fold(label ?? type);
  const isBug = (n: string) => n.includes("bug") || n.startsWith("loi");

  let glyph: IssueTypeName | null = STOCK.find((s) => s === type) ?? null;
  if (!glyph) {
    if (isBug(t)) glyph = "Bug";
    else if (t === "subtask") glyph = "Sub-task";
    else if (t === "task") glyph = "Task";
  }

  let tone: IssueTypeTone = null;
  if (isBug(real)) tone = "bug";
  else if (real === "issue") tone = "issue";
  else if (glyph === "Task" || glyph === "Sub-task") tone = "task";

  return { glyph, tone };
}
