import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { overloadFromLoad, phaseStatus, pulseCauses, pulseDecisions, pulseHeadline, stripSpi, suggestAssignee } from "../src/projectPulse";
import type { JiraUser, ProgressMetrics, ProgressTaskRef } from "../src/types";
import { task } from "./fixtures";
import { addDays, buildResourceLoad } from "../src/resourceAllocation";

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
  it("behind the baseline: the verdict is in days, the forecast names the deadline, the causes wait for 'Vì sao?'", () => {
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
    assert.equal(h.lead, "Chậm 4 ngày.");
    assert.equal(h.leadKey, "Chậm 4 ngày");
    assert.equal(h.forecast, "Dự kiến xong 24/11, hạn 20/11.");
    assert.deepEqual(h.reasons.slice(0, 2), ["DEMO-5 trên đường găng đã trễ 2 ngày.", "3 việc trên đường găng chưa có người."]);
    // The overall gap is the bar under the sentence, not a reason.
    assert.equal(h.reasons.some((r) => r.includes("mới xong")), false);
    assert.match(h.reasons.at(-1)!, /^Chỉ số tiến độ \(SPI\) 0,5: đã làm được 50%/);
  });

  it("behind with no slip in days: the gap in whole points", () => {
    const h = pulseHeadline(metrics({ health: "off_track", spi: 0.43, actualPct: 16.7, plannedPct: 38.9 }));
    assert.equal(h.lead, "Chậm 22 điểm.");
    assert.equal(h.forecast, "Dự kiến xong 20/11.");
  });

  it("on track: the plain verdict and the finish date; SPI still explained under 'Vì sao?'", () => {
    const h = pulseHeadline(metrics({ actualPct: 40, plannedPct: 39.6 }));
    assert.equal(h.verdict, "good");
    assert.equal(h.lead, "Đúng tiến độ.");
    assert.equal(h.forecast, "Dự kiến xong 20/11.");
    assert.equal(h.reasons.length, 1);
    assert.match(h.reasons[0], /SPI\) 1,05/);
  });

  it("ahead says by how much, in days or in points", () => {
    const days = metrics({ schedule: { start: null, plannedEnd: "2026-11-18", baselineEnd: "2026-11-20", slipDays: -2, daysRemaining: 12 } });
    assert.equal(pulseHeadline(days).lead, "Đúng tiến độ, sớm 2 ngày.");
    assert.equal(pulseHeadline(days).forecast, "Dự kiến xong 18/11, hạn 20/11.");
    assert.equal(pulseHeadline(metrics({ actualPct: 45, plannedPct: 38 })).lead, "Đi trước 7 điểm.");
  });

  it("at risk without a measurable gap, and an empty project", () => {
    const risk = pulseHeadline(metrics({ health: "at_risk", spi: null }, { notStarted: 2 }));
    assert.equal(risk.verdict, "watch");
    assert.equal(risk.lead, "Có rủi ro chậm.");
    assert.equal(risk.reasons[0], "2 việc đã đến ngày bắt đầu mà chưa làm.");
    assert.match(risk.reasons.at(-1)!, /còn quá sớm/);
    const empty = pulseHeadline(metrics({}, { total: 0 }));
    assert.equal(empty.verdict, "watch");
    assert.equal(empty.lead, "Chưa có việc nào để đo tiến độ.");
    assert.deepEqual(empty.reasons, []);
  });

  it("SPI is stripped from quoted server reasons; causes are whole percentages", () => {
    assert.equal(stripSpi("Hoàn thành 30% so với kế hoạch 33% (SPI 0.91)."), "Hoàn thành 30% so với kế hoạch 33%.");
    assert.equal(stripSpi("Hoàn thành 10% trong khi kế hoạch là 40% (SPI 0.25, chậm 30 điểm %)."), "Hoàn thành 10% trong khi kế hoạch là 40%.");
    const causes = pulseCauses(metrics({ spi: 0.5, actualPct: 16.7, plannedPct: 33.3 }));
    assert.deepEqual(causes, ["mới xong 17% trong khi kế hoạch đến hôm nay là 33%"]);
  });

  it("non-critical late work is named when it is the only one", () => {
    const m = metrics({ health: "at_risk", overdue: [{ ...ref("DEMO-4", false), daysLate: 1 }] }, { overdue: 1 });
    assert.deepEqual(pulseCauses(m), ["DEMO-4 đã trễ 1 ngày"]);
  });

  it("missing baselines are a reason only when no row already says so", () => {
    const m = metrics({}, { noBaseline: 3 });
    assert.ok(pulseHeadline(m).reasons.some((r) => r.startsWith("3 việc chưa có baseline")));
    const row = { kind: "no-baseline" as const, title: "", body: "", taskIds: [], actions: [] };
    assert.equal(pulseHeadline(m, [row]).reasons.some((r) => r.includes("baseline")), false);
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
      body: "Phân tích · Nguyễn Anh. Đang chặn P-3. Trên đường găng: mỗi ngày trễ đẩy lùi ngày kết thúc.",
      taskIds: ["P-2"],
      actions: [
        { kind: "reschedule", label: "Dời hạn", taskId: "P-2" },
        { kind: "reassign", label: "Giao lại", taskId: "P-2" },
      ],
    });
  });

  it("critical work nobody owns, with the freest person suggested", () => {
    assert.deepEqual(out[1], {
      kind: "unassigned-critical",
      title: "P-3 chưa có người",
      body: "Trên đường găng, bắt đầu sau 3 ngày. Gợi ý: Nguyễn Anh (rảnh).",
      taskIds: ["P-3"],
      actions: [
        { kind: "pick", label: "Chọn…", taskId: "P-3" },
        { kind: "assign", label: "Giao cho Anh", taskId: "P-3", suggestedAccountId: "anh" },
      ],
    });
  });

  it("an overload: two unestimated tasks on one working day", () => {
    assert.equal(out[2].title, "Lê Chi quá tải 10/11");
    assert.equal(out[2].body, "2 việc trùng ngày.");
    assert.deepEqual(out[2].taskIds, ["P-5", "P-6"]);
    assert.deepEqual(out[2].actions, [{ kind: "rebalance", label: "Xem lịch Chi", accountId: "chi", date: "2026-11-10" }]);
  });

  it("with the worst handled, plain late work and missing baselines come up", () => {
    const calmer = tasks.filter((t) => !["P-2", "P-3", "P-6"].includes(t.id));
    const d = pulseDecisions(metrics({}, { noBaseline: 1 }), calmer, users, TODAY);
    assert.deepEqual(d.map((x) => x.kind), ["overdue", "no-baseline"]);
    assert.equal(d[0].title, "P-7 trễ 3 ngày");
    assert.equal(d[0].body, "Báo cáo · Trần Bình.");
    assert.deepEqual(d[1].taskIds, ["P-8"]);
    assert.deepEqual(d[0].actions.map((a) => a.kind), ["reschedule", "reassign"]);
    assert.equal(d[1].actions[0].kind, "set-baseline");
  });

  it("Epics and parents with sub-tasks are never cards", () => {
    const ids = out.flatMap((d) => d.taskIds);
    for (const id of ["P-1", "P-9"]) assert.equal(ids.includes(id), false, id);
  });

  it("nothing to decide is an empty list", () => {
    assert.deepEqual(pulseDecisions(metrics(), [tasks[3]], users, TODAY), []);
  });
});

describe("one idea said once (plan H6)", () => {
  const behind = metrics(
    {
      health: "off_track",
      spi: 0.5,
      actualPct: 17,
      plannedPct: 33,
      schedule: { start: "2026-10-01", plannedEnd: "2026-11-24", baselineEnd: "2026-11-20", slipDays: 4, daysRemaining: 18 },
      overdue: [{ ...ref("P-2", true), daysLate: 2 }],
      unassigned: [ref("P-3", true)],
    },
    { overdue: 1, unassigned: 1, notStarted: 2 }
  );
  const decisions = pulseDecisions(behind, tasks, users, TODAY);
  const keysIn = (text: string) => text.match(/[A-Z]+-\d+/g) ?? [];

  it("a cause that is already a decision row is not repeated under 'Vì sao?'", () => {
    const h = pulseHeadline(behind, decisions);
    assert.equal(h.lead, "Chậm 4 ngày.");
    assert.equal(h.reasons.some((r) => r.includes("đường găng")), false);
    // what no row can carry stays
    assert.ok(h.reasons.includes("2 việc đã đến ngày bắt đầu mà chưa làm."));
  });

  it("no issue key is in both the reasons and the decision rows", () => {
    const h = pulseHeadline(behind, decisions);
    const inRows = new Set(decisions.flatMap((d) => [...d.taskIds, ...keysIn(d.title), ...keysIn(d.body)]));
    assert.deepEqual(h.reasons.flatMap(keysIn).filter((k) => inRows.has(k)), []);
    // and without rows the cause is still written, with its key
    assert.ok(pulseHeadline(behind).reasons.some((r) => r.includes("P-2")));
  });

  it("a cause whose row is not shown (cut off at three) is still written", () => {
    const h = pulseHeadline(behind, decisions.filter((d) => d.kind !== "late-blocking"));
    assert.ok(h.reasons.includes("P-2 trên đường găng đã trễ 2 ngày."));
  });

  it("the verdict and the forecast never repeat the same slip", () => {
    const h = pulseHeadline(behind, decisions);
    assert.doesNotMatch(h.forecast, /trễ|chậm/);
  });
});

describe("phaseStatus", () => {
  const phase = (o: Partial<ProgressMetrics["phases"][number]>) => ({
    id: "E-1",
    summary: "Giai đoạn",
    total: 4,
    done: 1,
    actualPct: 43,
    plannedPct: 100,
    start: "2026-10-01",
    end: "2026-11-05",
    baselineEnd: "2026-11-05",
    overdue: 1,
    ...o,
  });
  it("in words; the worst signal decides the tone", () => {
    assert.deepEqual(phaseStatus(phase({}), true), { text: "chậm 57 điểm · 1 quá hạn", tone: "risk" });
    assert.deepEqual(phaseStatus(phase({ plannedPct: 49, overdue: 0 }), true), { text: "chậm 6 điểm", tone: "warn" });
    assert.deepEqual(phaseStatus(phase({ plannedPct: 30, overdue: 0, end: "2026-11-09" }), true), {
      text: "trước 13 điểm · kết thúc trễ 4 ngày",
      tone: "quiet",
    });
  });
  it("not started, undated and finished say so instead of '0% / 0%'", () => {
    assert.equal(phaseStatus(phase({ actualPct: 0, plannedPct: 0, overdue: 0 }), true).text, "chưa tới lịch");
    assert.equal(phaseStatus(phase({ actualPct: 0, plannedPct: 0, overdue: 0 }), false).text, "chưa có ngày");
    assert.equal(phaseStatus(phase({ done: 4, actualPct: 100 }), true).text, "xong");
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

describe("overload from Nhân lực's own load", () => {
  it("names the same person and days as buildResourceLoad over the next two weeks", () => {
    const load = buildResourceLoad({ tasks, users, profiles: [], absences: [], from: TODAY, to: addDays(TODAY, 13), includeIdle: true });
    const o = overloadFromLoad(load);
    assert.equal(o?.accountId, "chi");
    assert.equal(o?.from, "2026-11-10");
    const row = pulseDecisions(metrics(), tasks, users, TODAY, undefined, load).find((d) => d.kind === "overloaded");
    assert.equal(row?.title, "Lê Chi quá tải 10/11");
  });
  it("nobody over is no row", () => {
    const load = buildResourceLoad({ tasks: [tasks[3]], users, profiles: [], absences: [], from: TODAY, to: addDays(TODAY, 13), includeIdle: true });
    assert.equal(overloadFromLoad(load), null);
  });
});
