import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRows, prepareChunk, detectDelimiter, detectMapping, looksLikeHeader, parseDate, parseHours, parseNumber, parseTable } from "../src/csvImport";

describe("parseTable", () => {
  it("reads quoted cells with commas, doubled quotes and line breaks inside", () => {
    const t = parseTable('Tên,Mô tả\n"Dựng API, bước 1","Dòng 1\nDòng 2 ""đã chốt"""\nKhác,x');
    assert.deepEqual(t, [["Tên", "Mô tả"], ["Dựng API, bước 1", 'Dòng 1\nDòng 2 "đã chốt"'], ["Khác", "x"]]);
  });

  it("copes with a BOM, CRLF and blank lines", () => {
    assert.deepEqual(parseTable("﻿a,b\r\n\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
  });

  it("detects tabs (Excel paste) and semicolons (Vietnamese-locale Excel CSV)", () => {
    assert.equal(detectDelimiter("a\tb\tc"), "\t");
    assert.equal(detectDelimiter("a;b;c"), ";");
    assert.equal(detectDelimiter("a,b,c"), ",");
    assert.deepEqual(parseTable("Tên\tNgày\nA\t01/02/2026"), [["Tên", "Ngày"], ["A", "01/02/2026"]]);
    // A comma inside a semicolon file is just text — a decimal, here.
    assert.deepEqual(parseTable("Tên;Giờ\nA;1,5"), [["Tên", "Giờ"], ["A", "1,5"]]);
  });

  it("keeps a trailing empty cell and an unterminated last line", () => {
    assert.deepEqual(parseTable("a,b\n1,"), [["a", "b"], ["1", ""]]);
  });
});

describe("detectMapping", () => {
  it("maps Vietnamese and English headers, ignoring case and diacritics", () => {
    const m = detectMapping(["Tên công việc", "Loại", "Người phụ trách", "Bắt đầu", "Thời lượng", "Việc cha", "Nhãn", "Ghi chú lạ"]);
    assert.deepEqual(m, ["summary", "issueType", "assignee", "startDate", "durationDays", "parent", "labels", null]);
    assert.deepEqual(detectMapping(["Summary", "Issue Type", "Assignee", "Start Date", "Priority", "Fix Version"]), [
      "summary", "issueType", "assignee", "startDate", "priority", "fixVersions",
    ]);
  });

  it("a field is claimed once: the second 'name' column stays unmapped", () => {
    assert.deepEqual(detectMapping(["Name", "Title"]), ["summary", null]);
  });

  it("tells a header row from data", () => {
    assert.equal(looksLikeHeader(["Tên", "Loại"]), true);
    assert.equal(looksLikeHeader(["Dựng API đăng nhập", "Story"]), false);
  });
});

describe("parseDate", () => {
  it("reads day-first slashes, ISO and Excel day numbers", () => {
    assert.equal(parseDate("05/11/2026"), "2026-11-05");
    assert.equal(parseDate("5-11-26"), "2026-11-05");
    assert.equal(parseDate("2026-11-05"), "2026-11-05");
    assert.equal(parseDate("2026-11-05 09:30"), "2026-11-05");
    assert.equal(parseDate("46331"), "2026-11-05");
  });
  it("refuses an impossible or unreadable date", () => {
    assert.equal(parseDate("30/02/2026"), null);
    assert.equal(parseDate("tuần sau"), null);
    assert.equal(parseDate(""), null);
  });
});

describe("parseNumber / parseHours", () => {
  it("takes a leading number, comma or dot decimal, and ignores a unit", () => {
    assert.equal(parseNumber("5"), 5);
    assert.equal(parseNumber("1,5 ngày"), 1.5);
    assert.equal(parseNumber("12h"), 12);
    assert.equal(parseNumber("abc"), null);
    assert.equal(parseNumber("0"), null);
  });
  it("hours: days are 8 hours", () => {
    assert.equal(parseHours("12"), 12);
    assert.equal(parseHours("12h"), 12);
    assert.equal(parseHours("2d"), 16);
    assert.equal(parseHours("1,5 ngày"), 12);
    assert.equal(parseHours("x"), null);
  });
});

describe("buildRows", () => {
  const types = ["Epic", "Story", "Task", "Sub-task"];
  const headers = ["Tên", "Loại", "Giao cho", "Bắt đầu", "Số ngày", "Việc cha", "Nhãn", "Ước lượng"];
  const mapping = detectMapping(headers);

  it("builds typed rows from cells, numbering them as the sheet does", () => {
    const rows = buildRows(
      [headers, ["Giai đoạn 1", "epic", "", "", "", "", "", ""], ["Khảo sát", "Story", "Lan", "05/11/2026", "3 ngày", "1", "ui, be", "2d"]],
      mapping,
      true,
      types
    );
    assert.deepEqual(rows.map((r) => r.row), [1, 2]);
    assert.deepEqual(rows[0].value, { summary: "Giai đoạn 1", issueType: "Epic" });
    assert.deepEqual(rows[1].value, {
      summary: "Khảo sát", issueType: "Story", assignee: "Lan", startDate: "2026-11-05", durationDays: 3, parent: "#1", labels: ["ui", "be"], estimateHours: 16,
    });
    assert.ok(rows.every((r) => r.problems.length === 0));
  });

  it("names each cell it could not understand instead of dropping the row quietly", () => {
    const [r] = buildRows([["", "Bug", "", "ngày mai", "xx", "", "", "abc"]], mapping, false, types);
    assert.equal(r.problems.length, 5);
    assert.ok(r.problems.some((p) => p.includes("Thiếu tên")));
    assert.ok(r.problems.some((p) => p.includes('Loại "Bug"')));
    assert.ok(r.problems.some((p) => p.includes("Ngày")));
  });

  it("a parent column of plain numbers means rows of this sheet; a key stays a key", () => {
    const rows = buildRows([["A", "", "", "", "", ""], ["B", "", "", "", "", "PRJ-7"]], detectMapping(["Tên", "Loại", "Giao cho", "Bắt đầu", "Số ngày", "Việc cha"]), false);
    assert.equal(rows[1].value.parent, "PRJ-7");
    const numbered = buildRows([["A", "2"]], ["summary", "parent"], false);
    assert.equal(numbered[0].value.parent, "#2");
  });

  it("without a header the first line is data", () => {
    assert.equal(buildRows([["Việc đầu"]], ["summary"], false).length, 1);
    assert.equal(buildRows([["Tên"], ["Việc đầu"]], ["summary"], true).length, 1);
  });

  it("without a list of project types the typed value is passed on as written", () => {
    const [r] = buildRows([["A", "Bug"]], ["summary", "issueType"], false);
    assert.equal(r.value.issueType, "Bug");
    assert.equal(r.problems.length, 0);
  });
});

describe("prepareChunk (a long sheet sent in pieces)", () => {
  const sheet = (rows: Array<[string, string?, string?]>) =>
    buildRows(
      rows.map(([summary, parent, date]) => [summary, parent ?? "", date ?? ""]),
      ["summary", "parent", "startDate"],
      false
    );

  it("sends rows as they are when nothing points at another row", () => {
    const c = prepareChunk(sheet([["a"], ["b"]]), 0, 25, new Map());
    assert.deepEqual(c.send.map((r) => r.summary), ["a", "b"]);
    assert.deepEqual(c.sentRows, [1, 2]);
    assert.equal(c.blocked.length, 0);
  });

  it("a parent in the same piece is renumbered to its place in that piece", () => {
    const c = prepareChunk(sheet([["Epic"], ["Story", "1"], ["Sub", "2"]]), 0, 25, new Map());
    assert.deepEqual(c.send.map((r) => r.parent), [undefined, "#1", "#2"]);
  });

  it("a parent in an EARLIER piece becomes the key it was created as", () => {
    const built = sheet([["Epic"], ["x"], ["Story", "1"]]);
    const second = prepareChunk(built, 2, 25, new Map([[1, "P-7"]]));
    assert.deepEqual(second.send.map((r) => r.parent), ["P-7"]);
    assert.deepEqual(second.sentRows, [3]);
  });

  it("skipping a blocked row does not shift the numbers the others point at", () => {
    // Row 2 has an unreadable date; row 3 points at row 1 and row 4 at row 3.
    const c = prepareChunk(sheet([["A"], ["B", "", "ngày mai"], ["C", "1"], ["D", "3"]]), 0, 25, new Map());
    assert.deepEqual(c.sentRows, [1, 3, 4]);
    assert.deepEqual(c.send.map((r) => r.parent), [undefined, "#1", "#2"]);
    assert.deepEqual(c.blocked.map((b) => b.row), [2]);
  });

  it("a child of a row that was not created is blocked, not attached somewhere else", () => {
    const c = prepareChunk(sheet([["", ""], ["Con", "1"], ["Cháu", "2"]]), 0, 25, new Map());
    assert.equal(c.send.length, 0);
    assert.deepEqual(c.blocked.map((b) => b.row), [1, 2, 3]);
    assert.match(c.blocked[1].message, /chưa được tạo/);
  });

  it("a parent that points at itself or further down is refused", () => {
    const c = prepareChunk(sheet([["A", "2"], ["B", "2"]]), 0, 25, new Map());
    assert.deepEqual(c.blocked.map((b) => b.row), [1, 2]);
    assert.match(c.blocked[0].message, /phía trên/);
  });

  it("a real issue key is passed through untouched", () => {
    const c = prepareChunk(sheet([["A", "PRJ-9"]]), 0, 25, new Map());
    assert.equal(c.send[0].parent, "PRJ-9");
  });

  it("cuts the sheet at the piece size", () => {
    const rows: Array<[string]> = Array.from({ length: 60 }, (_, i) => [`t${i}`]);
    const built = sheet(rows);
    assert.equal(prepareChunk(built, 0, 25, new Map()).send.length, 25);
    assert.equal(prepareChunk(built, 50, 25, new Map()).send.length, 10);
  });
});
