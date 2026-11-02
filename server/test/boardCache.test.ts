import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agileBoardFromCache,
  DAY_MS,
  isWholeProjectFilter,
  passesUnreleased,
  rankOrder,
  statusBoardFromCache,
  subQueryRule,
  toBoardShape,
} from "../src/agile/boardCache.js";

const NOW = Date.parse("2026-11-02T08:00:00Z");
const ago = (days: number) => new Date(NOW - days * DAY_MS).toISOString().replace("Z", "+0000");
const SPRINT = "customfield_10020";
const RANK = "customfield_10019";
const FLAG = "customfield_10021";

function issue(key: string, f: Record<string, unknown> = {}) {
  return {
    id: key.replace(/\D/g, ""),
    key,
    fields: {
      summary: key,
      issuetype: { name: "Task", subtask: false, hierarchyLevel: 0 },
      status: { id: "1", name: "To Do", statusCategory: { key: "new" } },
      resolutiondate: null,
      fixVersions: [],
      ...f,
    },
  };
}
const done = (days: number) => ({ status: { id: "3", name: "Done", statusCategory: { key: "done" } }, resolutiondate: ago(days) });
const opts = {
  sprintFieldId: SPRINT,
  flaggedFieldId: FLAG,
  openSprints: new Map([[7, "active"]]),
  closedSprintIds: new Set([5]),
  rankFieldId: RANK,
  scrum: true,
  subQuery: "none" as const,
  released: new Map<string, boolean>(),
  nowMs: NOW,
  limit: 801,
  doneLimit: 500,
};

describe("which boards the copy can stand in for", () => {
  it("only a filter over exactly this project, optionally rank-ordered", () => {
    for (const jql of ["project = AI ORDER BY Rank ASC", 'project = "AI" ORDER BY Rank', "project in (AI)", "PROJECT=AI", "project = ai order by rank asc"]) {
      assert.equal(isWholeProjectFilter(jql, "AI"), true, jql);
    }
    for (const jql of ["project = AI AND component = X ORDER BY Rank", "project in (AI, GPM)", "project = AIX", "project = AI ORDER BY created", "", null]) {
      assert.equal(isWholeProjectFilter(jql, "AI"), false, String(jql));
    }
  });
  it("a Kanban sub-filter only when it is Jira's default", () => {
    assert.equal(subQueryRule(undefined), "none");
    assert.equal(subQueryRule("fixVersion in unreleasedVersions() OR fixVersion is EMPTY"), "unreleased");
    assert.equal(subQueryRule("fixVersion is EMPTY OR fixVersion in unreleasedVersions()"), "unreleased");
    assert.equal(subQueryRule("labels = team-a"), "other");
  });
});

describe("cards as the board API returned them", () => {
  it("rebuilds the open sprint, closed sprints and the flag", () => {
    const shaped = toBoardShape(
      issue("AI-1", {
        [SPRINT]: [
          { id: 5, name: "S5", state: "active", boardId: 3 },
          { id: 7, name: "S7", state: "future", boardId: 3 },
        ],
        [FLAG]: [{ value: "Impediment" }],
      }),
      opts,
      new Map()
    );
    // The board's own sprint list wins over the state held in the copy: 7 is active now, 5 is closed.
    assert.deepEqual(shaped.fields.sprint, { id: 7, name: "S7", state: "active", boardId: 3 });
    assert.deepEqual(shaped.fields.closedSprints.map((s: any) => [s.id, s.state]), [[5, "closed"]]);
    assert.equal(shaped.fields.flagged, true);
  });
  it("gives a parent its type and title from the parent's own row when the row predates them", () => {
    const epic = issue("AI-9", { issuetype: { name: "Epic", hierarchyLevel: 1 } });
    const child = issue("AI-1", { parent: { id: "9", key: "AI-9" } });
    const shaped = toBoardShape(child, opts, new Map([["AI-9", epic]]));
    assert.equal(shaped.fields.parent.fields.issuetype.name, "Epic");
    assert.equal(shaped.fields.parent.fields.summary, "AI-9");
  });
});

describe("the agile board from the copy", () => {
  const copied = [
    issue("AI-1", { [RANK]: "0|c" }),
    issue("AI-2", { [RANK]: "0|a", ...done(3) }),
    issue("AI-3", { [RANK]: "0|b", ...done(40) }),
    issue("AI-4", { [RANK]: "0|d", ...done(40), [SPRINT]: [{ id: 7, name: "S7", state: "active", boardId: 3 }] }),
    issue("AI-5", { [RANK]: "0|e", issuetype: { name: "Epic", hierarchyLevel: 1 } }),
    issue("AI-6", { [RANK]: "0|f", ...done(200) }),
  ];
  it("keeps what BOARD_JQL kept, in rank order, without Epics on a Scrum board", () => {
    const { issues } = agileBoardFromCache(copied, opts);
    // AI-3: done 40 days ago and in no open sprint. AI-5: an Epic. AI-6: long done.
    assert.deepEqual(issues.map((i) => i.key), ["AI-2", "AI-1", "AI-4"]);
  });
  it("keeps Epics on a Kanban board", () => {
    const { issues } = agileBoardFromCache(copied, { ...opts, scrum: false });
    assert.ok(issues.some((i) => i.key === "AI-5"));
  });
  it("finished work for velocity is the last 180 days, newest first", () => {
    const { recentDone } = agileBoardFromCache(copied, opts);
    assert.deepEqual(recentDone.map((i) => i.key), ["AI-2", "AI-3", "AI-4"]);
  });
  it("applies the default Kanban sub-filter against the project's versions", () => {
    const released = new Map([
      ["1.0", true],
      ["2.0", false],
    ]);
    assert.equal(passesUnreleased(issue("AI-1"), released), true);
    assert.equal(passesUnreleased(issue("AI-1", { fixVersions: [{ name: "1.0" }] }), released), false);
    assert.equal(passesUnreleased(issue("AI-1", { fixVersions: [{ name: "1.0" }, { name: "2.0" }] }), released), true);
    assert.equal(passesUnreleased(issue("AI-1", { fixVersions: [{ name: "archived" }] }), released), false);
  });
});

describe("the status board from the copy", () => {
  it("drops work done more than 14 days ago and orders by rank, unranked last", () => {
    const out = statusBoardFromCache(
      [issue("AI-1"), issue("AI-2", { [RANK]: "0|b" }), issue("AI-3", { [RANK]: "0|a", ...done(20) }), issue("AI-4", { [RANK]: "0|c", ...done(2) })],
      { rankFieldId: RANK, nowMs: NOW }
    );
    assert.deepEqual(out.map((i) => i.key), ["AI-2", "AI-4", "AI-1"]);
  });
  it("without a rank field keeps creation order", () => {
    assert.deepEqual(rankOrder([issue("AI-2"), issue("AI-1")], null).map((i) => i.key), ["AI-2", "AI-1"]);
  });
});
