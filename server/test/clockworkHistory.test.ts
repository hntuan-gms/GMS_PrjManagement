import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeHistory } from "../src/clockworkHistory.js";
import type { WorklogEntry } from "../src/timesheet.js";

const e = (issueKey: string, date: string, hours: number, mine = true): WorklogEntry => ({
  id: `${issueKey}-${date}-${hours}`,
  issueKey,
  summary: `Việc ${issueKey}`,
  issueType: "Task",
  authorAccountId: mine ? "me" : "other",
  authorName: mine ? "Tôi" : "Người khác",
  date,
  hours,
  comment: null,
  mine,
});

describe("summarizeHistory", () => {
  it("one line per issue: last day, number of days, hours", () => {
    const out = summarizeHistory([e("AI-1", "2026-11-02", 2), e("AI-1", "2026-11-04", 1.5), e("AI-1", "2026-11-04", 0.5)]);
    assert.deepEqual(out, [{ key: "AI-1", summary: "Việc AI-1", issueType: "Task", lastDate: "2026-11-04", days: 2, hours: 4 }]);
  });

  it("only my worklogs count", () => {
    assert.deepEqual(summarizeHistory([e("AI-1", "2026-11-02", 2, false)]), []);
  });

  it("most recent first, then the one logged on more days", () => {
    const out = summarizeHistory([
      e("AI-1", "2026-11-01", 1),
      e("AI-2", "2026-11-05", 1),
      e("AI-3", "2026-11-05", 1),
      e("AI-3", "2026-11-04", 1),
    ]);
    assert.deepEqual(out.map((x) => x.key), ["AI-3", "AI-2", "AI-1"]);
  });
});
