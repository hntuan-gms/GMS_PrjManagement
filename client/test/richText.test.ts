import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as server from "../../server/src/richText";
import { adfToRich, richToAdf } from "../../server/src/adf";
import { docToRich, hasUploading, richToDoc, type DocNode } from "../src/richDoc";
import * as client from "../src/richText";

describe("richText mirror", () => {
  it("the client's file is the server's, byte for byte", () => {
    const a = readFileSync(new URL("../src/richText.ts", import.meta.url), "utf8");
    const b = readFileSync(new URL("../../server/src/richText.ts", import.meta.url), "utf8");
    assert.equal(a, b);
  });

  for (const text of ["# Tiêu đề\n\n- a\n  1. b\n\n```js\nx\n```", "**đậm** _nghiêng_ @[An](1) https://e.com", "> q\n\n![x](attachment:5)"]) {
    it(`parses ${JSON.stringify(text.slice(0, 20))} the same on both sides`, () => {
      assert.deepEqual(client.parseBlocks(text), server.parseBlocks(text));
    });
  }
});

const t = (text: string, ...marks: string[]): DocNode => (marks.length ? { type: "text", text, marks: marks.map((type) => ({ type })) } : { type: "text", text });
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const doc = (...content: DocNode[]): DocNode => ({ type: "doc", content });

describe("the box's document ↔ stored text", () => {
  for (const text of [
    "**Mục tiêu:** Nghiên cứu (Signal Tracker → MQL).\n\n**Input tham khảo:**\n\n- Đề bài: [MKT - Bài toán](https://docs.google.com/document/d/16C/edit)\n- File mẫu: [Report](https://e.com/s)",
    "# Bối cảnh\n\nDùng `kit.tsx` và _Chip_.\n\n1. BoardView\n   - con\n2. OkrView",
    "```js\nconst a = 1;\n\nb()\n```\n\n> trích\n\n---",
    "Chào @[Minh Quang](712:abc), xem https://x.com/y nhé\nDòng hai",
    "![anh.png](attachment:10)\n\n![](media:aaaaaaaa-1111-2222-3333-444444444444)",
    "Giá 5 * 3, tc_code_1, \\*không đậm\\*\n1\\. không phải danh sách\n\\- cũng không",
  ]) {
    it(`round-trips ${JSON.stringify(text.slice(0, 30))}`, () => {
      assert.equal(docToRich(richToDoc(text)), text);
    });
  }

  it("what the box writes reads back from Jira the same (box → text → ADF → text)", () => {
    const d = doc(
      { type: "heading", attrs: { level: 2 }, content: [t("Kết quả")] },
      { type: "bulletList", content: [{ type: "listItem", content: [p(t("Đề xuất "), t("giải pháp", "bold"))] }] }
    );
    const text = docToRich(d);
    assert.equal(text, "## Kết quả\n\n- Đề xuất **giải pháp**");
    assert.equal(adfToRich(richToAdf(text)), text);
  });

  it("marks shared by neighbours are one run; italic inside a word falls back to stars", () => {
    assert.equal(docToRich(doc(p(t("a ", "bold"), t("b", "bold", "italic")))), "**a _b_**");
    assert.equal(docToRich(doc(p(t("x"), t("y", "italic"), t("z")))), "x*y*z");
  });

  it("empty paragraphs the box keeps between blocks are not stored", () => {
    assert.equal(docToRich(doc(p(t("a")), { type: "paragraph" }, p(t("b")))), "a\n\nb");
    assert.equal(docToRich(doc({ type: "paragraph" })), "");
  });

  it("a picture still uploading is visible in the text", () => {
    const text = docToRich(doc({ type: "richImage", attrs: { src: "uploading:3", alt: "Đang tải x.png…" } }));
    assert.ok(hasUploading(text));
    assert.ok(!hasUploading("![x](attachment:3)"));
  });

  it("an empty text is one empty paragraph to type into", () => {
    assert.deepEqual(richToDoc(""), { type: "doc", content: [{ type: "paragraph" }] });
  });
});
