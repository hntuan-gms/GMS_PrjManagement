import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as server from "../../server/src/richText";
import { applyAction, attachmentImage, continueBlock, hasUploading, indentItems, insertBlock, settleUpload, uploadingToken, type TextEdit } from "../src/richEdit";
import * as client from "../src/richText";

/** The text with the selection written as [ ] (or | for a caret), for readable cases. */
function at(marked: string): TextEdit {
  const caret = marked.indexOf("|");
  if (caret >= 0) return { value: marked.replace("|", ""), start: caret, end: caret };
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  return { value: marked.replace("[", "").replace("]", ""), start, end };
}
const show = (e: TextEdit) =>
  e.start === e.end ? e.value.slice(0, e.start) + "|" + e.value.slice(e.start) : e.value.slice(0, e.start) + "[" + e.value.slice(e.start, e.end) + "]" + e.value.slice(e.end);

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

describe("formatting actions", () => {
  it("wraps a selection, and the same press unwraps it", () => {
    const once = applyAction(at("viết [đậm] nhé"), "bold");
    assert.equal(show(once), "viết **[đậm]** nhé");
    assert.equal(show(applyAction(once, "bold")), "viết [đậm] nhé");
  });

  it("keeps spaces at the selection's edges outside the marks", () => {
    assert.equal(show(applyAction(at("a[ b ]c"), "italic")), "a _[b]_ c");
  });

  it("a caret gets an empty pair to type into", () => {
    assert.equal(show(applyAction(at("x |"), "code")), "x `|`");
  });

  it("lists every line touched, numbered in order; pressed again it takes them off", () => {
    const on = applyAction(at("[một\nhai]"), "numbered");
    assert.equal(on.value, "1. một\n2. hai");
    assert.equal(applyAction({ ...on, start: 0, end: on.value.length }, "numbered").value, "một\nhai");
  });

  it("a bullet replaces a number rather than stacking on it", () => {
    assert.equal(applyAction(at("1. a|"), "bullet").value, "- a");
  });

  it("a link puts the words in brackets and selects the address to type over", () => {
    assert.equal(show(applyAction(at("xem [tài liệu]"), "link")), "xem [tài liệu]([https://])");
  });

  it("a code block fences the lines", () => {
    assert.equal(applyAction(at("a\n[b]"), "codeblock").value, "a\n```\nb\n```");
  });
});

describe("keys", () => {
  it("Enter carries a list on, numbers counting", () => {
    assert.equal(show(continueBlock(at("- a|")!)!), "- a\n- |");
    assert.equal(show(continueBlock(at("  3. a|")!)!), "  3. a\n  4. |");
    assert.equal(show(continueBlock(at("> a|")!)!), "> a\n> |");
  });

  it("Enter on an empty item ends the list", () => {
    assert.equal(show(continueBlock(at("- a\n- |")!)!), "- a\n|");
  });

  it("Enter elsewhere, or inside a code block, is a plain Enter", () => {
    assert.equal(continueBlock(at("chữ|")), null);
    assert.equal(continueBlock(at("```\n- a|")), null);
  });

  it("Tab nests list lines, Shift+Tab takes them back", () => {
    assert.equal(indentItems(at("- a\n- b|"), false)!.value, "- a\n  - b");
    assert.equal(indentItems(at("- a\n  - b|"), true)!.value, "- a\n- b");
    assert.equal(indentItems(at("chữ|"), false), null);
  });
});

describe("pictures", () => {
  it("a picture goes on a line of its own", () => {
    assert.equal(show(insertBlock(at("xem|nhé"), "![a](attachment:1)")), "xem\n![a](attachment:1)\n|nhé");
    assert.equal(show(insertBlock(at("|"), "![a](attachment:1)")), "![a](attachment:1)\n|");
  });

  it("the upload's placeholder is swapped for the picture, or removed when it failed", () => {
    const v = `a\n${uploadingToken(3, "anh-dan.png")}\nb`;
    assert.ok(hasUploading(v));
    assert.equal(settleUpload(v, 3, attachmentImage("10", "anh-dan.png")), "a\n![anh-dan.png](attachment:10)\nb");
    assert.equal(settleUpload(v, 3, ""), "a\nb");
    assert.equal(settleUpload(v, 4, ""), v);
  });

  it("the placeholder reads as a picture while it waits", () => {
    assert.deepEqual(client.parseBlocks(uploadingToken(1, "x.png")), [{ t: "image", alt: "Đang tải x.png…", src: "uploading:1" }]);
  });
});
