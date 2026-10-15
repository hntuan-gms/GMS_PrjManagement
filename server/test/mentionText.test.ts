import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adfToCommentText, commentToAdf } from "../src/adf.js";
import { applyMentions, mentionsToPlain } from "../src/ai/mentionText.js";

const quang = { typed: "Quang", accountId: "712020:q", name: "Võ Đình Quang" };
const anh = { typed: "Anh", accountId: "712020:a", name: "Anh" };
const anhTuan = { typed: "Anh Tuấn", accountId: "712020:t", name: "Anh Tuấn" };

describe("applyMentions", () => {
  it("turns @name in the text into a mention token", () => {
    assert.equal(applyMentions("@Quang xem giúp nhé", [quang]), "@[Võ Đình Quang](712020:q) xem giúp nhé");
  });

  it("matches the typed name regardless of case", () => {
    assert.equal(applyMentions("cc @quang", [quang]), "cc @[Võ Đình Quang](712020:q)");
  });

  it("a person asked for but not written as @name is put at the front, so they are still notified", () => {
    assert.equal(applyMentions("Cần chốt phạm vi trước thứ Sáu", [quang]), "@[Võ Đình Quang](712020:q) Cần chốt phạm vi trước thứ Sáu");
  });

  it("does not eat a longer name that starts the same way", () => {
    assert.equal(
      applyMentions("@Anh Tuấn và @Anh nhé", [anh, anhTuan]),
      "@[Anh Tuấn](712020:t) và @[Anh](712020:a) nhé"
    );
  });

  it("does not match inside a longer word", () => {
    assert.equal(applyMentions("@Quangnam", [quang]), "@[Võ Đình Quang](712020:q) @Quangnam");
  });

  it("a name with regex metacharacters is matched literally", () => {
    const odd = { typed: "A.B+C", accountId: "x", name: "A.B+C" };
    assert.equal(applyMentions("@A.B+C ok", [odd]), "@[A.B+C](x) ok");
  });

  it("brackets in a display name cannot end the token early", () => {
    const m = { typed: "Lan", accountId: "x", name: "Lan [QA] (PM)" };
    assert.equal(applyMentions("@Lan hi", [m]), "@[Lan QA PM](x) hi");
  });

  it("the result becomes a real ADF mention that reads back as the same text", () => {
    const text = applyMentions("@Quang xem giúp", [quang]);
    assert.ok(JSON.stringify(commentToAdf(text)).includes('"id":"712020:q"'));
    assert.equal(adfToCommentText(commentToAdf(text)), text);
  });
});

describe("mentionsToPlain", () => {
  it("reads a token back as @Name", () => {
    assert.equal(mentionsToPlain("Chào @[Võ Đình Quang](712020:q), ok"), "Chào @Võ Đình Quang, ok");
  });
});
