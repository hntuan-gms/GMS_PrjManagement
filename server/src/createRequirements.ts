/*
 * What a project's create screen makes mandatory, reduced to the boxes this app can put in front of a person
 * before anything is sent. Jira refuses a create that misses one ("Due date is required", seen on VCBIC) with
 * a 201 on our bulk route and the refusal in the body, so asking first is what spares the round trip.
 * Pure, so the rule is testable without Jira.
 */

export interface CreateMetaField {
  fieldId: string;
  name: string;
  required?: boolean;
}

export interface CreateRequirements {
  /** The Kết thúc box: Jira's `duedate`, which this app derives from a start date plus a duration. */
  dueDate: boolean;
  /** The Bắt đầu box, when the site has a Start date field and the screen makes it mandatory. */
  startDate: boolean;
  assignee: boolean;
  /** Mandatory fields with no box on the quick-add card; they are named in Jira's refusal instead. */
  others: string[];
}

/** Always supplied by the app, never asked of the person. */
const SUPPLIED = new Set(["project", "issuetype", "summary", "reporter", "parent"]);

export const NO_REQUIREMENTS: CreateRequirements = { dueDate: false, startDate: false, assignee: false, others: [] };

export function readRequirements(fields: CreateMetaField[], startDateFieldId: string | null): CreateRequirements {
  const out: CreateRequirements = { dueDate: false, startDate: false, assignee: false, others: [] };
  for (const f of fields) {
    if (!f.required || SUPPLIED.has(f.fieldId)) continue;
    if (f.fieldId === "duedate") out.dueDate = true;
    else if (startDateFieldId && f.fieldId === startDateFieldId) out.startDate = true;
    else if (f.fieldId === "assignee") out.assignee = true;
    else out.others.push(f.name);
  }
  return out;
}
