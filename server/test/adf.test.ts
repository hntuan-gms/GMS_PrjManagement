import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adfToCommentText, commentToAdf, textToAdf } from "../src/adf.js";

const text = "Chào @[Minh Quang](712020:abc-123), xem https://x.com/y. nhé\nDòng hai\n\nĐoạn mới";

describe("commentToAdf / adfToCommentText", () => {
  it("turns a mention token into a real ADF mention node (what makes Jira notify them)", () => {
    const flat = JSON.stringify(commentToAdf(text));
    assert.ok(flat.includes('"type":"mention"') && flat.includes('"id":"712020:abc-123"'));
  });

  it("round-trips text, mention and paragraph break", () => {
    assert.equal(adfToCommentText(commentToAdf(text)), text);
  });

  it("keeps a link's target beside its words, so editing a comment does not lose the URL", () => {
    const doc = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "see " },
            { type: "text", text: "the spec", marks: [{ type: "link", attrs: { href: "https://e.com/s" } }] },
          ],
        },
      ],
    };
    assert.equal(adfToCommentText(doc), "see the spec (https://e.com/s)");
  });

  it("flattens a bullet list written in Jira's own editor instead of dropping it", () => {
    const item = (t: string) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
    const doc = { type: "doc", version: 1, content: [{ type: "bulletList", content: [item("một"), item("hai")] }] };
    assert.equal(adfToCommentText(doc), "• một\n• hai");
  });

  it("tolerates garbage", () => {
    assert.equal(adfToCommentText(null), "");
    assert.equal(adfToCommentText("nope"), "");
  });

  it("an empty comment still yields a valid document", () => {
    assert.equal(commentToAdf("").type, "doc");
  });
});

describe("textToAdf", () => {
  it("wraps a bare URL in a link mark rather than leaving it as plain text", () => {
    const flat = JSON.stringify(textToAdf("xem https://example.com/a.png nhé"));
    assert.ok(flat.includes('"type":"link"') && flat.includes('"href":"https://example.com/a.png"'));
  });
});
