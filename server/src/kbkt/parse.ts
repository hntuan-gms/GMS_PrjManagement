import { posix } from "node:path";
import { readXlsx, XlsxFormatError, type XlsxSheet } from "./xlsx.js";

/**
 * A KBKT test-case workbook (AI-33_1E127_....xlsx) read into plain data — a port
 * of `parse_workbook` + `bug_images` in jira_sync.py, which testers have used
 * against these files for months. Rules that look arbitrary are the template's:
 *
 *   - sheet 1: D2 title, D3 code, header row "Mã trường hợp kiểm thử" in column A;
 *     result columns ("Lần 1 / 28/09/2026", "Lần 2"…) sit between "Kết quả mong
 *     muốn" and "Kết quả hiện tại", their names on the row under the header.
 *   - a row with no expected result is a heading, precondition or blank; its
 *     purpose text (first line) becomes the section of the cases below it.
 *   - a case's id is `<code>_<n>`, numbered exactly as column A's formula does
 *     (column A holds formulas without cached values, so it is rebuilt here).
 *   - sheet "Danh sách lỗi": one bug per `BUG-nn` in column A under "Mã lỗi".
 *   - pictures anywhere go to the bug whose `BUG-nn` heading is the nearest
 *     cell at or above them (sheet "Hình ảnh lỗi": "BUG-01 (1/2) - …").
 */

export type CaseState = "pass" | "fail" | "pending" | "notrun";

export interface KbktCase {
  id: string;
  row: number;
  section: string;
  purpose: string;
  steps: string;
  expected: string;
  actual: string;
  bug: string;
  note: string;
  /** Non-empty results only, in run order: [run name, "P" | "F" | "PE" | …]. */
  results: Array<[string, string]>;
  latest: string;
  state: CaseState;
  /** BUG-nn codes this row references, sorted. */
  bugs: string[];
}

export interface KbktBug {
  sev: string;
  status: string;
  desc: string;
  basis: string;
  cause: string;
  evidence: string;
  /** null when the bug is only referenced by a test row, not listed in the sheet. */
  row: number | null;
}

export interface KbktImage {
  filename: string;
  data: Uint8Array;
  mime: string;
  caption: string;
}

export interface KbktWorkbook {
  code: string;
  title: string;
  sheet: string;
  cases: KbktCase[];
  /** Insertion order is the sheet's order — a Map, like the script's OrderedDict. */
  bugs: Map<string, KbktBug>;
  images: Map<string, KbktImage[]>;
  warns: string[];
}

/** The script's `text()`: None → "", CRLF → LF, trimmed. */
export function text(v: string | null | undefined): string {
  return v == null ? "" : String(v).replace(/\r\n/g, "\n").trim();
}

/** Labels and filenames: whitespace runs → "_" (the script's `label()`). */
export function label(s: string): string {
  return s.replace(/\s+/g, "_");
}

function findCol(ws: XlsxSheet, row: number, prefix: string): number | null {
  const want = prefix.toLowerCase();
  for (let c = 1; c <= ws.maxCol; c++) {
    if (text(ws.cell(row, c)).toLowerCase().startsWith(want)) return c;
  }
  return null;
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
  ".emf": "image/emf",
  ".wmf": "image/wmf",
};

const CASE_COLUMNS = [
  ["purpose", "Mục đích"],
  ["steps", "Các bước"],
  ["expected", "Kết quả mong muốn"],
  ["actual", "Kết quả hiện tại"],
  ["bug", "Mã lỗi"],
  ["note", "Ghi chú"],
] as const;

const BUG_COLUMNS = [
  ["sev", "Mức độ"],
  ["status", "Trạng thái"],
  ["desc", "Mô tả"],
  ["basis", "Căn cứ"],
  ["cause", "Nguyên nhân"],
  ["evidence", "Bằng chứng"],
] as const;

export function parseWorkbook(buf: Uint8Array): KbktWorkbook {
  const book = readXlsx(buf);
  const ws = book.sheets[0];
  if (!ws) throw new XlsxFormatError("File Excel không có sheet nào.");
  const warns: string[] = [];
  const code = text(ws.cell(3, 4));
  const title = text(ws.cell(2, 4));
  if (!code) {
    throw new XlsxFormatError(
      `Ô D3 (Mã trường hợp kiểm thử) của sheet "${ws.name}" đang trống — đây không phải file kịch bản kiểm thử theo mẫu KBKT.`
    );
  }

  let hdr: number | null = null;
  for (let r = 1; r < 30; r++) {
    if (text(ws.cell(r, 1)).startsWith("Mã trường hợp kiểm thử")) {
      hdr = r;
      break;
    }
  }
  if (!hdr) {
    throw new XlsxFormatError(`Không tìm thấy dòng tiêu đề "Mã trường hợp kiểm thử" ở cột A của sheet "${ws.name}".`);
  }

  const cols = Object.fromEntries(CASE_COLUMNS.map(([k, p]) => [k, findCol(ws, hdr!, p)])) as Record<
    (typeof CASE_COLUMNS)[number][0],
    number | null
  >;
  const missing = CASE_COLUMNS.filter(([k]) => ["purpose", "expected", "actual"].includes(k) && !cols[k]).map(([, p]) => p);
  if (missing.length > 0) throw new XlsxFormatError(`Thiếu cột: ${missing.join(", ")} (dòng ${hdr}).`);

  const runs: Array<[number, string]> = [];
  for (let c = cols.expected! + 1, i = 0; c < cols.actual!; c++, i++) {
    runs.push([c, text(ws.cell(hdr + 1, c)).replace(/\n/g, " ") || `Lần ${i + 1}`]);
  }

  const cases: KbktCase[] = [];
  let section = "";
  let n = 0;
  for (let r = hdr + 1; r <= ws.maxRow; r++) {
    const v = Object.fromEntries(
      CASE_COLUMNS.map(([k]) => [k, cols[k] ? text(ws.cell(r, cols[k]!)) : ""])
    ) as Record<(typeof CASE_COLUMNS)[number][0], string>;
    if (!v.expected) {
      if (r > hdr + 1 && v.purpose) section = v.purpose.split("\n")[0];
      continue;
    }
    n += 1;
    const results = runs
      .map(([c, name]) => [name, text(ws.cell(r, c)).toUpperCase()] as [string, string])
      .filter(([, x]) => x);
    const latest = results.length > 0 ? results[results.length - 1][1] : "";
    if (!["", "P", "F", "PE"].includes(latest)) {
      warns.push(`Dòng ${r}: kết quả "${latest}" không xác định, coi như đang xem xét (PE).`);
    }
    cases.push({
      ...v,
      id: `${code}_${n}`,
      row: r,
      section,
      results,
      latest,
      state: latest === "P" ? "pass" : latest === "F" ? "fail" : latest === "" ? "notrun" : "pending",
      bugs: [...new Set(v.bug.toUpperCase().match(/BUG-\d+/g) ?? [])].sort(),
    });
  }

  const bugs = new Map<string, KbktBug>();
  const bs = book.sheet("Danh sách lỗi");
  if (bs) {
    let h: number | null = null;
    for (let r = 1; r < 15; r++) {
      if (text(bs.cell(r, 1)) === "Mã lỗi") {
        h = r;
        break;
      }
    }
    if (h) {
      const bc = Object.fromEntries(BUG_COLUMNS.map(([k, p]) => [k, findCol(bs, h!, p)])) as Record<
        (typeof BUG_COLUMNS)[number][0],
        number | null
      >;
      for (let r = h + 1; r <= bs.maxRow; r++) {
        const bid = text(bs.cell(r, 1)).toUpperCase();
        if (!/^BUG-\d+$/.test(bid)) continue;
        const info = Object.fromEntries(
          BUG_COLUMNS.map(([k]) => [k, bc[k] ? text(bs.cell(r, bc[k]!)) : ""])
        ) as Omit<KbktBug, "row">;
        bugs.set(bid, { ...info, row: r });
      }
    } else {
      warns.push(`Sheet "Danh sách lỗi" không có dòng tiêu đề "Mã lỗi".`);
    }
  } else {
    warns.push(`Không có sheet "Danh sách lỗi".`);
  }

  return { code, title, sheet: ws.name, cases, bugs, images: bugImages(book.sheets, code, warns), warns };
}

function bugImages(sheets: XlsxSheet[], code: string, warns: string[]): Map<string, KbktImage[]> {
  const found = new Map<string, Array<{ row: number; media: string; caption: string; data: Uint8Array }>>();
  for (const ws of sheets) {
    if (ws.images.length === 0) continue;
    // Sorted like the script's tuples (row, code, text), so ties resolve the same way.
    const heads = ws
      .cells()
      .flatMap(({ row, value }) => {
        const m = /^\s*(BUG-\d+)/i.exec(text(value));
        return m ? [{ row, bid: m[1].toUpperCase(), caption: text(value) }] : [];
      })
      .sort((a, b) => a.row - b.row || cmp(a.bid, b.bid) || cmp(a.caption, b.caption));
    for (const img of ws.images) {
      const above = heads.filter((h) => h.row <= img.row);
      if (above.length === 0) {
        warns.push(`Hình ở ${ws.name}!dòng ${img.row} không có tiêu đề BUG-xx phía trên — không đính kèm.`);
        continue;
      }
      const head = above[above.length - 1];
      if (!found.has(head.bid)) found.set(head.bid, []);
      found.get(head.bid)!.push({ row: img.row, media: img.media, caption: head.caption, data: img.data });
    }
  }

  const out = new Map<string, KbktImage[]>();
  for (const [bid, imgs] of found) {
    imgs.sort((a, b) => a.row - b.row || cmp(a.media, b.media) || cmp(a.caption, b.caption));
    out.set(
      bid,
      imgs.map((img, i) => {
        const ext = posix.extname(img.media).toLowerCase();
        return {
          // The filename is what a re-sync matches an attachment by, so it must stay
          // byte-identical to jira_sync.py's or every screenshot is uploaded again.
          filename: label(`${code}_${bid}_${i + 1}${ext}`),
          data: img.data,
          caption: img.caption,
          mime: MIME[ext] ?? "application/octet-stream",
        };
      })
    );
  }
  return out;
}

/** Code-point order, like Python's string comparison (localeCompare is not). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
