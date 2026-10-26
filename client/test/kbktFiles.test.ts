import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileVersion, nextWeekSunday, storyKeyFromFileName, supersededBy } from "../src/kbktFiles";

describe("storyKeyFromFileName", () => {
  it("reads the issue key before the first underscore, not AI-xx", () => {
    assert.equal(storyKeyFromFileName("ai-33_1E127_BaoCao_v5.xlsx"), "AI-33");
    assert.equal(storyKeyFromFileName(String.raw`C:\fakepath\GPM-7_x.xlsx`), "GPM-7");
    assert.equal(storyKeyFromFileName("AI-xx_1A13_v1.xlsx"), null);
    assert.equal(storyKeyFromFileName("TestCase_1E127.xlsx"), null);
  });
});

describe("supersededBy", () => {
  it("keeps the highest _vN of each code, then the newest file, and leaves unparsed files alone", () => {
    const files = [
      { id: "a", name: "AI-33_x_v2.xlsx", code: "1E_127", lastModified: 5 },
      { id: "b", name: "AI-33_x_v3.xlsx", code: "1E_127", lastModified: 1 },
      { id: "c", name: "AI-34_y.xlsx", code: "1E_128", lastModified: 1 },
      { id: "d", name: "AI-34_y copy.xlsx", code: "1E_128", lastModified: 9 },
      { id: "e", name: "broken.xlsx", code: null, lastModified: 1 },
    ];
    const out = supersededBy(files);
    assert.deepEqual([...out.entries()].sort(), [
      ["a", "AI-33_x_v3.xlsx"],
      ["c", "AI-34_y copy.xlsx"],
    ]);
    assert.equal(fileVersion("x_V12.xlsx"), 12);
  });
});

describe("nextWeekSunday", () => {
  it("is the Sunday of the following week, whatever day today is", () => {
    assert.equal(nextWeekSunday("2026-10-19"), "2026-11-01"); // Monday
    assert.equal(nextWeekSunday("2026-10-25"), "2026-11-01"); // Sunday
    assert.equal(nextWeekSunday("2026-10-24"), "2026-11-01"); // Saturday
    assert.equal(nextWeekSunday("2026-12-28"), "2027-01-10"); // across a year
  });
});
