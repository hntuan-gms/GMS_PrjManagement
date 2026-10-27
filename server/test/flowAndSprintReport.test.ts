import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSprintReport, membership, type SprintReportIssue } from "../src/agile/sprintReport.js";
import {
  controlStats,
  createdVsResolved,
  cumulativeFlow,
  cycleTimes,
  percentile,
  rollingMean,
  statusAt,
  toFlowIssue,
  weekStart,
  type FlowIssue,
  type FlowStatus,
} from "../src/flowMetrics.js";

const STATUSES: FlowStatus[] = [
  { id: "1", name: "To Do", category: "new" },
  { id: "2", name: "In Progress", category: "indeterminate" },
  { id: "3", name: "Done", category: "done" },
];

const at = (iso: string) => Date.parse(iso);
const flow = (key: string, o: Omit<Partial<FlowIssue>, "created" | "resolved"> & { created: string; resolved?: string | null }): FlowIssue => ({
  key,
  created: at(o.created),
  resolved: o.resolved ? at(o.resolved) : null,
  initialStatusId: o.initialStatusId ?? "1",
  transitions: o.transitions ?? [],
});

describe("toFlowIssue", () => {
  it("reads the first change's `from` as the starting status and orders changes by time", () => {
    const issue = toFlowIssue({
      key: "A-1",
      fields: { created: "2026-10-01T00:00:00Z", resolutiondate: "2026-10-05T00:00:00Z", status: { id: "3" } },
      changelog: {
        histories: [
          { created: "2026-10-05T00:00:00Z", items: [{ field: "status", from: "2", to: "3" }] },
          { created: "2026-10-02T00:00:00Z", items: [{ field: "status", from: "1", to: "2" }, { field: "assignee", from: null, to: "x" }] },
        ],
      },
    })!;
    assert.equal(issue.initialStatusId, "1");
    assert.deepEqual(issue.transitions.map((t) => t.toId), ["2", "3"]);
    assert.equal(issue.resolved, at("2026-10-05T00:00:00Z"));
  });

  it("an issue that never changed status has been in its current one all along", () => {
    const issue = toFlowIssue({ key: "A-2", fields: { created: "2026-10-01T00:00:00Z", status: { id: "2" } } })!;
    assert.equal(issue.initialStatusId, "2");
  });

  it("has no use for an issue without a created date", () => {
    assert.equal(toFlowIssue({ key: "A-3", fields: {} }), null);
  });
});

describe("cumulative flow", () => {
  const issue = flow("A-1", {
    created: "2026-10-01T05:00:00Z",
    transitions: [
      { at: at("2026-10-03T05:00:00Z"), toId: "2" },
      { at: at("2026-10-05T05:00:00Z"), toId: "3" },
    ],
    resolved: "2026-10-05T05:00:00Z",
  });

  it("knows nothing before the issue exists, then follows each change", () => {
    assert.equal(statusAt(issue, at("2026-09-30T00:00:00Z")), null);
    assert.equal(statusAt(issue, at("2026-10-02T00:00:00Z")), "1");
    assert.equal(statusAt(issue, at("2026-10-04T00:00:00Z")), "2");
    assert.equal(statusAt(issue, at("2026-10-06T00:00:00Z")), "3");
  });

  it("counts each issue in exactly one status per day, in workflow order", () => {
    const other = flow("A-2", { created: "2026-10-02T05:00:00Z" });
    const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];
    const cfd = cumulativeFlow([issue, other], STATUSES, days, 0);
    assert.deepEqual(cfd.series.map((s) => s.name), ["To Do", "In Progress", "Done"]);
    const total = days.map((_, i) => cfd.series.reduce((s, x) => s + x.counts[i], 0));
    assert.deepEqual(total, [1, 2, 2, 2, 2]);
    assert.deepEqual(cfd.series.find((s) => s.name === "Done")!.counts, [0, 0, 0, 0, 1]);
  });

  it("cuts days in the team's timezone, not UTC", () => {
    // 20:00Z on Oct 1 is already Oct 2 at +07:00, so end of local Oct 1 is before it.
    const late = flow("A-3", { created: "2026-10-01T20:00:00Z" });
    assert.equal(cumulativeFlow([late], STATUSES, ["2026-10-01"], 420).series.length, 0);
    assert.equal(cumulativeFlow([late], STATUSES, ["2026-10-02"], 420).series[0].counts[0], 1);
  });
});

describe("control chart", () => {
  const done = flow("A-1", {
    created: "2026-10-01T00:00:00Z",
    resolved: "2026-10-09T00:00:00Z",
    transitions: [
      { at: at("2026-10-05T00:00:00Z"), toId: "2" },
      { at: at("2026-10-09T00:00:00Z"), toId: "3" },
    ],
  });
  const skipped = flow("A-2", {
    created: "2026-10-02T00:00:00Z",
    resolved: "2026-10-04T00:00:00Z",
    transitions: [{ at: at("2026-10-04T00:00:00Z"), toId: "3" }],
  });

  it("cycle time starts at the first in-progress status, lead time at creation", () => {
    const pts = cycleTimes([done, skipped], STATUSES, "2026-10-01", "2026-10-31", 0);
    const a = pts.find((p) => p.key === "A-1")!;
    assert.deepEqual([a.leadDays, a.cycleDays], [8, 4]);
    const b = pts.find((p) => p.key === "A-2")!;
    assert.deepEqual([b.leadDays, b.cycleDays], [2, null]);
  });

  it("only counts what was resolved inside the window", () => {
    assert.equal(cycleTimes([done, skipped], STATUSES, "2026-10-06", "2026-10-31", 0).length, 1);
  });

  it("percentiles use the nearest rank, and are null for nothing", () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.equal(percentile(v, 50), 5);
    assert.equal(percentile(v, 85), 9);
    assert.equal(percentile(v, 95), 10);
    assert.equal(percentile([], 50), null);
    assert.equal(controlStats([]), null);
    assert.deepEqual(controlStats([2, 4]), { count: 2, mean: 3, p50: 2, p85: 4, p95: 4 });
  });

  it("the rolling mean averages the points so far until it has a full window", () => {
    assert.deepEqual(rollingMean([2, 4, 6, 8], 2), [2, 3, 5, 7]);
  });
});

describe("created vs resolved", () => {
  const issues = [
    flow("A-1", { created: "2026-10-05T10:00:00Z", resolved: "2026-10-07T10:00:00Z" }), // Mon → Wed, same week
    flow("A-2", { created: "2026-10-06T10:00:00Z", resolved: "2026-10-14T10:00:00Z" }), // resolved the next week
    flow("A-3", { created: "2026-09-01T10:00:00Z" }), // created before the window
  ];

  it("finds the Monday of a week", () => {
    assert.equal(weekStart("2026-10-07"), "2026-10-05");
    assert.equal(weekStart("2026-10-11"), "2026-10-05"); // Sunday belongs to the week before
    assert.equal(weekStart("2026-10-05"), "2026-10-05");
  });

  it("buckets by week with an empty week still present", () => {
    const b = createdVsResolved(issues, "2026-10-05", "2026-10-25", 0, "week");
    assert.deepEqual(b.map((x) => [x.start, x.created, x.resolved]), [
      ["2026-10-05", 2, 1],
      ["2026-10-12", 0, 1],
      ["2026-10-19", 0, 0],
    ]);
  });

  it("buckets by day too", () => {
    const b = createdVsResolved(issues, "2026-10-05", "2026-10-07", 0, "day");
    assert.deepEqual(b.map((x) => [x.start, x.created, x.resolved]), [
      ["2026-10-05", 1, 0],
      ["2026-10-06", 1, 0],
      ["2026-10-07", 0, 1],
    ]);
  });
});

/* ------------------------------------------------------------------- sprint */

const sprintIssue = (key: string, o: Partial<SprintReportIssue> & { sprintEvents?: Array<[string, string, string]> }): SprintReportIssue => ({
  key,
  summary: key,
  issueType: "Task",
  subtask: false,
  statusName: o.statusCategory === "done" ? "Done" : "To Do",
  statusCategory: "new",
  created: "2026-09-01T00:00:00Z",
  resolutionDate: null,
  estimate: 3,
  histories: (o.sprintEvents ?? []).map(([created, from, to]) => ({ created, items: [{ field: "Sprint", from, to }] })),
  ...o,
});

describe("sprint membership", () => {
  it("an issue with no Sprint change has been in the sprint since it was created", () => {
    const i = sprintIssue("A-1", {});
    assert.deepEqual(membership(i, 7), [{ from: at("2026-09-01T00:00:00Z"), to: Infinity }]);
  });

  it("an issue added later is in only from then on", () => {
    const i = sprintIssue("A-1", { sprintEvents: [["2026-10-03T00:00:00Z", "", "7"]] });
    assert.deepEqual(membership(i, 7), [{ from: at("2026-10-03T00:00:00Z"), to: Infinity }]);
  });

  it("an issue that left and came back has two stretches", () => {
    const i = sprintIssue("A-1", {
      sprintEvents: [
        ["2026-10-03T00:00:00Z", "7", ""],
        ["2026-10-05T00:00:00Z", "", "7"],
      ],
    });
    assert.deepEqual(membership(i, 7), [
      { from: at("2026-09-01T00:00:00Z"), to: at("2026-10-03T00:00:00Z") },
      { from: at("2026-10-05T00:00:00Z"), to: Infinity },
    ]);
  });

  it("another sprint's id in the same field does not count", () => {
    const i = sprintIssue("A-1", { sprintEvents: [["2026-10-03T00:00:00Z", "6", "6, 7"]] });
    assert.equal(membership(i, 7)[0].from, at("2026-10-03T00:00:00Z"));
  });
});

describe("sprint report", () => {
  const sprint = {
    id: 7,
    name: "Sprint 7",
    state: "closed" as const,
    startDate: "2026-10-05T00:00:00Z",
    endDate: "2026-10-09T00:00:00Z",
    completeDate: "2026-10-09T12:00:00Z",
  };
  const issues = [
    // committed and finished in time
    sprintIssue("A-1", { statusCategory: "done", resolutionDate: "2026-10-07T10:00:00Z", estimate: 5 }),
    // committed, never finished
    sprintIssue("A-2", { estimate: 3 }),
    // added on day 3, finished
    sprintIssue("A-3", { sprintEvents: [["2026-10-07T00:00:00Z", "", "7"]], statusCategory: "done", resolutionDate: "2026-10-08T10:00:00Z", estimate: 2 }),
    // finished, but after the close
    sprintIssue("A-4", { statusCategory: "done", resolutionDate: "2026-10-12T10:00:00Z", estimate: 1 }),
    // a sub-task never counts
    sprintIssue("A-5", { subtask: true }),
  ];
  const report = buildSprintReport({ sprint, issues, estimated: true, tz: 0, today: "2026-10-20" });

  it("splits committed from added by whether it was there when the sprint started", () => {
    assert.deepEqual(report.committed.map((l) => l.key), ["A-1", "A-2", "A-4"]);
    assert.deepEqual(report.added.map((l) => l.key), ["A-3"]);
  });

  it("completed means done by the close; later is not completed", () => {
    assert.deepEqual(report.completed.map((l) => l.key), ["A-1", "A-3"]);
    assert.deepEqual(report.notCompleted.map((l) => l.key), ["A-2", "A-4"]);
  });

  it("totals are in the board's estimate", () => {
    assert.deepEqual(report.totals, { committed: 9, added: 2, completed: 7, notCompleted: 4 });
  });

  it("burnup steps scope up when work is added and completed up when it is resolved", () => {
    const by = new Map(report.burnup.map((p) => [p.date, p]));
    assert.equal(report.burnup[0].date, "2026-10-05");
    assert.equal(by.get("2026-10-05")!.scope, 9);
    assert.equal(by.get("2026-10-06")!.completed, 0);
    assert.equal(by.get("2026-10-07")!.scope, 11); // A-3 joined
    assert.equal(by.get("2026-10-07")!.completed, 5); // A-1 resolved
    assert.equal(by.get("2026-10-08")!.completed, 7); // A-3 resolved
    assert.equal(report.burnup.at(-1)!.date, "2026-10-09");
  });

  it("weighs 1 per issue when the board has no estimate", () => {
    const r = buildSprintReport({ sprint, issues, estimated: false, tz: 0, today: "2026-10-20" });
    assert.deepEqual(r.totals, { committed: 3, added: 1, completed: 2, notCompleted: 2 });
  });

  it("a running sprint stops its burnup at today", () => {
    const running = buildSprintReport({
      sprint: { ...sprint, state: "active", completeDate: null },
      issues,
      estimated: true,
      tz: 0,
      today: "2026-10-07",
    });
    assert.equal(running.burnup.at(-1)!.date, "2026-10-07");
  });

  it("an issue that left and returned is flagged as churn", () => {
    const churn = sprintIssue("A-9", {
      sprintEvents: [
        ["2026-10-06T00:00:00Z", "7", ""],
        ["2026-10-08T00:00:00Z", "", "7"],
      ],
    });
    assert.deepEqual(buildSprintReport({ sprint, issues: [churn], estimated: true, tz: 0, today: "2026-10-20" }).churned, ["A-9"]);
  });
});
