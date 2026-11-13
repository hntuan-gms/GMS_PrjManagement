import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "../src/errors.js";
import { canManage, decideManager, parseIdList, roleOf, validateRange, type Viewer } from "../src/viewerRoles.js";

function rejects(fn: () => unknown, pattern: RegExp) {
  assert.throws(fn, (e: unknown) => e instanceof AppError && e.status === 400 && pattern.test(e.message));
}

const viewer = (over: Partial<Viewer> = {}): Viewer => ({
  accountId: "me",
  manager: false,
  pmOf: new Set(),
  accessible: new Set(["GPM", "AI"]),
  ...over,
});

describe("validateRange", () => {
  it("accepts a window and refuses a reversed or endless one", () => {
    assert.deepEqual(validateRange("2026-11-01", "2026-12-01"), { from: "2026-11-01", to: "2026-12-01" });
    rejects(() => validateRange("2026-12-01", "2026-11-01"), /không hợp lệ/);
    rejects(() => validateRange("2020-01-01", "2026-11-01"), /quá dài/);
    rejects(() => validateRange(undefined, "2026-11-01"), /không hợp lệ/);
  });
});

describe("roles", () => {
  it("names the role from what the account manages", () => {
    assert.equal(roleOf(viewer()), "member");
    assert.equal(roleOf(viewer({ pmOf: new Set(["GPM"]) })), "pm");
    assert.equal(roleOf(viewer({ manager: true })), "manager");
  });

  it("a project manager reads their own projects' teams only", () => {
    const pm = viewer({ pmOf: new Set(["GPM"]) });
    assert.equal(canManage(pm, "GPM"), true);
    assert.equal(canManage(pm, "AI"), false);
    assert.equal(canManage(viewer(), "GPM"), false);
  });

  it("a resource manager reads any project they can browse, and no other", () => {
    const m = viewer({ manager: true });
    assert.equal(canManage(m, "AI"), true);
    assert.equal(canManage(m, "SECRET"), false);
  });
});

describe("who is a resource manager", () => {
  it("is named by account id", () => {
    assert.equal(decideManager("a1", null, { ids: ["a1"], group: null }), true);
    assert.equal(decideManager("a2", null, { ids: ["a1"], group: null }), false);
  });

  it("or belongs to the configured group, whatever its case", () => {
    const cfg = { ids: [], group: "Resource-Managers" };
    assert.equal(decideManager("a1", ["jira-users", "resource-managers"], cfg), true);
    assert.equal(decideManager("a1", ["jira-users"], cfg), false);
    assert.equal(decideManager("a1", null, cfg), false);
  });

  it("is nobody when nothing is configured", () => {
    assert.equal(decideManager("a1", ["anything"], { ids: [], group: null }), false);
  });

  it("reads the id list with semicolons and spaces", () => {
    assert.deepEqual(parseIdList(" a1; a2 ;;a3\n"), ["a1", "a2", "a3"]);
    assert.deepEqual(parseIdList(undefined), []);
  });
});
