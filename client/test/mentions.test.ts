import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fromTokens, labelFor, toTokens, type Mentions } from "../src/mentions";

describe("mentions: the comment box's @Name <-> @[Name](accountId) round trip", () => {
  it("a single mention round-trips", () => {
    const token = "Chào @[Minh Quang](712020:abc), xem giúp";
    const { display, mentions } = fromTokens(token);
    assert.equal(display, "Chào @Minh Quang, xem giúp");
    assert.equal(toTokens(display, mentions), token);
  });

  it("two people with the same display name stay two people", () => {
    const token = "@[Nguyễn An](id-1) và @[Nguyễn An](id-2) họp lúc 9h";
    const { display, mentions } = fromTokens(token);
    // The box tells them apart on screen...
    assert.equal(display, "@Nguyễn An và @Nguyễn An (2) họp lúc 9h");
    // ...and the comment still names each one by their own account.
    assert.equal(toTokens(display, mentions), token);
  });

  it("the same person mentioned twice keeps one label and one account", () => {
    const token = "@[An](id-1) rồi lại @[An](id-1)";
    const { display, mentions } = fromTokens(token);
    assert.equal(display, "@An rồi lại @An");
    assert.equal(mentions.size, 1);
    assert.equal(toTokens(display, mentions), token);
  });

  it("a shorter label is not eaten by a longer one that starts with it", () => {
    const mentions: Mentions = new Map([
      ["Anh", { accountId: "a", name: "Anh" }],
      ["Anh Tuấn", { accountId: "b", name: "Anh Tuấn" }],
    ]);
    assert.equal(toTokens("@Anh Tuấn và @Anh.", mentions), "@[Anh Tuấn](b) và @[Anh](a).");
  });

  it("a name containing regex metacharacters is matched literally", () => {
    const mentions: Mentions = new Map([["A.B+C", { accountId: "x", name: "A.B+C" }]]);
    assert.equal(toTokens("@A.B+C ok, @AxB+C no", mentions), "@[A.B+C](x) ok, @AxB+C no");
  });

  it("text that merely looks like a mention but was not picked is left alone", () => {
    assert.equal(toTokens("@Ai đó", new Map()), "@Ai đó");
  });
});

describe("labelFor", () => {
  it("reuses a person's existing label and otherwise picks the first free one", () => {
    const m: Mentions = new Map([["An", { accountId: "1", name: "An" }]]);
    assert.equal(labelFor(m, "An", "1"), "An");
    assert.equal(labelFor(m, "An", "2"), "An (2)");
    m.set("An (2)", { accountId: "2", name: "An" });
    assert.equal(labelFor(m, "An", "3"), "An (3)");
  });
});
