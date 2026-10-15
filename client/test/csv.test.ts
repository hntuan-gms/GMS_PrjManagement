import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { csvName, toCsv } from "../src/csv";

describe("toCsv", () => {
  it("starts with a BOM (Excel reads Vietnamese as mojibake without it), CRLF rows, RFC 4180 quoting", () => {
    const c = toCsv([["a", "b,c", 'd"e'], [1, null, "x\ny"]]);
    assert.ok(c.startsWith("﻿"));
    assert.equal(c, '﻿a,"b,c","d""e"\r\n1,,"x\ny"\r\n');
  });

  it("neutralises cells Excel would run as formulas, but not negative numbers", () => {
    const c = toCsv([["=HYPERLINK(1)", "+1", "-2", "@x", "\tx", -5]]);
    assert.equal(c, "﻿'=HYPERLINK(1),'+1,'-2,'@x,'\tx,-5\r\n");
  });
});

describe("csvName", () => {
  it("is filesystem-safe and dated", () => {
    assert.equal(csvName("wbs DEMO/1", "2026-10-14"), "wbs_DEMO_1-2026-10-14.csv");
  });
});
