import { adfComparable, sectionsToAdf, textToAdf } from "../adf.js";
import { foldName } from "../jiraClient.js";
import type { Spec } from "./specs.js";

/**
 * Which part of a test case or bug goes into which Jira field.
 *
 * The script put everything into Description. Projects that test in Jira give
 * Sub Testcase / Sub Bug their own fields — Module, Test Steps, Expected Result,
 * Actual Result… — and left them empty. Field ids are per site
 * (customfield_10xxx), so nothing here names one: the project's create screen
 * is read on every run (createmeta), fields are matched by *name* unless the
 * project's settings say otherwise, and a section that lands in a field leaves
 * the description. Anything unmapped stays in the description exactly as
 * before, so a project whose issue types have no such fields sees no change.
 */

export type FieldKind = "adf" | "text" | "option";
export type MappedKind = "test" | "bug";

/** A field as createmeta describes it (only what is used here). */
export interface JiraFieldMeta {
  fieldId: string;
  name: string;
  schema?: { type?: string; custom?: string; system?: string };
  allowedValues?: Array<{ id: string; value?: string; name?: string }>;
}

export interface FieldTarget {
  id: string;
  name: string;
  kind: FieldKind;
  options: Array<{ id: string; value: string }>;
}

/**
 * The parts of each kind of issue that can be routed, in description order,
 * with the field names that claim one when the project has not chosen
 * (compared with case, spacing, punctuation and diacritics folded away).
 */
export const FIELD_SOURCES: Record<MappedKind, Array<{ key: string; label: string; defaults: string[] }>> = {
  test: [
    { key: "section", label: "Nhóm (tiêu đề nhóm phía trên dòng)", defaults: ["Module", "Phân hệ"] },
    { key: "purpose", label: "Mục đích kiểm thử", defaults: ["Test Objective", "Objective", "Mục đích kiểm thử"] },
    { key: "steps", label: "Các bước thực hiện", defaults: ["Test Steps", "Steps", "Các bước thực hiện"] },
    { key: "expected", label: "Kết quả mong muốn", defaults: ["Expected Result", "Expected Results", "Kết quả mong muốn"] },
    { key: "runs", label: "Kết quả các lần chạy (Lần 1, Lần 2…)", defaults: [] },
    { key: "actual", label: "Kết quả hiện tại", defaults: ["Actual Result", "Actual Results", "Kết quả thực tế", "Kết quả hiện tại"] },
    { key: "bugCodes", label: "Mã lỗi", defaults: ["Mã lỗi"] },
    { key: "note", label: "Ghi chú", defaults: ["Ghi chú"] },
    { key: "source", label: "Nguồn (sheet, dòng)", defaults: [] },
  ],
  bug: [
    { key: "desc", label: "Mô tả lỗi", defaults: [] },
    { key: "sev", label: "Mức độ", defaults: ["Severity", "Mức độ", "Mức độ nghiêm trọng"] },
    { key: "sheetStatus", label: "Trạng thái trong file", defaults: [] },
    { key: "basis", label: "Căn cứ", defaults: ["Căn cứ"] },
    { key: "cause", label: "Nguyên nhân", defaults: ["Root Cause", "Nguyên nhân"] },
    { key: "evidence", label: "Bằng chứng / tái hiện", defaults: ["Steps to Reproduce", "Các bước tái hiện", "Bằng chứng"] },
    { key: "images", label: "Danh sách hình minh chứng", defaults: [] },
    { key: "tests", label: "Test case liên quan", defaults: [] },
    // A bug made from a failed row without a bug code carries that row's cells instead.
    { key: "purpose", label: "Mục đích kiểm thử (lỗi từ dòng không đạt)", defaults: [] },
    { key: "steps", label: "Các bước thực hiện (lỗi từ dòng không đạt)", defaults: ["Steps to Reproduce", "Các bước tái hiện"] },
    { key: "expected", label: "Kết quả mong muốn (lỗi từ dòng không đạt)", defaults: ["Expected Result", "Kết quả mong muốn"] },
    { key: "actual", label: "Kết quả hiện tại (lỗi từ dòng không đạt)", defaults: ["Actual Result", "Kết quả thực tế", "Kết quả hiện tại"] },
    { key: "note", label: "Ghi chú (lỗi từ dòng không đạt)", defaults: ["Ghi chú"] },
    { key: "source", label: "Nguồn (sheet, dòng)", defaults: [] },
  ],
};

/**
 * How a field is written, or null when this import cannot fill it. Multi-line
 * text is ADF in REST v3; a one-line text field is a plain string; a single
 * select takes one of its own options. Users, dates, numbers, multi-selects:
 * nothing in a test-case row fits them, so they are not offered.
 */
export function fieldKind(f: JiraFieldMeta): FieldKind | null {
  const custom = f.schema?.custom ?? "";
  if (f.fieldId === "environment") return "adf";
  if (!f.fieldId.startsWith("customfield_")) return null;
  if (custom.endsWith(":textarea")) return "adf";
  if (custom.endsWith(":textfield")) return "text";
  if (f.schema?.type === "option" && (custom.endsWith(":select") || custom.endsWith(":radiobuttons"))) return "option";
  return null;
}

/** The fields of a create screen this import can fill, for the settings picker. */
export function mappableFields(meta: JiraFieldMeta[]): Array<{ id: string; name: string; kind: FieldKind }> {
  return meta.flatMap((f) => {
    const kind = fieldKind(f);
    return kind ? [{ id: f.fieldId, name: f.name, kind }] : [];
  });
}

/** source key → field id, by the default names. A field is claimed by its first source only, except where two sources never meet in one issue. */
export function autoFieldMap(kind: MappedKind, meta: JiraFieldMeta[]): Record<string, string> {
  const fields = mappableFields(meta);
  const out: Record<string, string> = {};
  for (const source of FIELD_SOURCES[kind]) {
    for (const name of source.defaults) {
      const hit = fields.find((f) => foldName(f.name) === foldName(name));
      if (hit) {
        out[source.key] = hit.id;
        break;
      }
    }
  }
  return out;
}

/**
 * The map checked against what the create screen really has. A field that is
 * not there (removed from the screen, another site's id) or that cannot be
 * filled is reported once, and its section stays in the description — failing
 * every create over a settings mistake would be worse than a long description.
 */
export function resolveTargets(
  kind: MappedKind,
  map: Record<string, string>,
  meta: JiraFieldMeta[],
  typeName: string,
  warn: (message: string) => void
): Map<string, FieldTarget> {
  const out = new Map<string, FieldTarget>();
  for (const source of FIELD_SOURCES[kind]) {
    const id = map[source.key];
    if (!id) continue;
    const f = meta.find((m) => m.fieldId === id);
    if (!f) {
      warn(`Trường ${id} (cấu hình cho "${source.label}") không có trên màn hình tạo ${typeName} — nội dung để trong Mô tả.`);
      continue;
    }
    const fk = fieldKind(f);
    if (!fk) {
      warn(`Trường "${f.name}" của ${typeName} không điền được từ file Excel — "${source.label}" để trong Mô tả.`);
      continue;
    }
    out.set(source.key, {
      id: f.fieldId,
      name: f.name,
      kind: fk,
      options: (f.allowedValues ?? []).map((v) => ({ id: String(v.id), value: String(v.value ?? v.name ?? "") })),
    });
  }
  return out;
}

/**
 * What to write for one body: undefined when it cannot go into the field (an
 * option the field doesn't have — it stays in the description), null when
 * the cell is empty (the field is cleared: the Excel file is the source of truth).
 */
export function fieldValue(target: FieldTarget, body: string, warn: (message: string) => void): unknown | undefined {
  const text = body.trim();
  if (!text) return null;
  if (target.kind === "adf") return textToAdf(text);
  if (target.kind === "text") {
    const one = text.replace(/\s*\n\s*/g, " / ");
    return one.length <= 255 ? one : one.slice(0, 254) + "…";
  }
  const hit = target.options.find((o) => foldName(o.value) === foldName(text));
  if (!hit) {
    warn(
      `"${short(text)}" không phải lựa chọn của trường "${target.name}" (${target.options.map((o) => o.value).join(", ") || "không có lựa chọn"}) — để trong Mô tả.`
    );
    return undefined;
  }
  return { id: hit.id };
}

function short(s: string, n = 40): string {
  const one = s.replace(/\s+/g, " ");
  return one.length <= n ? one : one.slice(0, n - 1) + "…";
}

/**
 * Splits a spec's sections between fields and the description, in place.
 * Sections sharing a field (a listed bug's "evidence" and a failed row's
 * "steps" both go to Steps to Reproduce) never meet in one issue; if they ever
 * did, both are kept, in description order.
 */
export function applyFieldMap(spec: Spec, targets: Map<string, FieldTarget>, warn: (message: string) => void): void {
  if (!spec.sections || targets.size === 0) return;
  const kept: Array<[string, string]> = [];
  const byField = new Map<string, { target: FieldTarget; bodies: string[] }>();
  for (const s of spec.sections) {
    const target = targets.get(s.key);
    if (!target || (s.body.trim() && fieldValue(target, s.body, warn) === undefined)) {
      kept.push([s.head, s.body]);
      continue;
    }
    if (!byField.has(target.id)) byField.set(target.id, { target, bodies: [] });
    if (s.body.trim()) byField.get(target.id)!.bodies.push(s.body.trim());
  }
  const fields: Record<string, unknown> = {};
  for (const [id, { target, bodies }] of byField) {
    // An option takes one value; joined bodies would never match one.
    fields[id] = target.kind === "option" ? fieldValue(target, bodies[0] ?? "", () => {}) ?? null : fieldValue(target, bodies.join("\n\n"), warn);
  }
  spec.fields = fields;
  spec.description = sectionsToAdf(kept);
}

/** Whether an issue's current value already says what the file says. */
export function sameFieldValue(target: Pick<FieldTarget, "kind">, current: unknown, desired: unknown): boolean {
  if (target.kind === "option") {
    const id = (v: unknown) => (v && typeof v === "object" && "id" in v ? String((v as { id: unknown }).id) : null);
    return id(current) === id(desired);
  }
  if (target.kind === "text") return String(current ?? "").trim() === String(desired ?? "").trim();
  return adfComparable(current) === adfComparable(desired);
}
