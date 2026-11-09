import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { statusTone } from "../src/statusTone";

describe("statusTone", () => {
  it("follows the team's mapping by name", () => {
    for (const n of ["Closed", "Done", "Reject", "Rejected", "Cancel", "Cancelled", "Canceled"]) {
      assert.equal(statusTone("done", n), "green", n);
    }
    for (const n of ["Inprogress", "In Progress", "In-Progress", "IN PROGRESS", "Resolved"]) {
      assert.equal(statusTone("indeterminate", n), "yellow", n);
    }
    assert.equal(statusTone("new", "Open"), "grey");
    for (const n of ["Reopen", "Reopened", "Re-open", "Pending"]) {
      assert.equal(statusTone("indeterminate", n), "orange", n);
    }
  });

  it("goes by the name, not the category, when the name is listed", () => {
    // Resolved is usually filed under done, Reopen under to do, Pending under either.
    assert.equal(statusTone("done", "Resolved"), "yellow");
    assert.equal(statusTone("new", "Reopened"), "orange");
    assert.equal(statusTone("new", "Pending"), "orange");
    assert.equal(statusTone("indeterminate", "Open"), "grey");
  });

  it("falls back to the category for names the mapping does not list", () => {
    assert.equal(statusTone("done", "Passed"), "green");
    assert.equal(statusTone("indeterminate", "In Review"), "yellow");
    assert.equal(statusTone("new", "To Do"), "grey");
    assert.equal(statusTone("new"), "grey");
  });

  it("does not take a word that merely contains a listed one", () => {
    assert.equal(statusTone("new", "Opening soon"), "grey");
    assert.equal(statusTone("indeterminate", "Not done yet"), "yellow");
  });
});
