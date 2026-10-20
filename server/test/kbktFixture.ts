import { strToU8, zipSync } from "fflate";

/**
 * A minimal .xlsx written the way openpyxl writes the real KBKT files: inline
 * strings, every non-ASCII character as a numeric reference, drawing XML in the
 * default namespace and absolute relationship targets. Those are the quirks
 * the reader has to survive, so the fixture reproduces them on purpose.
 */

export type Cells = Record<string, string>;
export interface FixtureSheet {
  name: string;
  cells: Cells;
  /** Pictures anchored at a 1-based row. */
  images?: Array<{ row: number; bytes: number; ext?: string }>;
}

function esc(s: string): string {
  return [...s]
    .map((ch) => {
      if (ch === "&") return "&amp;";
      if (ch === "<") return "&lt;";
      if (ch === ">") return "&gt;";
      const cp = ch.codePointAt(0)!;
      return cp > 127 ? `&#${cp};` : ch;
    })
    .join("");
}

function sheetXml(cells: Cells, hasDrawing: boolean): string {
  const rows = new Map<number, string[]>();
  for (const [ref, value] of Object.entries(cells)) {
    const row = Number(/\d+$/.exec(ref)![0]);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row)!.push(`<c r="${ref}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`);
  }
  const body = [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([r, cs]) => `<row r="${r}">${cs.join("")}</row>`)
    .join("");
  return (
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetData>${body}</sheetData>${hasDrawing ? `<drawing r:id="rId1"/>` : ""}</worksheet>`
  );
}

export function buildXlsx(sheets: FixtureSheet[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const rel = (id: string, type: string, target: string) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const rels = (inner: string) => strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</Relationships>`);

  files["xl/workbook.xml"] = strToU8(
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
      sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
      `</sheets></workbook>`
  );
  files["xl/_rels/workbook.xml.rels"] = rels(sheets.map((_, i) => rel(`rId${i + 1}`, "worksheet", `/xl/worksheets/sheet${i + 1}.xml`)).join(""));

  let media = 0;
  sheets.forEach((s, i) => {
    const n = i + 1;
    const images = s.images ?? [];
    files[`xl/worksheets/sheet${n}.xml`] = strToU8(sheetXml(s.cells, images.length > 0));
    if (images.length === 0) return;
    files[`xl/worksheets/_rels/sheet${n}.xml.rels`] = rels(rel("rId1", "drawing", `/xl/drawings/drawing${n}.xml`));
    const anchors: string[] = [];
    const drawingRels: string[] = [];
    images.forEach((img, j) => {
      media += 1;
      const path = `xl/media/image${media}.${img.ext ?? "png"}`;
      files[path] = new Uint8Array(img.bytes).fill(j + 1);
      drawingRels.push(rel(`rId${j + 1}`, "image", `/${path}`));
      anchors.push(
        `<oneCellAnchor><from><col>1</col><colOff>0</colOff><row>${img.row - 1}</row><rowOff>0</rowOff></from><ext cx="1" cy="1"/>` +
          `<pic><nvPicPr><cNvPr id="${j + 1}" name="Image ${j + 1}"/><cNvPicPr/></nvPicPr>` +
          `<blipFill><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId${j + 1}"/></blipFill>` +
          `<spPr/></pic><clientData/></oneCellAnchor>`
      );
    });
    files[`xl/drawings/drawing${n}.xml`] = strToU8(
      `<wsDr xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">${anchors.join("")}</wsDr>`
    );
    files[`xl/drawings/_rels/drawing${n}.xml.rels`] = rels(drawingRels.join(""));
  });
  return zipSync(files);
}

/**
 * A small but complete KBKT workbook: a section heading, five cases across three
 * runs (P, F, PE, blank, and a re-run that turned F into P), a bug list with an
 * open, a withdrawn and a closed bug, and two screenshots under BUG-01, one
 * under a heading-less row.
 */
export function sampleWorkbook(): Uint8Array {
  const main: Cells = {
    C1: "KỊCH BẢN KIỂM THỬ *",
    C2: "Tên màn hình/Tên chức năng",
    D2: "[# 1E_127] Báo cáo quản trị từng công ty",
    C3: "Mã trường hợp kiểm thử",
    D3: "1E_127",
    A10: "Mã trường hợp kiểm thử",
    B10: "Mục đích kiểm thử",
    C10: "Các bước thực hiện",
    D10: "Kết quả mong muốn",
    E10: "Chrome 69.0",
    H10: "Kết quả hiện tại",
    I10: "Mã lỗi",
    J10: "Ghi chú",
    E11: "Lần 1\n28/09/2026",
    F11: "Lần 2",
    B12: "Giao diện\nphần đầu",
    B13: "Kiểm tra tiêu đề",
    C13: "1. Mở màn hình",
    D13: "Hiển thị tiêu đề",
    E13: "P",
    H13: "Đúng",
    B14: "Kiểm tra bộ lọc",
    D14: "Đủ 5 trường",
    E14: "F",
    H14: "Thiếu trường",
    I14: "BUG-01, bug-02",
    B15: "Kiểm tra xuất Excel",
    D15: "Xuất được file",
    E15: "F",
    F15: "PE",
    B16: "Kiểm tra phân quyền",
    D16: "Chặn người ngoài",
    B17: "Kiểm tra sắp xếp",
    D17: "Theo tên",
    E17: "F",
    F17: "P",
    I17: "BUG-03",
    B18: "Nhóm hai",
    B19: "Kiểm tra nút Tìm",
    D19: "Tìm đúng",
    E19: "F",
  };
  const bugs: Cells = {
    A1: "DANH SÁCH LỖI",
    A4: "Mã lỗi",
    B4: "Mức độ",
    C4: "Trạng thái",
    D4: "Mô tả",
    E4: "Căn cứ",
    F4: "Nguyên nhân (code)",
    G4: "Bằng chứng / tái hiện",
    A5: "BUG-01",
    B5: "Cao",
    C5: "Mở",
    D5: "Thiếu trường lọc",
    A6: "BUG-02",
    B6: "Thấp",
    C6: "Rút lại theo Quy chuẩn",
    D6: "Nhãn sai",
    A7: "BUG-03",
    B7: "Trung bình",
    C7: "Mở",
    D7: "Sắp xếp sai",
    A8: "BUG-04",
    B8: "-",
    C8: "Đã đóng",
    D8: "Không còn tái hiện",
  };
  const pictures: Cells = {
    B1: "HÌNH ẢNH MINH CHỨNG",
    B4: "BUG-01 (1/2) - Thiếu trường",
    B30: "BUG-01 (2/2) - Thiếu trường",
  };
  return buildXlsx([
    { name: "1E_127 BC quản trị", cells: main },
    { name: "Danh sách lỗi", cells: bugs },
    {
      name: "Hình ảnh lỗi",
      cells: pictures,
      images: [
        { row: 2, bytes: 10 },
        { row: 31, bytes: 30 },
        { row: 5, bytes: 20, ext: "jpeg" },
      ],
    },
  ]);
}
