import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "../src/errors.js";
import { MAX_NAME, validateFilterInput, validateSpec } from "../src/savedFilters.js";

const spec = { people: ["@me", "none"], statuses: ["In Progress"], types: [], epics: [], labels: [], priorities: [], onlyOverdue: false };

function rejects(fn: () => unknown, pattern: RegExp) {
  assert.throws(fn, (e: unknown) => e instanceof AppError && e.status === 400 && pattern.test(e.message));
}

describe("validateSpec", () => {
  it("keeps the facets, fills missing lists, drops unknown keys and duplicates", () => {
    const out = validateSpec({ people: ["a", "a"], onlyOverdue: true, text: "tìm gì đó", onlyBlocked: true });
    assert.deepEqual(out, {
      people: ["a"],
      statuses: [],
      types: [],
      epics: [],
      labels: [],
      priorities: [],
      onlyOverdue: true,
    });
    // The search box is never part of a saved view.
    assert.equal("text" in out, false);
  });

  it("refuses an empty filter, wrong types and oversized lists", () => {
    rejects(() => validateSpec({}), /trống/);
    rejects(() => validateSpec({ people: "a" }), /people/);
    rejects(() => validateSpec({ labels: [1] }), /labels/);
    rejects(() => validateSpec({ onlyOverdue: "yes" }), /onlyOverdue/);
    rejects(() => validateSpec({ statuses: Array.from({ length: 201 }, (_, i) => `s${i}`) }), /quá nhiều/);
    rejects(() => validateSpec({ statuses: ["x".repeat(201)] }), /quá dài/);
  });
});

describe("validateFilterInput", () => {
  it("a create needs a name and a spec; shared defaults to private", () => {
    assert.deepEqual(validateFilterInput({ name: "  Việc  của   tôi ", spec }, false), {
      name: "Việc của tôi",
      shared: false,
      spec,
    });
    rejects(() => validateFilterInput({ spec }, false), /tên/);
    rejects(() => validateFilterInput({ name: "   ", spec }, false), /tên/);
    rejects(() => validateFilterInput({ name: "x".repeat(MAX_NAME + 1), spec }, false), /tối đa/);
    rejects(() => validateFilterInput({ name: "A" }, false), /nội dung/);
  });

  it("an update takes any subset, but not nothing", () => {
    assert.deepEqual(validateFilterInput({ shared: true }, true), { shared: true });
    assert.deepEqual(validateFilterInput({ name: "B" }, true), { name: "B" });
    rejects(() => validateFilterInput({ shared: "yes" }, true), /shared/);
    rejects(() => validateFilterInput({}, true), /Không có gì/);
    rejects(() => validateFilterInput(null, true), /không hợp lệ/);
  });
});
