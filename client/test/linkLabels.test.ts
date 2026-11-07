import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { linkLabel } from "../src/linkLabels";

describe("linkLabel", () => {
  it("says the stock link types in Vietnamese, either end", () => {
    assert.equal(linkLabel("blocks"), "chặn");
    assert.equal(linkLabel("is blocked by"), "bị chặn bởi");
    assert.equal(linkLabel("Relates To"), "liên quan đến");
  });
  it("keeps the name of a type this site added", () => {
    assert.equal(linkLabel("tests"), "tests");
    assert.equal(linkLabel("Là cha của"), "Là cha của");
  });
});
