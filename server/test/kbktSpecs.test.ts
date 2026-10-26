import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adfComparable } from "../src/adf.js";
import { parseWorkbook } from "../src/kbkt/parse.js";
import { DEFAULT_SETTINGS, validateSettings, withDefaults } from "../src/kbkt/settings.js";
import { buildSpecs, fileVersion, storyKeyFromFileName, summary } from "../src/kbkt/specs.js";
import { sampleWorkbook } from "./kbktFixture.js";

const FILE = "AI-33_1E127_BaoCaoQuanTri_v2.xlsx";

describe("buildSpecs", () => {
  const wb = parseWorkbook(sampleWorkbook());
  const { specs, links, warns } = buildSpecs(wb, FILE, DEFAULT_SETTINGS);
  const byId = new Map(specs.map((s) => [s.id, s]));

  it("uses jira_sync.py's labels verbatim — they are how issues the script made are found again", () => {
    assert.deepEqual(
      specs.map((s) => s.id),
      [
        "story-1E_127",
        "tc-1E_127_1", "tc-1E_127_2", "tc-1E_127_3", "tc-1E_127_4", "tc-1E_127_5", "tc-1E_127_6",
        "bug-1E_127_BUG-01", "bug-1E_127_BUG-02", "bug-1E_127_BUG-03", "bug-1E_127_BUG-04",
        "bug-1E_127_6",
        "bug-1E_127_1", "bug-1E_127_3", "bug-1E_127_4",
      ]
    );
    assert.deepEqual(byId.get("tc-1E_127_2")!.labels, ["kbkt-1E_127", "result-fail", "tc-1E_127_2"]);
    assert.deepEqual(byId.get("story-1E_127")!.labels, ["kbkt-1E_127", "story-1E_127"]);
  });

  it("names the Story after the file's issue key and strips the code from the title", () => {
    assert.equal(byId.get("story-1E_127")!.summary, "AI-33 - Báo cáo quản trị từng công ty");
    assert.equal(buildSpecs(wb, "AI-xx_1E127.xlsx", DEFAULT_SETTINGS).specs[0].summary, "AI-xx - Báo cáo quản trị từng công ty");
    assert.equal(buildSpecs(wb, "KBKT_1E127.xlsx", DEFAULT_SETTINGS).specs[0].summary, "[1E_127] Báo cáo quản trị từng công ty");
  });

  it("maps test results to the configured statuses", () => {
    assert.deepEqual(
      specs.filter((s) => s.kind === "test").map((s) => s.status),
      ["Passed", "Failed", "Pending", "Not run", "Passed", "Failed"]
    );
  });

  it("keeps a bug open while a referencing row fails, even when the sheet withdrew it, and says so", () => {
    assert.equal(byId.get("bug-1E_127_BUG-02")!.status, "To Do");
    assert.equal(byId.get("bug-1E_127_BUG-02")!.skipIfNew, false);
    assert.ok(warns.some((w) => w.includes("BUG-02") && w.includes("giữ trạng thái mở")));
  });

  it("closes a bug once every referencing row passes, and does not create closed bugs nobody synced", () => {
    assert.equal(byId.get("bug-1E_127_BUG-03")!.status, "Done");
    assert.equal(byId.get("bug-1E_127_BUG-03")!.skipIfNew, true);
    assert.equal(byId.get("bug-1E_127_BUG-04")!.status, "Done");
    assert.equal(byId.get("bug-1E_127_BUG-04")!.skipIfNew, true);
  });

  it("maps severity to priority, leaving an unknown one unset", () => {
    assert.equal(byId.get("bug-1E_127_BUG-01")!.priority, "High");
    assert.equal(byId.get("bug-1E_127_BUG-03")!.priority, "Medium");
    assert.equal(byId.get("bug-1E_127_BUG-04")!.priority, null);
  });

  it("gives a failed row without a bug code a bug of its own, and closes such bugs for rows that recovered", () => {
    assert.equal(byId.get("bug-1E_127_6")!.status, "To Do");
    for (const id of ["bug-1E_127_1", "bug-1E_127_3", "bug-1E_127_4"]) {
      assert.deepEqual([byId.get(id)!.onlyStatus, byId.get(id)!.skipIfNew, byId.get(id)!.status], [true, true, "Done"]);
    }
  });

  it("links each test row to every bug it references", () => {
    assert.deepEqual(links, [
      ["tc-1E_127_2", "bug-1E_127_BUG-01"],
      ["tc-1E_127_2", "bug-1E_127_BUG-02"],
      ["tc-1E_127_5", "bug-1E_127_BUG-03"],
      ["tc-1E_127_6", "bug-1E_127_6"],
    ]);
  });

  it("writes sectioned descriptions, skipping empty sections, and lists attached screenshots", () => {
    const tc = adfComparable(byId.get("tc-1E_127_3")!.description);
    assert.equal(
      tc,
      [
        "Nhóm", "Giao diện",
        "Mục đích kiểm thử", "Kiểm tra xuất Excel",
        "Kết quả mong muốn", "Xuất được file",
        "Kết quả kiểm thử", "Lần 1 28/09/2026: F", "Lần 2: PE",
        "Nguồn", 'Sheet "1E_127 BC quản trị", dòng 15',
      ].join("\n")
    );
    assert.match(adfComparable(byId.get("bug-1E_127_BUG-01")!.description), /1E_127_BUG-01_1\.jpeg - BUG-01 \(1\/2\)/);
    assert.match(adfComparable(byId.get("story-1E_127")!.description), /Tổng: 6 \| Đạt \(P\): 2 \| Không đạt \(F\): 2 \| Đang xem xét \(PE\): 1 \| Chưa thực hiện: 1/);
  });
});

describe("file name helpers", () => {
  it("reads an issue key prefix, but not AI-xx", () => {
    assert.equal(storyKeyFromFileName("C:\\x\\ai-33_1E127_v2.xlsx"), "AI-33");
    assert.equal(storyKeyFromFileName("AI-xx_1E127_v2.xlsx"), null);
    assert.equal(storyKeyFromFileName("TestCase_1E127.xlsx"), null);
  });

  it("reads the _vN version", () => {
    assert.equal(fileVersion("AI-33_x_v12.xlsx"), 12);
    assert.equal(fileVersion("AI-33_x.xlsx"), 0);
  });

  it("caps a summary at Jira's 255 characters and folds whitespace", () => {
    assert.equal(summary(" a \n b "), "a b");
    const long = summary("x".repeat(300));
    assert.equal(long.length, 255);
    assert.ok(long.endsWith("…"));
  });
});

describe("settings", () => {
  it("validates a full body and names a missing field", () => {
    assert.deepEqual(validateSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
    assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS, linkType: " " }), /Kiểu liên kết/);
  });

  it("fills fields a stored row predates from the defaults", () => {
    const merged = withDefaults({ status: { pass: "Đạt" } as never });
    assert.equal(merged.status.pass, "Đạt");
    assert.equal(merged.status.fail, "Failed");
    assert.equal(merged.linkType, "Relates");
  });
});
