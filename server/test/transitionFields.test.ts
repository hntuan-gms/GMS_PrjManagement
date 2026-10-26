import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeField, fieldValue, fieldsNamedIn, requiredTransitionFields, type JiraFieldMeta } from "../src/transitionFields.js";

const meta = (o: Partial<JiraFieldMeta>): JiraFieldMeta => ({ name: "Field", ...o });

describe("describeField", () => {
  it("a single-line custom string is text, a textarea custom field is textarea", () => {
    assert.equal(describeField("customfield_1", meta({ schema: { type: "string", custom: "com.atlassian.jira.plugin.system.customfieldtypes:textfield" } })).kind, "text");
    assert.equal(describeField("customfield_2", meta({ schema: { type: "string", custom: "com.atlassian.jira.plugin.system.customfieldtypes:textarea" } })).kind, "textarea");
  });

  it("a select carries its options by id and label; without options it cannot be filled", () => {
    const f = describeField("resolution", meta({ name: "Resolution", schema: { type: "resolution" }, allowedValues: [{ id: "10000", name: "Done" }, { id: "10001", name: "Won't Do" }] }));
    assert.equal(f.kind, "select");
    assert.deepEqual(f.options, [{ id: "10000", label: "Done" }, { id: "10001", label: "Won't Do" }]);
    assert.equal(describeField("x", meta({ schema: { type: "option" }, allowedValues: [] })).kind, "unsupported");
  });

  it("users and multi-selects are not guessed at", () => {
    assert.equal(describeField("u", meta({ schema: { type: "user" } })).kind, "unsupported");
    assert.equal(describeField("a", meta({ schema: { type: "array", items: "option" } })).kind, "unsupported");
  });
});

describe("requiredTransitionFields", () => {
  it("keeps what is required and has no default; never asks for the comment", () => {
    const got = requiredTransitionFields({
      customfield_9: meta({ name: "RootCause", required: true, schema: { type: "string" } }),
      resolution: meta({ name: "Resolution", required: true, hasDefaultValue: true, schema: { type: "resolution" } }),
      comment: meta({ name: "Comment", required: true, schema: { type: "string" } }),
      customfield_8: meta({ name: "Optional", required: false, schema: { type: "string" } }),
    });
    assert.deepEqual(got.map((f) => f.id), ["customfield_9"]);
  });

  it("is empty when the transition has no screen", () => {
    assert.deepEqual(requiredTransitionFields(undefined), []);
  });
});

describe("fieldValue", () => {
  it("turns what was typed into what Jira's v3 expects", () => {
    assert.equal(fieldValue({ id: "a", name: "A", kind: "text" }, "  gốc rễ "), "gốc rễ");
    assert.equal(fieldValue({ id: "a", name: "A", kind: "number" }, "2,5"), 2.5);
    assert.deepEqual(fieldValue({ id: "a", name: "A", kind: "select", options: [{ id: "7", label: "Seven" }] }, "7"), { id: "7" });
    const adf = fieldValue({ id: "a", name: "A", kind: "textarea" }, "dòng 1") as { type: string };
    assert.equal(adf.type, "doc");
  });

  it("refuses empty input, an unknown option and a non-number", () => {
    assert.equal(fieldValue({ id: "a", name: "A", kind: "text" }, "   "), null);
    assert.equal(fieldValue({ id: "a", name: "A", kind: "select", options: [{ id: "7", label: "Seven" }] }, "9"), null);
    assert.equal(fieldValue({ id: "a", name: "A", kind: "number" }, "abc"), null);
    assert.equal(fieldValue({ id: "a", name: "A", kind: "unsupported" }, "x"), null);
  });
});

describe("fieldsNamedIn", () => {
  const editable = {
    customfield_10059: meta({ name: "Root Cause", schema: { type: "string" } }),
    customfield_2: meta({ name: "Reviewer", schema: { type: "user" } }),
    summary: meta({ name: "Tóm tắt", schema: { type: "string" } }),
  };

  it("finds the field a refusal quotes, ignoring case, spaces and diacritics", () => {
    assert.deepEqual(fieldsNamedIn("Vui lòng nhập RootCause", editable).map((f) => f.id), ["customfield_10059"]);
  });

  it("skips fields it cannot fill and messages that name nothing", () => {
    assert.deepEqual(fieldsNamedIn("Reviewer is required", editable), []);
    assert.deepEqual(fieldsNamedIn("Bước này bị chặn", editable), []);
  });
});
