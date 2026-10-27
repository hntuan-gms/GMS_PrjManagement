import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReportLink, parseDeepLink } from "../src/deepLink";
import { compareReports, diffLists, foldText, orderPair } from "../src/reportCompare";
import type { Health, ProgressReport } from "../src/types";

const report = (o: {
  id: string;
  asOf: string;
  health?: Health;
  actual?: number;
  planned?: number;
  spi?: number | null;
  overdue?: number;
  done?: number;
  risks?: string[];
  recs?: string[];
}): ProgressReport =>
  ({
    id: o.id,
    createdAt: `${o.asOf}T08:00:00Z`,
    createdBy: "x",
    asOf: o.asOf,
    health: o.health ?? "at_risk",
    actualPct: o.actual ?? 40,
    plannedPct: o.planned ?? 50,
    metrics: {
      spi: o.spi === undefined ? 0.8 : o.spi,
      counts: { done: o.done ?? 10, inProgress: 4, overdue: o.overdue ?? 3, slipped: 2, notStarted: 1, unassigned: 0, criticalOpen: 2 },
    },
    narrative: {
      headline: "",
      summary: "",
      highlights: [],
      risks: (o.risks ?? []).map((title) => ({ title, detail: "", severity: "high", issueKeys: [] })),
      recommendations: (o.recs ?? []).map((action) => ({ action, rationale: "", issueKeys: [] })),
    },
    model: null,
    usage: { promptTokens: null, outputTokens: null, thoughtTokens: null, cachedTokens: null },
  }) as unknown as ProgressReport;

describe("report comparison (3.10)", () => {
  const a = report({ id: "a", asOf: "2026-10-01", actual: 40, overdue: 5, done: 10, risks: ["Thiếu người kiểm thử", "API chậm"] });
  const b = report({ id: "b", asOf: "2026-10-15", actual: 55, overdue: 2, done: 18, health: "on_track", risks: ["API chậm", "Hết ngân sách"] });

  it("puts the earlier day first whichever order they are given", () => {
    assert.deepEqual(orderPair(b, a).map((r) => r.id), ["a", "b"]);
    assert.equal(compareReports(b, a).daysApart, 14);
  });

  it("calls a rise in done 'better' and a rise in overdue 'worse'", () => {
    const c = compareReports(a, b);
    const by = (k: string) => c.metrics.find((m) => m.key === k)!;
    assert.deepEqual([by("actual").delta, by("actual").direction], [15, "better"]);
    assert.deepEqual([by("done").delta, by("done").direction], [8, "better"]);
    assert.deepEqual([by("overdue").delta, by("overdue").direction], [-3, "better"]);
    assert.equal(by("unassigned").direction, "same");
    assert.equal(compareReports(b, a).metrics.find((m) => m.key === "overdue")!.direction, "better"); // order-independent
  });

  it("compares health on the on-track → off-track scale", () => {
    assert.equal(compareReports(a, b).health.direction, "better");
    assert.equal(compareReports(report({ id: "x", asOf: "2026-10-01", health: "on_track" }), report({ id: "y", asOf: "2026-10-02", health: "off_track" })).health.direction, "worse");
  });

  it("has no delta when a side has no SPI", () => {
    const c = compareReports(report({ id: "x", asOf: "2026-10-01", spi: null }), a);
    assert.equal(c.metrics.find((m) => m.key === "spi")!.delta, null);
    assert.equal(c.metrics.find((m) => m.key === "spi")!.direction, "same");
  });

  it("finds risks that appeared, went away, or stayed", () => {
    const c = compareReports(a, b);
    assert.deepEqual(c.risks.added, ["Hết ngân sách"]);
    assert.deepEqual(c.risks.resolved, ["Thiếu người kiểm thử"]);
    assert.deepEqual(c.risks.kept, ["API chậm"]);
  });

  it("treats a slightly reworded title as the same risk", () => {
    assert.equal(foldText("  Thiếu NGƯỜI kiểm-thử! "), foldText("thieu nguoi kiem thu"));
    assert.deepEqual(diffLists(["Thiếu người"], ["THIẾU NGƯỜI."]).kept, ["THIẾU NGƯỜI."]);
  });
});

describe("report deep link (3.10)", () => {
  const id = "0b9e3c1a-4d2f-4c8e-9a51-7f6d2e8b1c33";

  it("round-trips a project and report", () => {
    const link = buildReportLink("https://gms.example/", "GPM", id);
    assert.equal(link, `https://gms.example/?project=GPM&report=${id}`);
    assert.deepEqual(parseDeepLink(new URL(link).search), { project: "GPM", reportId: id });
  });

  it("ignores anything that is not a project key and a report uuid", () => {
    assert.equal(parseDeepLink(`?project=GPM&report=not-a-uuid`), null);
    assert.equal(parseDeepLink(`?project=../etc&report=${id}`), null);
    assert.equal(parseDeepLink(`?report=${id}`), null);
    assert.equal(parseDeepLink(""), null);
  });
});
