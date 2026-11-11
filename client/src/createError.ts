/*
 * What a person is told when Jira refuses to create an issue. Jira's sentence is English, and for a field the
 * project makes mandatory it repeats itself ("Due date: Due date is required. Due date is required."), so the
 * common case is turned into one Vietnamese line that says what to fill in. Anything else is shown as Jira
 * wrote it (with a sentence repeated back to back said once).
 */

const FIELD_NAME: Record<string, string> = {
  "due date": "Kết thúc",
  "start date": "Bắt đầu",
  assignee: "Người",
  priority: "Ưu tiên",
  labels: "Nhãn",
  components: "Thành phần",
  "component/s": "Thành phần",
  "fix version/s": "Phiên bản",
  "original estimate": "Ước lượng",
};

/** "A. A." → "A." */
function dedupe(message: string): string {
  const parts = message.split(/(?<=\.)\s+/).filter(Boolean);
  const seen: string[] = [];
  for (const p of parts) if (seen[seen.length - 1] !== p) seen.push(p);
  return seen.join(" ");
}

export function createErrorMessage(message: string): string {
  const text = message.trim();
  const required = [...text.matchAll(/(?:^|[.\s])([^.:]{1,60}?):?\s*(?:[^.:]{1,60}?\s)?is required/gi)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  const fields = [...new Set(required.map((f) => f.replace(/^.*:\s*/, "")))];
  if (fields.length > 0) {
    const named = fields.map((f) => `«${FIELD_NAME[f.toLowerCase()] ?? f}»`).join(", ");
    return `Dự án này bắt buộc điền ${named}. Điền xong rồi tạo lại.`;
  }
  return dedupe(text);
}
