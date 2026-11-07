import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeBlocks, linkPieces } from "../src/descriptionView";

describe("describeBlocks", () => {
  it("splits paragraphs on blank lines and keeps line breaks inside one", () => {
    assert.deepEqual(describeBlocks("a\nb\n\nc"), [
      { kind: "p", lines: ["a", "b"] },
      { kind: "p", lines: ["c"] },
    ]);
  });

  it("reads - * • as a bullet list and 1. 2) as a numbered one", () => {
    assert.deepEqual(describeBlocks("Bối cảnh:\n- một\n* hai\n• ba\n\n1. x\n2) y"), [
      { kind: "p", lines: ["Bối cảnh:"] },
      { kind: "ul", items: ["một", "hai", "ba"] },
      { kind: "ol", items: ["x", "y"] },
    ]);
  });

  it("a plain line after a list starts a paragraph, not another item", () => {
    assert.deepEqual(describeBlocks("- a\nkết luận"), [
      { kind: "ul", items: ["a"] },
      { kind: "p", lines: ["kết luận"] },
    ]);
  });

  it("does not mistake a dash inside a sentence or a negative number for a bullet", () => {
    assert.deepEqual(describeBlocks("-5 độ\nA - B"), [{ kind: "p", lines: ["-5 độ", "A - B"] }]);
  });

  it("empty text has no blocks, and CRLF reads like LF", () => {
    assert.deepEqual(describeBlocks(""), []);
    assert.deepEqual(describeBlocks("a\r\n- b"), [
      { kind: "p", lines: ["a"] },
      { kind: "ul", items: ["b"] },
    ]);
  });
});

describe("linkPieces", () => {
  it("cuts a URL out of the text and leaves closing punctuation outside it", () => {
    assert.deepEqual(linkPieces("xem https://example.com/spec, rồi làm"), ["xem ", { url: "https://example.com/spec" }, ", rồi làm"]);
  });

  it("text with no link is one piece", () => {
    assert.deepEqual(linkPieces("không có"), ["không có"]);
  });
});
