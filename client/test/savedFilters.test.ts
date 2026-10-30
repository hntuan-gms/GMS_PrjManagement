import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ME, fromSavedSpec, matchesSaved, toSavedSpec } from "../src/savedFilters";
import { EMPTY_TASK_FILTER, type TaskFilter } from "../src/taskFilter";

const f = (o: Partial<TaskFilter>): TaskFilter => ({ ...EMPTY_TASK_FILTER, ...o });

describe("saved filter spec", () => {
  it("stores the saver's own id as @me and never the search box", () => {
    const spec = toSavedSpec(f({ text: "api", people: new Set(["me-1", "none"]), labels: new Set(["b", "a"]) }), "me-1");
    assert.deepEqual(spec.people, [ME, "none"]);
    assert.deepEqual(spec.labels, ["a", "b"]);
    assert.equal("text" in spec, false);
  });

  it("@me becomes whoever applies it — a shared 'Của tôi' shows each person their own work", () => {
    const spec = toSavedSpec(f({ people: new Set(["anh"]), onlyOverdue: true }), "anh");
    const forBinh = fromSavedSpec(spec, "binh");
    assert.deepEqual([...forBinh.people], ["binh"]);
    assert.equal(forBinh.onlyOverdue, true);
    assert.equal(forBinh.text, "");
  });

  it("keeps the Trễ SLA toggle; a filter saved before it existed opens with it off", () => {
    assert.equal(fromSavedSpec(toSavedSpec(f({ onlySlaBreached: true }), "me-1"), "me-1").onlySlaBreached, true);
    const old = toSavedSpec(f({ onlyOverdue: true }), "me-1");
    delete old.onlySlaBreached;
    assert.equal(fromSavedSpec(old, "me-1").onlySlaBreached, false);
    assert.ok(matchesSaved(f({ onlyOverdue: true }), old, "me-1"));
  });

  it("recognises the filter in effect regardless of order or search text", () => {
    const spec = toSavedSpec(f({ statuses: new Set(["Done", "To Do"]), people: new Set(["me-1"]) }), "me-1");
    assert.ok(matchesSaved(f({ text: "x", statuses: new Set(["To Do", "Done"]), people: new Set(["me-1"]) }), spec, "me-1"));
    assert.ok(!matchesSaved(f({ statuses: new Set(["Done"]) }), spec, "me-1"));
    // The same saved filter, applied by someone else, matches their own id.
    assert.ok(matchesSaved(f({ statuses: new Set(["To Do", "Done"]), people: new Set(["chi"]) }), spec, "chi"));
  });
});
