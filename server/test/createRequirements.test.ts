import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NO_REQUIREMENTS, readRequirements } from "../src/createRequirements.js";

const f = (fieldId: string, name: string, required: boolean) => ({ fieldId, name, required });

describe("readRequirements", () => {
  it("a mandatory Due date is the Kết thúc box", () => {
    const r = readRequirements([f("summary", "Summary", true), f("duedate", "Due date", true), f("labels", "Labels", false)], null);
    assert.deepEqual(r, { ...NO_REQUIREMENTS, dueDate: true });
  });

  it("what the app always supplies is never asked of the person", () => {
    const r = readRequirements([f("project", "Project", true), f("issuetype", "Issue Type", true), f("reporter", "Reporter", true), f("parent", "Parent", true)], null);
    assert.deepEqual(r, NO_REQUIREMENTS);
  });

  it("the site's own Start date field is the Bắt đầu box; without one it is just another field", () => {
    const fields = [f("customfield_10059", "Start date", true)];
    assert.deepEqual(readRequirements(fields, "customfield_10059"), { ...NO_REQUIREMENTS, startDate: true });
    assert.deepEqual(readRequirements(fields, null), { ...NO_REQUIREMENTS, others: ["Start date"] });
  });

  it("assignee is the Người box; anything else mandatory is only listed by name", () => {
    const r = readRequirements([f("assignee", "Assignee", true), f("customfield_9", "RootCause", true), f("priority", "Priority", false)], null);
    assert.deepEqual(r, { dueDate: false, startDate: false, assignee: true, others: ["RootCause"] });
  });

  it("optional fields change nothing", () => {
    assert.deepEqual(readRequirements([f("duedate", "Due date", false), f("assignee", "Assignee", false)], null), NO_REQUIREMENTS);
  });
});
