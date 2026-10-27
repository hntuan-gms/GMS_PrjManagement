import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSnapshotWorthy } from "../src/progressSnapshotStore.js";

describe("daily snapshot gate (3.9)", () => {
  const now = Date.parse("2026-10-27T20:00:00Z");

  it("stores an unscoped view of today", () => {
    assert.equal(isSnapshotWorthy("2026-10-27", false, now), true);
  });

  it("accepts the browser's local date when it is a day ahead of UTC", () => {
    assert.equal(isSnapshotWorthy("2026-10-28", false, now), true);
  });

  it("never stores a view narrowed to one person, Epic or type — it would overwrite the project's figure with a partial one", () => {
    assert.equal(isSnapshotWorthy("2026-10-27", true, now), false);
  });

  it("refuses a date in the past or far ahead, so a made-up asOf cannot plant a point", () => {
    assert.equal(isSnapshotWorthy("2026-10-20", false, now), false);
    assert.equal(isSnapshotWorthy("2026-12-01", false, now), false);
    assert.equal(isSnapshotWorthy("not-a-date", false, now), false);
  });
});
