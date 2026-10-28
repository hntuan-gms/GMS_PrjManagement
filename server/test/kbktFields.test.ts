import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adfComparable } from "../src/adf.js";
import { applyFieldMap, autoFieldMap, fieldKind, resolveTargets, sameFieldValue, type JiraFieldMeta } from "../src/kbkt/fields.js";
import { parseWorkbook } from "../src/kbkt/parse.js";
import { DEFAULT_SETTINGS, validateSettings, withDefaults } from "../src/kbkt/settings.js";
import { buildSpecs } from "../src/kbkt/specs.js";
import { FakeJira } from "./kbktFakeJira.js";
import { sampleWorkbook } from "./kbktFixture.js";

const jira = new FakeJira();
const testMeta = (await jira.getCreateMetaFields("AI", "3")) as JiraFieldMeta[];
const bugMeta = (await jira.getCreateMetaFields("AI", "4")) as JiraFieldMeta[];
const specs = buildSpecs(parseWorkbook(sampleWorkbook()), "AI-33_1E127_v2.xlsx", DEFAULT_SETTINGS).specs;
const spec = (id: string) => structuredClone(specs.find((s) => s.id === id)!);

describe("fieldKind", () => {
  it("fills multi-line text as ADF, one-line text as a string, a single select by option; nothing else", () => {
    const by = (name: string) => testMeta.find((f) => f.name === name)!;
    assert.equal(fieldKind(by("Test Steps")), "adf");
    assert.equal(fieldKind(by("Module")), "text");
    assert.equal(fieldKind(by("Test Type")), "option");
    assert.equal(fieldKind(by("PIC")), null);
    assert.equal(fieldKind(by("Description")), null);
  });
});

describe("autoFieldMap", () => {
  it("matches the project's fields by name — the screen in the AI project", () => {
    assert.deepEqual(autoFieldMap("test", testMeta), {
      section: "customfield_10101",
      steps: "customfield_10103",
      expected: "customfield_10106",
      actual: "customfield_10105",
    });
  });

  it("lets a listed bug's evidence and a failed row's steps share Steps to Reproduce — they never meet in one issue", () => {
    assert.deepEqual(autoFieldMap("bug", bugMeta), {
      sev: "customfield_10201",
      cause: "customfield_10202",
      evidence: "customfield_10203",
      steps: "customfield_10203",
      expected: "customfield_10106",
      actual: "customfield_10105",
    });
  });

  it("finds nothing on a screen without such fields, so the description stays whole", () => {
    assert.deepEqual(autoFieldMap("test", testMeta.slice(0, 2)), {});
  });
});

describe("applyFieldMap", () => {
  const warns: string[] = [];
  const targets = resolveTargets("test", autoFieldMap("test", testMeta), testMeta, "Sub Testcase", (w) => warns.push(w));

  it("moves mapped sections into their fields and keeps the rest in the description", () => {
    const s = spec("tc-1E_127_3");
    applyFieldMap(s, targets, (w) => warns.push(w));
    assert.equal(s.fields!.customfield_10101, "Giao diện");
    assert.equal(adfComparable(s.fields!.customfield_10106), "Xuất được file");
    // Description: what has no field of its own, still in the script's order.
    assert.equal(
      adfComparable(s.description),
      ["Mục đích kiểm thử", "Kiểm tra xuất Excel", "Kết quả kiểm thử", "Lần 1 28/09/2026: F", "Lần 2: PE", "Nguồn", 'Sheet "1E_127 BC quản trị", dòng 15'].join("\n")
    );
  });

  it("an empty cell clears its field rather than being skipped — the file is the source of truth", () => {
    const s = spec("tc-1E_127_3");
    applyFieldMap(s, targets, () => {});
    // Row 15 has no steps and no actual result.
    assert.equal(s.fields!.customfield_10103, null);
    assert.equal(s.fields!.customfield_10105, null);
  });

  it("a value the select doesn't offer stays in the description, said once", () => {
    const bugTargets = resolveTargets("bug", autoFieldMap("bug", bugMeta), bugMeta, "Sub-Bug", () => {});
    const said: string[] = [];
    const s = spec("bug-1E_127_BUG-04"); // severity "-"
    applyFieldMap(s, bugTargets, (w) => said.push(w));
    assert.equal(s.fields!.customfield_10201, undefined);
    assert.match(adfComparable(s.description), /Mức độ\n-/);
    assert.equal(said.length, 1);
    const ok = spec("bug-1E_127_BUG-01"); // "Cao"
    applyFieldMap(ok, bugTargets, () => {});
    assert.deepEqual(ok.fields!.customfield_10201, { id: "customfield_10201-0" });
  });

  it("a configured field the screen lacks, or one that cannot be filled, is reported and left out", () => {
    const said: string[] = [];
    const t = resolveTargets("test", { steps: "customfield_99999", note: "customfield_10108" }, testMeta, "Sub Testcase", (w) => said.push(w));
    assert.equal(t.size, 0);
    assert.equal(said.length, 2);
    assert.match(said[0], /customfield_99999/);
    assert.match(said[1], /PIC/);
  });
});

describe("sameFieldValue", () => {
  it("compares ADF by its text, options by id, one-line text trimmed", () => {
    const adf = { kind: "adf" as const };
    assert.ok(sameFieldValue(adf, { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "a " }] }] }, { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] }));
    assert.ok(sameFieldValue(adf, null, null));
    assert.ok(!sameFieldValue(adf, null, { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }));
    assert.ok(sameFieldValue({ kind: "option" }, { id: "7", value: "Cao" }, { id: "7" }));
    assert.ok(!sameFieldValue({ kind: "option" }, null, { id: "7" }));
    assert.ok(sameFieldValue({ kind: "text" }, "Giao diện ", "Giao diện"));
  });
});

describe("settings.fieldMap", () => {
  it("keeps known sections and field-id values only; a kind not sent stays on name matching", () => {
    const s = validateSettings({
      ...DEFAULT_SETTINGS,
      fieldMap: { test: { steps: "customfield_10103", bogus: "customfield_1", note: "drop table" } },
    });
    assert.deepEqual(s.fieldMap, { test: { steps: "customfield_10103" } });
    assert.equal(validateSettings(DEFAULT_SETTINGS).fieldMap, undefined);
    assert.equal(withDefaults({}).fieldMap, undefined);
  });
});
