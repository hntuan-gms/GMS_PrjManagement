import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canEditAbsence,
  canWrite,
  decideManager,
  parseIdList,
  roleOf,
  shapeForViewer,
  validateBookingInput,
  validateBookingPatch,
  validateRange,
  visibleAccounts,
  type Booking,
  type Viewer,
} from "../src/booking.js";
import { AppError } from "../src/errors.js";

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

const booking = (over: Partial<Booking> = {}): Booking => ({
  id: "1",
  accountId: "quang",
  projectKey: "GPM",
  from: "2026-12-01",
  to: "2026-12-31",
  hoursPerDay: 4,
  status: "tentative",
  note: "chờ ký hợp đồng",
  createdBy: "pm",
  ...over,
});

describe("validateBookingInput", () => {
  const ok = { accountId: "quang", projectKey: "GPM", from: "2026-12-01", to: "2026-12-31", hoursPerDay: 4 };

  it("fills the defaults and trims", () => {
    assert.deepEqual(validateBookingInput({ ...ok, note: "  " }), { ...ok, status: "tentative", note: null });
  });

  it("reads a comma decimal and rounds to quarter hours", () => {
    assert.equal(validateBookingInput({ ...ok, hoursPerDay: "1,3" }).hoursPerDay, 1.25);
    assert.equal(validateBookingInput({ ...ok, hoursPerDay: 0.1 }).hoursPerDay, 0.25);
  });

  it("refuses hours that are not a working day", () => {
    for (const h of [0, -1, 17, "abc", null, ""]) rejects(() => validateBookingInput({ ...ok, hoursPerDay: h }), /Giờ mỗi ngày/);
  });

  it("refuses a reversed or absurd range", () => {
    rejects(() => validateBookingInput({ ...ok, from: "2026-12-10", to: "2026-12-01" }), /Ngày kết thúc/);
    rejects(() => validateBookingInput({ ...ok, to: "2036-12-01" }), /hai năm/);
    rejects(() => validateBookingInput({ ...ok, from: "01/12/2026" }), /YYYY-MM-DD/);
    rejects(() => validateBookingInput({ ...ok, from: "2026-13-40" }), /YYYY-MM-DD/);
  });

  it("refuses a missing person, project or an unknown status", () => {
    rejects(() => validateBookingInput({ ...ok, accountId: " " }), /người/);
    rejects(() => validateBookingInput({ ...ok, projectKey: "GPM-1" }), /dự án/);
    rejects(() => validateBookingInput({ ...ok, status: "approved" }), /Dự kiến hoặc Chắc/);
  });
});

describe("validateBookingPatch", () => {
  const current = { from: "2026-12-01", to: "2026-12-31" };

  it("keeps only what was sent", () => {
    assert.deepEqual(validateBookingPatch({ status: "confirmed" }, current), { status: "confirmed" });
    assert.deepEqual(validateBookingPatch({ note: null }, current), { note: null });
  });

  it("checks one moved end against the stored other end", () => {
    rejects(() => validateBookingPatch({ to: "2026-11-01" }, current), /Ngày kết thúc/);
    assert.deepEqual(validateBookingPatch({ to: "2026-12-05" }, current), { to: "2026-12-05" });
  });

  it("never moves a booking to another project, and wants something to change", () => {
    rejects(() => validateBookingPatch({ projectKey: "AI" }, current), /Không đổi được dự án/);
    rejects(() => validateBookingPatch({}, current), /Không có gì/);
  });
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

  it("lets a project manager write their own projects only", () => {
    const pm = viewer({ pmOf: new Set(["GPM"]) });
    assert.equal(canWrite(pm, "GPM"), true);
    assert.equal(canWrite(pm, "AI"), false);
    assert.equal(canWrite(viewer(), "GPM"), false);
  });

  it("lets a resource manager write any project they can browse, and no other", () => {
    const m = viewer({ manager: true });
    assert.equal(canWrite(m, "AI"), true);
    assert.equal(canWrite(m, "SECRET"), false);
  });

  it("lets a person enter their own leave, and managers anyone's", () => {
    assert.equal(canEditAbsence(viewer(), "me"), true);
    assert.equal(canEditAbsence(viewer(), "quang"), false);
    assert.equal(canEditAbsence(viewer({ pmOf: new Set(["GPM"]) }), "quang"), true);
  });
});

describe("what a viewer sees", () => {
  const all = [
    booking({ id: "1", accountId: "quang", projectKey: "GPM" }),
    booking({ id: "2", accountId: "quang", projectKey: "SECRET", note: "bí mật" }),
    booking({ id: "3", accountId: "minh", projectKey: "AI" }),
    booking({ id: "4", accountId: "me", projectKey: "AI" }),
  ];

  it("a member sees their own rows and nobody else's", () => {
    const v = viewer();
    const visible = visibleAccounts(v, all);
    assert.deepEqual([...(visible as Set<string>)], ["me"]);
    const shown = shapeForViewer(v, all, visible);
    assert.deepEqual(shown.map((b) => b.id), ["4"]);
    assert.equal(shown[0].editable, false);
  });

  it("a project manager sees the people booked on their project, with their other bookings", () => {
    const v = viewer({ pmOf: new Set(["GPM"]) });
    const visible = visibleAccounts(v, all);
    const shown = shapeForViewer(v, all, visible);
    assert.deepEqual(shown.map((b) => b.id), ["1", "2", "4"]);
    // Minh is on AI only, which this viewer browses but does not manage: not their person.
    assert.equal(shown.some((b) => b.accountId === "minh"), false);
  });

  it("hides the name and the note of a project the viewer cannot browse, and keeps its hours", () => {
    const v = viewer({ pmOf: new Set(["GPM"]) });
    const secret = shapeForViewer(v, all, visibleAccounts(v, all)).find((b) => b.id === "2")!;
    assert.equal(secret.projectKey, null);
    assert.equal(secret.note, null);
    assert.equal(secret.hoursPerDay, 4);
    assert.equal(secret.editable, false);
  });

  it("marks only the managed project's bookings editable", () => {
    const v = viewer({ pmOf: new Set(["GPM"]) });
    const shown = shapeForViewer(v, all, visibleAccounts(v, all));
    assert.deepEqual(shown.filter((b) => b.editable).map((b) => b.id), ["1"]);
  });

  it("gives the team of the project being viewed a row before anyone is booked", () => {
    const v = viewer({ pmOf: new Set(["GPM"]) });
    const visible = visibleAccounts(v, [], ["lan"]) as Set<string>;
    assert.equal(visible.has("lan"), true);
  });

  it("a resource manager sees everyone, and still no name for a project they cannot browse", () => {
    const v = viewer({ manager: true });
    assert.equal(visibleAccounts(v, all), "all");
    const shown = shapeForViewer(v, all, "all");
    assert.equal(shown.length, 4);
    assert.equal(shown.find((b) => b.id === "2")!.projectKey, null);
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
