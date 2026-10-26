import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { missingFields, neededFieldsFrom, uniqueFields } from "../src/transitionFields";
import type { TransitionField } from "../src/types";

const text = (id: string, name = id): TransitionField => ({ id, name, kind: "text" });

describe("neededFieldsFrom", () => {
  it("reads the form out of a refused status change", () => {
    const err = Object.assign(new Error("Chuyển sang Done cần nhập: RootCause."), {
      code: "TRANSITION_FIELDS_REQUIRED",
      details: { toStatusName: "Done", fields: [text("customfield_1", "RootCause")], reason: "Vui lòng nhập RootCause" },
    });
    const got = neededFieldsFrom(err);
    assert.equal(got?.toStatusName, "Done");
    assert.equal(got?.fields[0].name, "RootCause");
    assert.equal(got?.reason, "Vui lòng nhập RootCause");
  });

  it("is null for any other error, or one with nothing to ask", () => {
    assert.equal(neededFieldsFrom(new Error("boom")), null);
    assert.equal(neededFieldsFrom(Object.assign(new Error("x"), { code: "BAD_REQUEST" })), null);
    assert.equal(neededFieldsFrom(Object.assign(new Error("x"), { code: "TRANSITION_FIELDS_REQUIRED", details: { fields: [] } })), null);
    assert.equal(neededFieldsFrom(null), null);
  });
});

describe("missingFields", () => {
  it("lists what is blank or only spaces", () => {
    const got = missingFields([text("a"), text("b"), text("c")], { a: "x", b: "   " });
    assert.deepEqual(got.map((f) => f.id), ["b", "c"]);
  });

  it("never counts a field that cannot be filled here as answered", () => {
    const f: TransitionField = { id: "u", name: "Reviewer", kind: "unsupported" };
    assert.deepEqual(missingFields([f], { u: "someone" }).map((x) => x.id), ["u"]);
  });
});

describe("uniqueFields", () => {
  it("asks for a field once however many issues need it", () => {
    assert.deepEqual(uniqueFields([[text("a"), text("b")], [text("b"), text("c")]]).map((f) => f.id), ["a", "b", "c"]);
  });
});
