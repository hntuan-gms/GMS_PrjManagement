import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildToday, slipIfLate, todayGreeting, upcomingHeading } from "../src/today";
import type { Predecessor } from "../src/types";
import { toWorkCalendar } from "../src/workCalendar";
import { task } from "./fixtures";

const TODAY = "2026-11-06"; // a Friday
const fs = (taskId: string, lagDays = 0): Predecessor => ({ taskId, type: "FS", lagDays });
const me = { assigneeAccountId: "me", assigneeName: "Tuấn" };
const chi = { assigneeAccountId: "chi", assigneeName: "Lê Chi" };

const tasks = [
  task({ id: "A-1", summary: "Phân tích", ...me, statusCategory: "indeterminate", startDate: "2026-11-02", dueDate: "2026-11-06", durationDays: 5 }),
  task({ id: "A-2", summary: "Chi chờ sát", ...chi, startDate: "2026-11-07", dueDate: "2026-11-08", durationDays: 2, predecessors: [fs("A-1")] }),
  task({ id: "A-3", summary: "Bình chờ xa", assigneeAccountId: "binh", assigneeName: "Bình", startDate: "2026-11-12", dueDate: "2026-11-13", durationDays: 2, predecessors: [fs("A-1")] }),
  task({ id: "A-4", summary: "của tôi", ...me, startDate: "2026-11-30", dueDate: "2026-11-30", durationDays: 1, predecessors: [fs("A-1")] }),
  task({ id: "A-5", summary: "xong rồi", ...chi, statusCategory: "done", predecessors: [fs("A-1")] }),
  task({ id: "A-9", summary: "chưa giao", startDate: "2026-11-07", dueDate: "2026-11-07", durationDays: 1, predecessors: [fs("A-1")] }),
  task({ id: "B-1", summary: "Quá hạn có người chờ", ...me, startDate: "2026-11-01", dueDate: "2026-11-04", durationDays: 4 }),
  task({ id: "B-2", summary: "Anh chờ", assigneeAccountId: "anh", assigneeName: "Anh", startDate: "2026-11-05", dueDate: "2026-11-09", durationDays: 5, predecessors: [fs("B-1")] }),
  task({ id: "C-1", summary: "Quá hạn", ...me, startDate: "2026-11-01", dueDate: "2026-11-03", durationDays: 3 }),
  task({ id: "D-1", summary: "Đang làm dài", ...me, statusCategory: "indeterminate", startDate: "2026-11-01", dueDate: "2026-11-20", durationDays: 20 }),
  task({ id: "D-2", summary: "Bắt đầu hôm nay", ...me, startDate: "2026-11-06", dueDate: "2026-11-08", durationDays: 3 }),
  task({ id: "E-1", summary: "Thứ hai", ...me, startDate: "2026-11-09", dueDate: "2026-11-09", durationDays: 1 }),
  task({ id: "E-2", summary: "Thứ hai nữa", ...me, startDate: "2026-11-09", dueDate: "2026-11-10", durationDays: 2 }),
  task({ id: "E-3", summary: "Thứ tư", ...me, startDate: "2026-11-11", dueDate: "2026-11-11", durationDays: 1 }),
  task({ id: "E-4", summary: "Xa quá", ...me, startDate: "2026-11-20", dueDate: "2026-11-21", durationDays: 2 }),
  task({ id: "F-1", summary: "Đã xong", ...me, statusCategory: "done", startDate: "2026-11-06", dueDate: "2026-11-06", durationDays: 1 }),
  task({ id: "G-1", summary: "Epic gán nhầm", ...me, issueType: "Epic", startDate: "2026-11-01", dueDate: "2026-11-02", durationDays: 2 }),
  task({ id: "H-1", summary: "Việc người khác", ...chi, startDate: "2026-11-06", dueDate: "2026-11-06", durationDays: 1 }),
];

describe("buildToday", () => {
  const r = buildToday(tasks, "me", TODAY);

  it("'đang chờ bạn': my open work with someone else's open work behind it, soonest waiter first", () => {
    assert.deepEqual(
      r.waitingOnMe.map((w) => [w.task.id, w.waiters.map((x) => x.task.id)]),
      [
        ["B-1", ["B-2"]],
        ["A-1", ["A-2", "A-3"]],
      ]
    );
  });

  it("slip: 1 day behind a successor with no slack, 0 with slack, more when I am already late", () => {
    const a1 = r.waitingOnMe.find((w) => w.task.id === "A-1")!;
    assert.deepEqual(a1.waiters.map((x) => [x.task.id, x.assigneeName, x.slipDaysIfLate]), [
      ["A-2", "Lê Chi", 1],
      ["A-3", "Bình", 0],
    ]);
    // B-1 was due 4/11; one more day late makes it end 7/11, so B-2 (starting 5/11) moves to 8/11.
    assert.equal(r.waitingOnMe[0].waiters[0].slipDaysIfLate, 3);
  });

  it("each task lands in one section: overdue excludes what is already waited on", () => {
    assert.deepEqual(r.overdue.map((t) => t.id), ["C-1"]);
    assert.deepEqual(r.today.map((t) => t.id), ["D-2", "D-1"]);
    const all = [...r.waitingOnMe.map((w) => w.task), ...r.overdue, ...r.today, ...r.upcoming.flatMap((g) => g.tasks)].map((t) => t.id);
    assert.equal(new Set(all).size, all.length);
  });

  it("upcoming: the next ten days, grouped by start date", () => {
    assert.deepEqual(r.upcoming.map((g) => [g.date, g.tasks.map((t) => t.id)]), [
      ["2026-11-09", ["E-1", "E-2"]],
      ["2026-11-11", ["E-3"]],
    ]);
  });

  it("done tasks, Epics and other people's work never appear", () => {
    const ids = new Set([...r.today, ...r.overdue, ...r.waitingOnMe.map((w) => w.task), ...r.upcoming.flatMap((g) => g.tasks)].map((t) => t.id));
    for (const id of ["F-1", "G-1", "H-1"]) assert.equal(ids.has(id), false, id);
  });

  it("counts and the greeting are over all my open work", () => {
    assert.deepEqual(r.counts, { doing: 2, dueThisWeek: 2 });
    assert.equal(r.greeting, "3 người đang chờ việc của bạn. Bạn có 2 việc quá hạn.");
  });

  it("nothing pressing: the calm default", () => {
    const calm = buildToday([tasks[9]], "me", TODAY);
    assert.equal(calm.greeting, "Không có gì gấp. Chúc một ngày tập trung.");
    assert.deepEqual(calm.today.map((t) => t.id), ["D-1"]);
  });
});

describe("todayGreeting", () => {
  it("names the holiday from the project calendar", () => {
    const calendar = toWorkCalendar({ workDays: [1, 2, 3, 4, 5], holidays: [{ date: TODAY, name: "Quốc khánh" }] });
    assert.equal(todayGreeting({ waitingPeople: 0, overdue: 1, today: TODAY, calendar }), "Hôm nay nghỉ lễ Quốc khánh. Bạn có 1 việc quá hạn.");
  });

  it("a weekend is a day off and wishes no focus", () => {
    assert.equal(todayGreeting({ waitingPeople: 0, overdue: 0, today: "2026-11-07" }), "Hôm nay là ngày nghỉ. Không có gì gấp.");
  });

  it("one person waiting", () => {
    assert.equal(todayGreeting({ waitingPeople: 1, overdue: 0, today: TODAY }), "1 người đang chờ việc của bạn.");
  });
});

describe("slipIfLate", () => {
  const mine = task({ id: "M", summary: "m", startDate: "2026-11-02", dueDate: "2026-11-06", durationDays: 5 });

  it("SS follows my start, not my end", () => {
    const succ = task({ id: "S", summary: "s", startDate: "2026-11-02", durationDays: 3 });
    assert.equal(slipIfLate(mine, succ, { taskId: "M", type: "SS", lagDays: 0 }, "2026-11-01"), 1);
  });

  it("FF with slack in the successor's own length", () => {
    const succ = task({ id: "S", summary: "s", startDate: "2026-11-06", dueDate: "2026-11-08", durationDays: 3 });
    // FF: succ must end ≥ my end. Mine ending 7/11 → succ may start 5/11; it starts 6/11 — no move.
    assert.equal(slipIfLate(mine, succ, { taskId: "M", type: "FF", lagDays: 0 }, "2026-11-01"), 0);
  });

  it("an undated side moves nothing", () => {
    assert.equal(slipIfLate(mine, task({ id: "S", summary: "s", startDate: null }), fs("M"), TODAY), 0);
  });
});

describe("unscheduled and the Sắp tới heading", () => {
  const list = [
    task({ id: "U-1", summary: "chưa có ngày", ...me, startDate: null, dueDate: null }),
    task({ id: "U-2", summary: "đang làm không ngày", ...me, statusCategory: "indeterminate", startDate: null, dueDate: null }),
    task({ id: "U-3", summary: "xong không ngày", ...me, statusCategory: "done", startDate: null, dueDate: null }),
    task({ id: "U-4", summary: "của người khác", ...chi, startDate: null, dueDate: null }),
    task({ id: "U-5", summary: "epic", ...me, issueType: "Epic", startDate: null, dueDate: null }),
  ];
  it("lists my open undated work that no other section claims", () => {
    const r = buildToday(list, "me", TODAY);
    assert.deepEqual(r.unscheduled.map((t) => t.id), ["U-1"]);
    assert.deepEqual(r.today.map((t) => t.id), ["U-2"]);
  });
  it("the group heading says it is the start day", () => {
    assert.equal(upcomingHeading("2026-11-11", TODAY), "Bắt đầu T4 11/11");
    assert.equal(upcomingHeading("2027-01-04", TODAY), "Bắt đầu T2 4/1/2027");
  });
});
