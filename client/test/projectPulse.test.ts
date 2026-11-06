import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pulseCauses, pulseDecisions, pulseHeadline, stripSpi, suggestAssignee } from "../src/projectPulse";
import type { JiraUser, ProgressMetrics, ProgressTaskRef } from "../src/types";
import { task } from "./fixtures";

const TODAY = "2026-11-06";

const metrics = (o: Partial<ProgressMetrics> = {}, counts: Partial<ProgressMetrics["counts"]> = {}): ProgressMetrics => ({
  asOf: TODAY,
  counts: {
    total: 10,
    done: 3,
    inProgress: 3,
    todo: 4,
    overdue: 0,
    slipped: 0,
    dueSoon: 0,
    notStarted: 0,
    unassigned: 0,
    undated: 0,
    noBaseline: 0,
    criticalOpen: 0,
    ...counts,
  },
  actualPct: 40,
  plannedPct: 38,
  spi: 1.05,
  health: "on_track",
  healthReasons: ["Không có công việc quá hạn, không trễ baseline — hoàn thành 40%, kế hoạch 38%."],
  schedule: { start: "2026-10-01", plannedEnd: "2026-11-20", baselineEnd: "2026-11-20", slipDays: 0, daysRemaining: 14 },
  overdue: [],
  slipped: [],
  dueSoon: [],
  notStarted: [],
  unassigned: [],
  phases: [],
  people: [],
  ...o,
});

const ref = (id: string, critical: boolean): ProgressTaskRef => ({
  id,
  summary: id,
  assignee: null,
  startDate: null,
  dueDate: null,
  statusName: "To Do",
  critical,
});

describe("pulseHeadline", () => {
  it("behind: the slip leads, the two worst measured causes follow, then the forecast", () => {
    const m = metrics(
      {
        health: "off_track",
        spi: 0.5,
        actualPct: 17,
        plannedPct: 33,
        schedule: { start: "2026-10-01", plannedEnd: "2026-11-24", baselineEnd: "2026-11-20", slipDays: 4, daysRemaining: 18 },
        overdue: [{ ...ref("DEMO-5", true), daysLate: 2 }],
        unassigned: [ref("DEMO-7", true), ref("DEMO-8", true), ref("DEMO-9", true), ref("DEMO-10", false)],
      },
      { overdue: 1, unassigned: 4 }
    );
    const h = pulseHeadline(m);
    assert.equal(h.verdict, "bad");
    assert.equal(h.lead, "Chậm 4 ngày so với kế hoạch.");
    assert.equal(h.leadKey, "Chậm 4 ngày");
    assert.ok(h.lead.startsWith(h.leadKey));
    assert.equal(
      h.detail,
      "Nguyên nhân chính: DEMO-5 trên đường găng đã trễ 2 ngày, và 3 việc trên đường găng chưa có người. Dự kiến xong 24/11 (kế hoạch 20/11)."
    );
  });

  it("on track: no 'nguyên nhân', the figures and the finish date instead", () => {
    const h = pulseHeadline(metrics());
    assert.deepEqual(h, {
      verdict: "good",
      lead: "Đúng tiến độ.",
      leadKey: "Đúng tiến độ",
      detail: "Đã xong 40%, kế hoạch đến hôm nay là 38%. Dự kiến xong 20/11.",
    });
  });

  it("ahead of the baseline says so", () => {
    const m = metrics({ schedule: { start: null, plannedEnd: "2026-11-18", baselineEnd: "2026-11-20", slipDays: -2, daysRemaining: 12 } });
    assert.equal(pulseHeadline(m).lead, "Đúng tiến độ, sớm 2 ngày so với kế hoạch.");
  });

  it("at risk without a slip, and an empty project", () => {
    const risk = pulseHeadline(metrics({ health: "at_risk", spi: null }, { notStarted: 2 }));
    assert.equal(risk.verdict, "watch");
    assert.equal(risk.lead, "Có rủi ro chậm tiến độ.");
    assert.match(risk.detail, /^Nguyên nhân chính: 2 việc đã đến ngày bắt đầu mà chưa làm\./);
    const empty = pulseHeadline(metrics({}, { total: 0 }));
    assert.equal(empty.verdict, "watch");
    assert.equal(empty.lead, "Chưa có việc nào để đo tiến độ.");
  });

  it("SPI never reaches the surface", () => {
    assert.equal(stripSpi("Hoàn thành 30% so với kế hoạch 33% (SPI 0.91)."), "Hoàn thành 30% so với kế hoạch 33%.");
    assert.equal(stripSpi("Hoàn thành 10% trong khi kế hoạch là 40% (SPI 0.25, chậm 30 điểm %)."), "Hoàn thành 10% trong khi kế hoạch là 40%.");
    const causes = pulseCauses(metrics({ spi: 0.5, actualPct: 17, plannedPct: 33 }));
    assert.deepEqual(causes, ["mới xong 17% trong khi kế hoạch đến hôm nay là 33%"]);
  });

  it("non-critical late work is named when it is the only one", () => {
    const m = metrics({ health: "at_risk", overdue: [{ ...ref("DEMO-4", false), daysLate: 1 }] }, { overdue: 1 });
    assert.deepEqual(pulseCauses(m), ["DEMO-4 đã trễ 1 ngày"]);
  });
});

const users: JiraUser[] = [
  { accountId: "anh", displayName: "Nguyễn Anh", avatarUrl: null },
  { accountId: "chi", displayName: "Lê Chi", avatarUrl: null },
  { accountId: "binh", displayName: "Trần Bình", avatarUrl: null },
];
const who = (id: string, name: string) => ({ assigneeAccountId: id, assigneeName: name });
const based = (start: string, due: string) => ({ startDate: start, dueDate: due, baselineStart: start, baselineDue: due });

const tasks = [
  task({ id: "P-1", summary: "Giai đoạn", issueType: "Epic" }),
  task({ id: "P-2", summary: "Phân tích", ...who("anh", "Nguyễn Anh"), ...based("2026-10-26", "2026-11-04"), durationDays: 10 }),
  task({ id: "P-3", summary: "Thiết kế", ...based("2026-11-09", "2026-11-12"), durationDays: 4, predecessors: [{ taskId: "P-2", type: "FS", lagDays: 0 }] }),
  task({ id: "P-4", summary: "Dựng", ...who("chi", "Lê Chi"), ...based("2026-11-13", "2026-11-15"), durationDays: 3, predecessors: [{ taskId: "P-3", type: "FS", lagDays: 0 }] }),
  task({ id: "P-5", summary: "Sửa A", ...who("chi", "Lê Chi"), ...based("2026-11-09", "2026-11-10"), durationDays: 2 }),
  task({ id: "P-6", summary: "Sửa B", ...who("chi", "Lê Chi"), ...based("2026-11-10", "2026-11-11"), durationDays: 2 }),
  task({ id: "P-7", summary: "Báo cáo", ...who("binh", "Trần Bình"), ...based("2026-10-30", "2026-11-03"), durationDays: 5 }),
  task({ id: "P-8", summary: "Chưa baseline", ...who("binh", "Trần Bình"), startDate: "2026-11-09", dueDate: "2026-11-10", durationDays: 2, baselineStart: null, baselineDue: null }),
  task({ id: "P-9", summary: "Story có con", issueType: "Story" }),
  task({ id: "P-10", summary: "Con", issueType: "Sub-task", wbsParentId: "P-9", statusCategory: "done", ...who("binh", "Trần Bình") }),
];

describe("pulseDecisions", () => {
  const out = pulseDecisions(metrics({}, { noBaseline: 1 }), tasks, users, TODAY);

  it("at most three, most severe first", () => {
    assert.deepEqual(out.map((d) => d.kind), ["late-blocking", "unassigned-critical", "overloaded"]);
  });

  it("late work blocking the critical path", () => {
    assert.deepEqual(out[0], {
      kind: "late-blocking",
      title: "P-2 trễ 2 ngày",
      body: "Đang chặn P-3. Trên đường găng: mỗi ngày trễ đẩy lùi ngày kết thúc.",
      taskIds: ["P-2"],
      action: { kind: "open", label: "Xem phụ thuộc", taskId: "P-2" },
    });
  });

  it("critical work nobody owns, with the freest person suggested", () => {
    assert.deepEqual(out[1], {
      kind: "unassigned-critical",
      title: "P-3 chưa có người",
      body: "Trên đường găng, bắt đầu sau 3 ngày. Gợi ý: Nguyễn Anh (rảnh).",
      taskIds: ["P-3"],
      action: { kind: "assign", label: "Giao cho Anh", taskId: "P-3", suggestedAccountId: "anh" },
    });
  });

  it("an overload: two unestimated tasks on one working day", () => {
    assert.equal(out[2].title, "Lê Chi quá tải 10/11");
    assert.equal(out[2].body, "2 việc trùng ngày.");
    assert.deepEqual(out[2].taskIds, ["P-5", "P-6"]);
    assert.deepEqual(out[2].action, { kind: "rebalance", label: "Cân tải", accountId: "chi" });
  });

  it("with the worst handled, plain late work and missing baselines come up", () => {
    const calmer = tasks.filter((t) => !["P-2", "P-3", "P-6"].includes(t.id));
    const d = pulseDecisions(metrics({}, { noBaseline: 1 }), calmer, users, TODAY);
    assert.deepEqual(d.map((x) => x.kind), ["overdue", "no-baseline"]);
    assert.equal(d[0].title, "P-7 trễ 3 ngày");
    assert.equal(d[0].body, "Báo cáo · Trần Bình.");
    assert.deepEqual(d[1].taskIds, ["P-8"]);
    assert.equal(d[1].action.kind, "set-baseline");
  });

  it("Epics and parents with sub-tasks are never cards", () => {
    const ids = out.flatMap((d) => d.taskIds);
    for (const id of ["P-1", "P-9"]) assert.equal(ids.includes(id), false, id);
  });

  it("nothing to decide is an empty list", () => {
    assert.deepEqual(pulseDecisions(metrics(), [tasks[3]], users, TODAY), []);
  });
});

describe("suggestAssignee", () => {
  it("fewest clashing days first, then fewest open tasks", () => {
    assert.equal(suggestAssignee(tasks[2], users, tasks)?.user.accountId, "anh");
    const pick = suggestAssignee(tasks[2], users.slice(1), tasks);
    assert.deepEqual([pick?.user.accountId, pick?.busyDays], ["binh", 2]);
    assert.equal(suggestAssignee(tasks[2], [], tasks), null);
  });
});
