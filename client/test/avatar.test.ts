import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initialsOf } from "../src/avatar";
import { initials } from "../src/boardModel";

describe("initialsOf", () => {
  it("takes the last word first, then the first word", () => {
    assert.equal(initialsOf("Nguyễn Anh"), "AN");
    assert.equal(initialsOf("Tuấn Test"), "TT");
    assert.equal(initialsOf("Nguyễn Văn An"), "AN");
    assert.equal(initialsOf("Trần Thị Thu Hà"), "HT");
  });

  it("gives one letter for one word", () => {
    assert.equal(initialsOf("Minh"), "M");
    assert.equal(initialsOf("  minh  "), "M");
  });

  it("uppercases Vietnamese letters, including đ and a decomposed form", () => {
    assert.equal(initialsOf("đức"), "Đ");
    assert.equal(initialsOf("lê đạt"), "ĐL");
    assert.equal(initialsOf("Lê Ánh"), "ÁL"); // NFD input
  });

  it("copes with extra spaces and tabs", () => {
    assert.equal(initialsOf("Nguyễn \t  Anh"), "AN");
  });

  it("is ? for nothing", () => {
    assert.equal(initialsOf(null), "?");
    assert.equal(initialsOf(undefined), "?");
    assert.equal(initialsOf(""), "?");
    assert.equal(initialsOf("   "), "?");
  });

  it("is what the board uses", () => {
    assert.equal(initials("Nguyễn Anh"), "AN");
    assert.equal(initials(null), "?");
  });
});
