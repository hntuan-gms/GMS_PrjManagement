import assert from "node:assert/strict";
import { describe, it } from "node:test";
// The server's counter is a mirror of the client's filter (see countMatching's comment);
// this test is what keeps the two from drifting apart.
import { countMatching } from "../../server/src/ai/viewFilter";
import { matchesFilter } from "../src/boardModel";
import type { BoardIssue } from "../src/types";
import { buildEpicIndex, filterTaskIds } from "../src/taskFilter";
import { toBoardFilter, toTaskFilter, type ViewFilterSpec } from "../src/viewFilter";
import { sampleProject } from "./fixtures";

const none: ViewFilterSpec = {
  text: "",
  people: [],
  statuses: [],
  types: [],
  epics: [],
  labels: [],
  priorities: [],
  onlyOverdue: false,
  onlyBlocked: false,
};
const spec = (o: Partial<ViewFilterSpec>): ViewFilterSpec => ({ ...none, ...o });

describe("toTaskFilter", () => {
  it("pours every shared facet into the Gantt filter's sets", () => {
    const f = toTaskFilter(spec({ text: "api", people: ["anh", "none"], statuses: ["Done"], types: ["Bug"], epics: ["P-2"], labels: ["urgent"], priorities: ["High"], onlyOverdue: true }));
    assert.equal(f.text, "api");
    assert.deepEqual([...f.people], ["anh", "none"]);
    assert.deepEqual([...f.statuses], ["Done"]);
    assert.deepEqual([...f.types], ["Bug"]);
    assert.deepEqual([...f.epics], ["P-2"]);
    assert.deepEqual([...f.labels], ["urgent"]);
    assert.deepEqual([...f.priorities], ["High"]);
    assert.equal(f.onlyOverdue, true);
  });

  it("an empty spec is an empty filter (clears)", () => {
    const f = toTaskFilter(none);
    assert.equal(f.people.size + f.statuses.size + f.types.size + f.epics.size + f.labels.size + f.priorities.size, 0);
    assert.equal(f.onlyOverdue, false);
  });
});

describe("toBoardFilter", () => {
  it("carries priorities, labels and blocked", () => {
    const f = toBoardFilter(spec({ priorities: ["High"], labels: ["urgent", "ui"], onlyBlocked: true }));
    assert.deepEqual([...f.priorities], ["High"]);
    assert.deepEqual([...f.labels], ["urgent", "ui"]);
    assert.equal(f.onlyBlocked, true);
  });

  it("labels go to the label facet, not the text box", () => {
    assert.equal(toBoardFilter(spec({ labels: ["urgent"] })).text, "");
    assert.equal(toBoardFilter(spec({ text: "api", labels: ["urgent"] })).text, "api");
  });

  it("matches a card the same way the toolbar would", () => {
    const card = {
      key: "P-1", summary: "Dựng API", assigneeAccountId: "anh", issueType: "Task", statusName: "Done", statusCategory: "done",
      epicKey: "P-2", epicSummary: null, priority: "High", labels: ["urgent"], blockedBy: [], flagged: false, dueDate: null,
    } as unknown as BoardIssue;
    assert.equal(matchesFilter(card, toBoardFilter(spec({ people: ["anh"], statuses: ["Done"], priorities: ["High"] })), "2026-10-14"), true);
    assert.equal(matchesFilter(card, toBoardFilter(spec({ people: ["binh"] })), "2026-10-14"), false);
    assert.equal(matchesFilter(card, toBoardFilter(spec({ labels: ["ui", "urgent"] })), "2026-10-14"), true);
    assert.equal(matchesFilter(card, toBoardFilter(spec({ labels: ["ui"] })), "2026-10-14"), false);
  });
});

describe("server countMatching mirrors the client's Gantt filter", () => {
  const tasks = sampleProject();
  const today = "2026-10-14";
  const clientCount = (s: ViewFilterSpec) => filterTaskIds(tasks, toTaskFilter(s), { today, epicOf: buildEpicIndex(tasks) })?.size ?? tasks.length;

  const cases: Array<[string, Partial<ViewFilterSpec>]> = [
    ["nothing", {}],
    ["a person", { people: ["anh"] }],
    ["unassigned", { people: ["none"] }],
    ["person or unassigned", { people: ["anh", "none"] }],
    ["status", { statuses: ["Done"] }],
    ["type", { types: ["Bug", "Task"] }],
    ["epic (through a Story)", { epics: ["P-1"] }],
    ["label", { labels: ["urgent"] }],
    ["priority", { priorities: ["High"] }],
    ["no priority", { priorities: ["none"] }],
    ["overdue", { onlyOverdue: true }],
    ["text that hits an assignee's name", { text: "binh" }],
    ["everything at once", { people: ["anh"], epics: ["P-2"], onlyOverdue: true, types: ["Task"] }],
  ];
  for (const [name, s] of cases) {
    it(name, () => assert.equal(countMatching(tasks, spec(s), today), clientCount(spec(s))));
  }
});
