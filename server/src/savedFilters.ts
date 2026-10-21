import { badRequest } from "./errors.js";

/**
 * A saved filter's facets — client/src/savedFilters.ts holds the same shape.
 * There is deliberately no `text`: the search box is a transient search, never
 * restored (client/src/taskFilter.ts), and a saved view that quietly carried
 * last week's search would make a project look empty.
 */
export interface SavedFilterSpec {
  /** Account ids; "none" = unassigned; "@me" = whoever applies the filter. */
  people: string[];
  statuses: string[];
  types: string[];
  /** Epic keys; "none" = not under any Epic. */
  epics: string[];
  labels: string[];
  /** Priority names; "none" = no priority. */
  priorities: string[];
  onlyOverdue: boolean;
}

export interface SavedFilterInput {
  name?: string;
  shared?: boolean;
  spec?: SavedFilterSpec;
}

export const MAX_NAME = 80;
const MAX_VALUES = 200;
const MAX_VALUE_LENGTH = 200;
const LIST_FIELDS = ["people", "statuses", "types", "epics", "labels", "priorities"] as const;

function list(raw: unknown, field: string): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) {
    throw badRequest(`Bộ lọc không hợp lệ: "${field}" phải là danh sách chuỗi.`);
  }
  if (raw.length > MAX_VALUES) throw badRequest(`Bộ lọc không hợp lệ: "${field}" có quá nhiều giá trị.`);
  if (raw.some((v: string) => v.length > MAX_VALUE_LENGTH)) {
    throw badRequest(`Bộ lọc không hợp lệ: một giá trị của "${field}" quá dài.`);
  }
  return [...new Set(raw as string[])];
}

export function validateSpec(raw: unknown): SavedFilterSpec {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw badRequest("Thiếu nội dung bộ lọc.");
  const o = raw as Record<string, unknown>;
  if (o.onlyOverdue !== undefined && typeof o.onlyOverdue !== "boolean") {
    throw badRequest('Bộ lọc không hợp lệ: "onlyOverdue" phải là đúng/sai.');
  }
  // Unknown keys are dropped rather than stored: the blob is applied whole on
  // every client, so anything in it has to be something the filter understands.
  const spec = {
    ...Object.fromEntries(LIST_FIELDS.map((f) => [f, list(o[f], f)])),
    onlyOverdue: o.onlyOverdue === true,
  } as SavedFilterSpec;
  if (!spec.onlyOverdue && LIST_FIELDS.every((f) => spec[f].length === 0)) {
    throw badRequest("Bộ lọc đang trống — hãy chọn ít nhất một điều kiện trước khi lưu.");
  }
  return spec;
}

/**
 * A create (`partial` false: name and spec required) or an update (`partial`
 * true: any subset). Throws a 400 naming the field, like kbkt/settings.ts.
 */
export function validateFilterInput(raw: unknown, partial: boolean): SavedFilterInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw badRequest("Dữ liệu bộ lọc không hợp lệ.");
  const o = raw as Record<string, unknown>;
  const out: SavedFilterInput = {};

  if (o.name !== undefined || !partial) {
    if (typeof o.name !== "string") throw badRequest("Cần đặt tên cho bộ lọc.");
    const name = o.name.replace(/\s+/g, " ").trim();
    if (!name) throw badRequest("Cần đặt tên cho bộ lọc.");
    if (name.length > MAX_NAME) throw badRequest(`Tên bộ lọc dài tối đa ${MAX_NAME} ký tự.`);
    out.name = name;
  }
  if (o.shared !== undefined) {
    if (typeof o.shared !== "boolean") throw badRequest('"shared" phải là đúng/sai.');
    out.shared = o.shared;
  } else if (!partial) {
    out.shared = false;
  }
  if (o.spec !== undefined || !partial) out.spec = validateSpec(o.spec);

  if (partial && Object.keys(out).length === 0) throw badRequest("Không có gì để cập nhật.");
  return out;
}
