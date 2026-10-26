import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { strToU8, zipSync } from "fflate";
import { parseWorkbook } from "../src/kbkt/parse.js";
import { XlsxFormatError } from "../src/kbkt/xlsx.js";
import { buildXlsx, sampleWorkbook } from "./kbktFixture.js";

describe("parseWorkbook", () => {
  const wb = parseWorkbook(sampleWorkbook());

  it("reads code and title from D3/D2, decoding openpyxl's numeric character references", () => {
    assert.equal(wb.code, "1E_127");
    assert.equal(wb.title, "[# 1E_127] Báo cáo quản trị từng công ty");
    assert.equal(wb.sheet, "1E_127 BC quản trị");
  });

  it("numbers cases like column A's formula, skipping heading rows, and keeps each row's section", () => {
    assert.deepEqual(
      wb.cases.map((c) => [c.id, c.row, c.section]),
      [
        ["1E_127_1", 13, "Giao diện"],
        ["1E_127_2", 14, "Giao diện"],
        ["1E_127_3", 15, "Giao diện"],
        ["1E_127_4", 16, "Giao diện"],
        ["1E_127_5", 17, "Giao diện"],
        ["1E_127_6", 19, "Nhóm hai"],
      ]
    );
  });

  it("takes the latest non-empty run as the result", () => {
    assert.deepEqual(
      wb.cases.map((c) => [c.latest, c.state]),
      [["P", "pass"], ["F", "fail"], ["PE", "pending"], ["", "notrun"], ["P", "pass"], ["F", "fail"]]
    );
    assert.deepEqual(wb.cases[2].results, [["Lần 1 28/09/2026", "F"], ["Lần 2", "PE"]]);
  });

  it("collects bug codes case-insensitively, deduplicated and sorted", () => {
    assert.deepEqual(wb.cases[1].bugs, ["BUG-01", "BUG-02"]);
    assert.deepEqual(wb.cases[4].bugs, ["BUG-03"]);
  });

  it("reads the bug list in sheet order", () => {
    assert.deepEqual([...wb.bugs.keys()], ["BUG-01", "BUG-02", "BUG-03", "BUG-04"]);
    assert.deepEqual(wb.bugs.get("BUG-02"), {
      sev: "Thấp",
      status: "Rút lại theo Quy chuẩn",
      desc: "Nhãn sai",
      basis: "",
      cause: "",
      evidence: "",
      row: 6,
    });
  });

  it("gives each picture to the nearest BUG heading above it, named exactly as jira_sync.py names them", () => {
    const imgs = wb.images.get("BUG-01")!;
    assert.deepEqual(
      imgs.map((i) => [i.filename, i.data.length, i.mime, i.caption]),
      [
        ["1E_127_BUG-01_1.jpeg", 20, "image/jpeg", "BUG-01 (1/2) - Thiếu trường"],
        ["1E_127_BUG-01_2.png", 30, "image/png", "BUG-01 (2/2) - Thiếu trường"],
      ]
    );
    assert.equal(wb.images.size, 1);
    assert.ok(wb.warns.some((w) => w.includes("dòng 2") && w.includes("không đính kèm")));
  });

  it("refuses a workbook that is not a KBKT template, with the reason", () => {
    assert.throws(() => parseWorkbook(buildXlsx([{ name: "Sheet1", cells: { A1: "x" } }])), (e: unknown) => {
      return e instanceof XlsxFormatError && /D3/.test((e as Error).message);
    });
    assert.throws(
      () => parseWorkbook(buildXlsx([{ name: "Sheet1", cells: { D3: "1E_1" } }])),
      /Mã trường hợp kiểm thử/
    );
    assert.throws(() => parseWorkbook(strToU8("not a zip")), XlsxFormatError);
    assert.throws(() => parseWorkbook(zipSync({ "a.txt": strToU8("x") })), /workbook\.xml/);
  });

  it("names the missing required columns", () => {
    const cells = { D3: "1E_1", A10: "Mã trường hợp kiểm thử", B10: "Mục đích kiểm thử" };
    assert.throws(() => parseWorkbook(buildXlsx([{ name: "S", cells }])), /Kết quả mong muốn, Kết quả hiện tại/);
  });
});
