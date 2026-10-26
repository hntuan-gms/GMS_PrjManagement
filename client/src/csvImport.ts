import type { ImportRow } from "./types";

/**
 * Turning a pasted or uploaded sheet into import rows — pure, so the awkward part
 * (what Excel and Vietnamese users actually put in a cell) can be tested.
 *
 * Two inputs reach here: a CSV file saved from Excel ("CSV UTF-8"), and cells copied
 * straight out of Excel, which arrive tab-separated. A real .xlsx file is NOT read:
 * that needs a spreadsheet library this app does not otherwise carry, and "Save as
 * CSV" / copy-and-paste covers the same sheets.
 */

export type ImportField =
  | "summary"
  | "issueType"
  | "description"
  | "assignee"
  | "startDate"
  | "durationDays"
  | "parent"
  | "labels"
  | "priority"
  | "estimateHours"
  | "components"
  | "fixVersions";

export const FIELD_LABELS: Record<ImportField, string> = {
  summary: "Tên công việc",
  issueType: "Loại",
  description: "Mô tả",
  assignee: "Người phụ trách",
  startDate: "Ngày bắt đầu",
  durationDays: "Thời lượng (ngày)",
  parent: "Việc cha (mã hoặc #số dòng)",
  labels: "Nhãn",
  priority: "Độ ưu tiên",
  estimateHours: "Ước lượng (giờ)",
  components: "Thành phần",
  fixVersions: "Phiên bản",
};

export const FIELD_ORDER = Object.keys(FIELD_LABELS) as ImportField[];

/** Lowercase, no diacritics, single spaces. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ parsing */

/** Which separator the first line uses. Excel's paste is tabs; a Vietnamese-locale Excel saves CSV with semicolons. */
export function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const count = (c: string) => first.split(c).length - 1;
  const tabs = count("\t");
  const semis = count(";");
  const commas = count(",");
  if (tabs > 0 && tabs >= semis && tabs >= commas) return "\t";
  if (semis > commas) return ";";
  return ",";
}

/** RFC 4180 with the quirks real files have: a BOM, CRLF or LF, and quotes inside quoted cells doubled. Blank lines are dropped. */
export function parseTable(raw: string, delimiter = detectDelimiter(raw)): string[][] {
  const text = raw.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    cell = "";
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") {
      quoted = true;
    } else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

/* ------------------------------------------------------------------ mapping */

const ALIASES: Record<ImportField, string[]> = {
  summary: ["summary", "title", "name", "task", "ten", "ten cong viec", "cong viec", "tieu de", "noi dung"],
  issueType: ["type", "issue type", "issuetype", "loai", "loai cong viec"],
  description: ["description", "desc", "mo ta", "chi tiet"],
  assignee: ["assignee", "owner", "nguoi phu trach", "phu trach", "nguoi thuc hien", "giao cho", "pic"],
  startDate: ["start", "start date", "begin", "ngay bat dau", "bat dau", "tu ngay"],
  durationDays: ["duration", "days", "thoi luong", "so ngay", "thoi gian"],
  parent: ["parent", "parent key", "cha", "viec cha", "cong viec cha"],
  labels: ["label", "labels", "tag", "tags", "nhan"],
  priority: ["priority", "uu tien", "do uu tien", "muc do uu tien"],
  estimateHours: ["estimate", "original estimate", "hours", "gio", "uoc luong", "so gio"],
  components: ["component", "components", "thanh phan"],
  fixVersions: ["fix version", "fix versions", "version", "versions", "release", "phien ban"],
};

/**
 * Header → field, by name. Each field is claimed by at most one column (the first that
 * matches), and a column no alias matches stays unmapped for the user to choose.
 */
export function detectMapping(headers: string[]): Array<ImportField | null> {
  const taken = new Set<ImportField>();
  return headers.map((h) => {
    const key = fold(h);
    if (!key) return null;
    const field = FIELD_ORDER.find((f) => !taken.has(f) && ALIASES[f].includes(key));
    if (field) taken.add(field);
    return field ?? null;
  });
}

/** Does this first row look like a header — i.e. does it name at least one known field? */
export function looksLikeHeader(first: string[]): boolean {
  return detectMapping(first).some(Boolean);
}

/* ------------------------------------------------------------------- values */

/** A date as people write it → YYYY-MM-DD, or null. Day-first for slashes (Vietnam), plus Excel's day-number form. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s);
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  let y: number, m: number, d: number;
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) {
    [d, m] = [Number(dmy[1]), Number(dmy[2])];
    y = Number(dmy[3]);
    if (dmy[3].length === 2) y += 2000;
  } else if (/^\d{5}$/.test(s)) {
    // Excel stores a date as days since 1899-12-30.
    const t = Date.UTC(1899, 11, 30) + Number(s) * 86_400_000;
    return new Date(t).toISOString().slice(0, 10);
  } else return null;
  const out = new Date(Date.UTC(y, m - 1, d));
  if (out.getUTCFullYear() !== y || out.getUTCMonth() !== m - 1 || out.getUTCDate() !== d) return null;
  return out.toISOString().slice(0, 10);
}

/** "5", "5 ngày", "5d", "1,5" → a positive number; anything else null. */
export function parseNumber(raw: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)/.exec(raw);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Hours: "12", "12h", "12 giờ", or days ("2d", "2 ngày" = 16h). */
export function parseHours(raw: string): number | null {
  const n = parseNumber(raw);
  if (n === null) return null;
  return /(?:\d|\s)(?:d|ngay|day|days)\s*$/i.test(fold(raw).replace(/(\d)([a-z])/g, "$1 $2")) ? n * 8 : n;
}

const list = (raw: string, sep: RegExp): string[] => [...new Set(raw.split(sep).map((s) => s.trim()).filter(Boolean))];

/* --------------------------------------------------------------------- rows */

export interface BuiltRow {
  /** 1-based, as the sheet shows it (the header row, if any, is not counted). */
  row: number;
  value: ImportRow;
  /** Reasons this row cannot be imported as written; empty when it is fine. */
  problems: string[];
}

/** The sheet's data lines → import rows, with every cell it could not understand named. */
export function buildRows(table: string[][], mapping: Array<ImportField | null>, hasHeader: boolean, typeNames: string[] = []): BuiltRow[] {
  const body = hasHeader ? table.slice(1) : table;
  const col = (f: ImportField) => mapping.indexOf(f);
  const cell = (r: string[], f: ImportField) => {
    const i = col(f);
    return i >= 0 ? (r[i] ?? "").trim() : "";
  };
  const types = new Map(typeNames.map((t) => [fold(t), t]));

  return body.map((r, i) => {
    const problems: string[] = [];
    const value: ImportRow = { summary: cell(r, "summary") };
    if (!value.summary) problems.push("Thiếu tên công việc.");

    const type = cell(r, "issueType");
    if (type) {
      const known = types.get(fold(type));
      if (known) value.issueType = known;
      else if (types.size > 0) problems.push(`Loại "${type}" không có trong dự án.`);
      else value.issueType = type;
    }
    const desc = cell(r, "description");
    if (desc) value.description = desc;
    const who = cell(r, "assignee");
    if (who) value.assignee = who;

    const start = cell(r, "startDate");
    if (start) {
      const iso = parseDate(start);
      if (iso) value.startDate = iso;
      else problems.push(`Ngày "${start}" không hiểu (dùng dd/mm/yyyy hoặc yyyy-mm-dd).`);
    }
    const dur = cell(r, "durationDays");
    if (dur) {
      const n = parseNumber(dur);
      if (n) value.durationDays = Math.ceil(n);
      else problems.push(`Thời lượng "${dur}" không phải số ngày.`);
    }
    const parent = cell(r, "parent");
    // A bare number is a row number ("3" → "#3"), the usual way a sheet points at its own lines.
    if (parent) value.parent = /^\d+$/.test(parent) ? `#${parent}` : parent;

    const labels = cell(r, "labels");
    if (labels) value.labels = list(labels, /[\s,;|]+/);
    const prio = cell(r, "priority");
    if (prio) value.priority = prio;
    const est = cell(r, "estimateHours");
    if (est) {
      const h = parseHours(est);
      if (h) value.estimateHours = h;
      else problems.push(`Ước lượng "${est}" không phải số giờ.`);
    }
    const comps = cell(r, "components");
    if (comps) value.components = list(comps, /[,;|]+/);
    const vers = cell(r, "fixVersions");
    if (vers) value.fixVersions = list(vers, /[,;|]+/);

    return { row: i + 1, value, problems };
  });
}

/* ------------------------------------------------------------------- chunks */

/** Rows per request: each is a few Jira writes, and one request must stay well inside Cloud Run's 300 s. */
export const CHUNK_SIZE = 25;

export interface Blocked {
  /** Sheet row, 1-based. */
  row: number;
  summary: string;
  message: string;
}

/**
 * The next piece of a long sheet, ready to send. Rows are sent in pieces because one
 * request is bounded in time, but "#N" parents refer to the WHOLE sheet — so here each
 * is rewritten for the piece it lands in: a row from an earlier piece becomes the
 * issue key it was created as, a row in this piece becomes its place in this piece,
 * and a parent that was never created (its own row had a problem, or failed) blocks
 * the child instead of attaching it somewhere else. Rows with problems of their own
 * are blocked too. `sentRows[i]` is the sheet row of the i-th row actually sent.
 */
export function prepareChunk(
  built: BuiltRow[],
  from: number,
  size: number,
  keyOfRow: Map<number, string>
): { send: ImportRow[]; sentRows: number[]; blocked: Blocked[] } {
  const send: ImportRow[] = [];
  const sentRows: number[] = [];
  const blocked: Blocked[] = [];
  const local = new Map<number, number>();

  for (const b of built.slice(from, from + size)) {
    const block = (message: string) => blocked.push({ row: b.row, summary: b.value.summary, message });
    if (b.problems.length > 0) {
      block(b.problems[0]);
      continue;
    }
    const value = { ...b.value };
    const ref = /^#(\d+)$/.exec(value.parent ?? "");
    if (ref) {
      const k = Number(ref[1]);
      if (k >= b.row) {
        block(`Việc cha #${k} phải nằm ở dòng phía trên.`);
        continue;
      }
      const key = keyOfRow.get(k);
      const inPiece = local.get(k);
      if (key) value.parent = key;
      else if (inPiece !== undefined) value.parent = `#${inPiece}`;
      else {
        block(`Việc cha ở dòng ${k} chưa được tạo (dòng đó bị lỗi hoặc bị bỏ qua).`);
        continue;
      }
    }
    send.push(value);
    sentRows.push(b.row);
    local.set(b.row, send.length);
  }
  return { send, sentRows, blocked };
}
