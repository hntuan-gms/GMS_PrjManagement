import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textToAdf } from "../src/adf.js";

describe("textToAdf", () => {
  it("wraps a bare URL in a link mark rather than leaving it as plain text", () => {
    const flat = JSON.stringify(textToAdf("xem https://example.com/a.png nhé"));
    assert.ok(flat.includes('"type":"link"') && flat.includes('"href":"https://example.com/a.png"'));
  });
});
