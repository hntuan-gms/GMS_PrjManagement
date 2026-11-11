/*
 * What the project's create screen makes mandatory (GET /create-requirements) and the check that runs before a
 * quick create is sent. Jira's own refusal stays the safety net; this only spares the round trip and says
 * which box to fill in the app's words. Pure.
 */

export interface CreateRequirements {
  dueDate: boolean;
  startDate: boolean;
  assignee: boolean;
  others: string[];
}

export const NO_REQUIREMENTS: CreateRequirements = { dueDate: false, startDate: false, assignee: false, others: [] };

/** The boxes still empty, by the names they carry on screen. Kết thúc is met by a start date too: the app gives it one day. */
export function missingRequired(fields: { startDate?: string | null; assigneeAccountId?: string | null }, req: CreateRequirements): string[] {
  const out: string[] = [];
  if (req.startDate && !fields.startDate) out.push("Bắt đầu");
  if (req.dueDate && !fields.startDate) out.push("Kết thúc");
  if (req.assignee && !fields.assigneeAccountId) out.push("Người");
  return out;
}

/** The sentence shown when something mandatory is missing. */
export function missingMessage(names: string[]): string {
  return `Dự án này bắt buộc điền ${names.map((n) => `«${n}»`).join(", ")}.`;
}
