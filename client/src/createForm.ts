import { parseQuickAdd, type QuickAddContext, type QuickAddToken, type QuickAddTokenKind } from "./quickAdd";

/*
 * The create form's name boxes understand the same words as Ctrl K (plan H15): "Dựng API @Chi t6 3n" is a
 * title plus an assignee, a start day and a duration. This is the form's view of quickAdd.parseQuickAdd.
 *
 * The form has one place for each of person, dates, duration, estimate, priority, parent, labels and type,
 * so those words are taken. A dependency ("sau DEMO-5", "trước …") or a sprint ("*tiếp") has no field here
 * (the bulk create has no such input), so the words stay in the title where the person can see them rather
 * than being eaten and never applied. The same goes for a word that matched nobody or several people:
 * the chip says so and the text stays.
 */

/** The kinds of token this form can put into a field. */
export const FORM_TOKEN_KINDS: ReadonlySet<QuickAddTokenKind> = new Set<QuickAddTokenKind>([
  "assignee",
  "date",
  "duration",
  "estimate",
  "priority",
  "parent",
  "label",
  "issueType",
]);

export interface FormFields {
  assigneeAccountId?: string;
  startDate?: string;
  durationDays?: number;
  estimateHours?: number;
  priority?: string;
  parentId?: string;
  labels?: string[];
  issueType?: string;
}

export interface FormLine {
  /** What goes to Jira as the summary: the text without the words that became fields. */
  title: string;
  /** Every recognised word, in order, for the chips; `warn` for one that needs the person's attention. */
  chips: Array<{ kind: QuickAddTokenKind; label: string; warn: boolean }>;
  fields: FormFields;
}

/** The text with the given character ranges taken out, whitespace folded. */
function without(text: string, spans: Array<{ start: number; end: number }>): string {
  let out = text;
  for (const s of [...spans].sort((a, b) => b.start - a.start)) out = out.slice(0, s.start) + " " + out.slice(s.end);
  return out.replace(/\s+/g, " ").trim();
}

const applied = (t: QuickAddToken) => FORM_TOKEN_KINDS.has(t.kind) && !t.unresolved && !t.ambiguous;

/** One name box's text → its title, its chips and the fields its words set. */
export function analyzeLine(text: string, ctx: QuickAddContext): FormLine {
  if (!text.trim()) return { title: "", chips: [], fields: {} };
  const r = parseQuickAdd(text, ctx);
  const tokens = r.tokens.filter((t) => FORM_TOKEN_KINDS.has(t.kind));
  const has = (k: QuickAddTokenKind) => tokens.some((t) => t.kind === k && applied(t));
  const f = r.fields;
  const fields: FormFields = {};
  if (has("assignee") && f.assigneeAccountId) fields.assigneeAccountId = f.assigneeAccountId;
  // A start day inferred from "sau DEMO-5" is not applied: that word stays in the title and sets nothing.
  if (has("date") && f.startDate) fields.startDate = f.startDate;
  if ((has("date") || has("duration")) && f.durationDays !== undefined) fields.durationDays = f.durationDays;
  if (has("estimate") && f.estimateHours !== undefined) fields.estimateHours = f.estimateHours;
  if (has("priority") && f.priority) fields.priority = f.priority;
  if (has("parent") && f.parentId) fields.parentId = f.parentId;
  if (has("label") && f.labels?.length) fields.labels = [...f.labels];
  if (has("issueType") && f.issueType) fields.issueType = f.issueType;
  return {
    title: without(text, tokens.filter(applied)),
    chips: tokens.map((t) => ({ kind: t.kind, label: t.label, warn: !applied(t) })),
    fields,
  };
}

/** Several lines' fields as one set: for each field the last line that names it wins; labels add up. */
export function mergeFormFields(all: FormFields[]): FormFields {
  const out: FormFields = {};
  for (const f of all) {
    const { labels, ...rest } = f;
    Object.assign(out, rest);
    if (labels) out.labels = [...new Set([...(out.labels ?? []), ...labels])];
  }
  return out;
}
