import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assignHints, describeHint } from "../src/assignHints";
import { buildResourceLoad } from "../src/resourceAllocation";
import { toWorkCalendar } from "../src/workCalendar";
import type { JiraUser, ResourceAbsence } from "../src/types";
import { task } from "./fixtures";

const user = (accountId: string, displayName: string): JiraUser => ({ accountId, displayName, avatarUrl: null });
const people = [user("an", "An"), user("binh", "Bình"), user("chi", "Chi")];

// 2026-11-02 is a Monday. Window covers two weeks.
const from = "2026-11-02";
const to = "2026-11-15";

function load(tasks: ReturnType<typeof task>[], absences: ResourceAbsence[] = [], calendar = toWorkCalendar(null)) {
  return buildResourceLoad({ tasks, users: people, profiles: [], absences, from, to, includeIdle: true, calendar });
}

const asked = task({ id: "N-1", summary: "việc mới", startDate: "2026-11-03", dueDate: "2026-11-05", durationDays: 3 });
const busy = (id: string, accountId: string, s: string, e: string) =>
  task({ id, summary: id, startDate: s, dueDate: e, assigneeAccountId: accountId, assigneeName: accountId });

describe("assignHints", () => {
  it("with no dates there is nothing to measure: names only, alphabetical", () => {
    const undated = task({ id: "N-2", summary: "chưa xếp", startDate: null, dueDate: null });
    const h = assignHints(undated, [people[2], people[0], people[1]], load([]), toWorkCalendar(null));
    assert.deepEqual(h.map((x) => x.accountId), ["an", "binh", "chi"]);
    assert.ok(h.every((x) => !x.ranged && x.conflictDays === 0 && x.away === null));
  });

  it("someone with nothing booked is free for the whole span", () => {
    const h = assignHints(asked, people, load([]), toWorkCalendar(null));
    assert.ok(h.every((x) => x.ranged && x.conflictDays === 0 && x.freeHours === 24 && x.availableDays === 3));
  });

  it("counts a conflict only on days of the task's own span", () => {
    // An is booked a full day on Wed 4 and Thu 5 (inside), and all of the next week (outside).
    const l = load([busy("A-1", "an", "2026-11-04", "2026-11-05"), busy("A-2", "an", "2026-11-09", "2026-11-13")]);
    const h = assignHints(asked, people, l, toWorkCalendar(null));
    const an = h.find((x) => x.accountId === "an")!;
    assert.equal(an.conflictDays, 2);
    assert.equal(an.freeHours, 8); // only Tuesday is free
  });

  it("two tasks piled on one day still conflict once for that day", () => {
    const l = load([busy("A-1", "an", "2026-11-04", "2026-11-04"), busy("A-2", "an", "2026-11-04", "2026-11-04")]);
    const an = assignHints(asked, people, l, toWorkCalendar(null)).find((x) => x.accountId === "an")!;
    assert.equal(an.conflictDays, 1);
  });

  it("orders fewest conflict days first, then more free hours, then name", () => {
    const l = load([
      busy("A-1", "an", "2026-11-03", "2026-11-05"), // An: 3 conflict days
      busy("B-1", "binh", "2026-11-04", "2026-11-04"), // Bình: 1 conflict day
    ]);
    assert.deepEqual(assignHints(asked, people, l, toWorkCalendar(null)).map((x) => x.accountId), ["chi", "binh", "an"]);
  });

  it("a half day booked leaves room and is not a conflict; more free hours wins a tie", () => {
    const half = task({ ...busy("B-1", "binh", "2026-11-03", "2026-11-05"), estimateHours: 12 }); // 4h a day
    const small = task({ ...asked, estimateHours: 6 }); // 2h a day
    const h = assignHints(small, people, load([half]), toWorkCalendar(null));
    assert.equal(h.find((x) => x.accountId === "binh")!.conflictDays, 0);
    assert.equal(h.find((x) => x.accountId === "binh")!.freeHours, 12);
    assert.deepEqual(h.map((x) => x.accountId), ["an", "chi", "binh"]);
  });

  it("someone on leave has no available days there, and the leave is named", () => {
    const leave: ResourceAbsence = { id: "x", accountId: "chi", from: "2026-11-04", to: "2026-11-06", reason: null };
    const l = load([], [leave]);
    const chi = assignHints(asked, people, l, toWorkCalendar(null)).find((x) => x.accountId === "chi")!;
    assert.deepEqual(chi.away, { from: "2026-11-04", to: "2026-11-06" });
    assert.equal(chi.awayDays, 2);
    assert.equal(chi.availableDays, 1);
    assert.equal(chi.freeHours, 8);
  });

  it("a holiday is nobody's working day", () => {
    const cal = toWorkCalendar({ workDays: [1, 2, 3, 4, 5], holidays: [{ date: "2026-11-04", name: "Nghỉ lễ" }] });
    const h = assignHints(asked, people, load([], [], cal), cal);
    assert.ok(h.every((x) => x.availableDays === 2 && x.freeHours === 16 && x.away === null));
  });

  it("a weekend span has no working days: no conflicts, no free hours", () => {
    const weekend = task({ id: "N-3", summary: "cuối tuần", startDate: "2026-11-07", dueDate: "2026-11-08" });
    const h = assignHints(weekend, people, load([]), toWorkCalendar(null));
    assert.ok(h.every((x) => x.availableDays === 0 && x.conflictDays === 0 && x.freeHours === 0));
  });

  it("the task's current owner is measured without the task itself", () => {
    const mine = { ...asked, assigneeAccountId: "an", assigneeName: "An" };
    const h = assignHints(mine, people, load([mine]), toWorkCalendar(null));
    const an = h.find((x) => x.accountId === "an")!;
    assert.equal(an.conflictDays, 0);
    assert.equal(an.freeHours, 24);
  });

  it("a person the load does not list counts as empty", () => {
    const ghost = user("moi", "Mới");
    const h = assignHints(asked, [ghost], load([]), toWorkCalendar(null));
    assert.equal(h[0].conflictDays, 0);
    assert.equal(h[0].freeHours, 24);
  });

  it("says what a row should say beside the name", () => {
    const leave: ResourceAbsence = { id: "x", accountId: "chi", from: "2026-11-04", to: "2026-11-06", reason: null };
    const l = load([busy("A-1", "an", "2026-11-04", "2026-11-05")], [leave]);
    const h = new Map(assignHints(asked, people, l, toWorkCalendar(null)).map((x) => [x.accountId, x]));
    assert.deepEqual(describeHint(h.get("an")), { text: "trùng 2 ngày", tone: "risk" });
    assert.deepEqual(describeHint(h.get("binh")), { text: "rảnh", tone: "ok" });
    assert.deepEqual(describeHint(h.get("chi")), { text: "nghỉ 4–6/11" }); // Tuesday is still free
    const away = task({ ...asked, startDate: "2026-11-04", dueDate: "2026-11-05" });
    const all = new Map(assignHints(away, people, l, toWorkCalendar(null)).map((x) => [x.accountId, x]));
    assert.deepEqual(describeHint(all.get("chi")), { text: "nghỉ 4–6/11", tone: "risk" });
    assert.equal(describeHint(undefined), null);
    assert.equal(describeHint(assignHints({ ...asked, startDate: null, dueDate: null }, people, l)[0]), null);
  });

  it("dates outside the load's window are unknown, not conflicts", () => {
    const far = task({ id: "N-4", summary: "xa", startDate: "2027-03-01", dueDate: "2027-03-02" });
    const h = assignHints(far, people, load([]), toWorkCalendar(null));
    assert.ok(h.every((x) => x.conflictDays === 0));
  });
});
