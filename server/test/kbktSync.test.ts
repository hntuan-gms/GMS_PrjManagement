import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adfComparable } from "../src/adf.js";
import { JiraApiError, type JiraClient } from "../src/jiraClient.js";
import { parseWorkbook } from "../src/kbkt/parse.js";
import { DEFAULT_SETTINGS } from "../src/kbkt/settings.js";
import { KbktSync, type LogLine, type SyncOptions } from "../src/kbkt/sync.js";
import { FakeJira } from "./kbktFakeJira.js";
import { sampleWorkbook } from "./kbktFixture.js";

const FILE = "AI-33_1E127_BaoCaoQuanTri_v2.xlsx";
const settings = { ...DEFAULT_SETTINGS, issueTypes: { ...DEFAULT_SETTINGS.issueTypes, bug: "Sub Bug" } };
const base: SyncOptions = { apply: false, force: false, epicRef: "AI-1", dueDate: "2026-11-01" };

async function run(jira: FakeJira, opts: Partial<SyncOptions> = {}, wbBytes = sampleWorkbook()) {
  const log: LogLine[] = [];
  const result = await new KbktSync(jira as unknown as JiraClient, "AI", settings, (l) => log.push(l)).run(
    parseWorkbook(wbBytes),
    FILE,
    { ...base, ...opts }
  );
  const count = (a: string) => log.filter((l) => l.action === a).length;
  return { log, result, count };
}

describe("KbktSync", () => {
  it("dry run: plans every create and writes nothing", async () => {
    const jira = new FakeJira();
    const { result, count } = await run(jira);
    // Story + 6 tests + BUG-01, BUG-02 + the failed row's own bug; BUG-03/04 are closed and never synced.
    assert.equal(count("CREATE"), 10);
    assert.equal(count("SKIP"), 2);
    assert.equal(count("ATTACH"), 2);
    // tc-5 ↔ BUG-03 is not linked: BUG-03 will not exist.
    assert.equal(count("LINK"), 3);
    assert.equal(count("ERROR"), 0);
    assert.equal(result.storyKey, "new:story-1E_127");
    assert.ok(!jira.calls.some((c) => /^(bulk|update|transition |link|attach)/.test(c)));
    assert.equal(jira.issues.size, 1);
  });

  it("matches an issue type by its folded name (Sub Bug = Sub-Bug)", async () => {
    const { log } = await run(new FakeJira());
    assert.ok(log.some((l) => l.action === "INFO" && l.message.includes("lỗi → Sub-Bug")));
  });

  it("apply: creates the Story under the Epic, sub-issues in one bulk call, then moves, attaches and links", async () => {
    const jira = new FakeJira();
    const { result, count } = await run(jira, { apply: true });
    assert.equal(count("ERROR"), 0);
    assert.ok(result.storyKey && /^AI-\d+$/.test(result.storyKey));
    const story = jira.issues.get(result.storyKey!);
    assert.deepEqual(story.fields.parent, { key: "AI-1" });
    assert.equal(story.fields.duedate, "2026-11-01");
    assert.deepEqual(
      jira.calls.filter((c) => c.startsWith("bulk")),
      ["bulk 1", "bulk 9"]
    );

    const byLabel = (l: string) => [...jira.issues.values()].find((i) => i.fields.labels.includes(l));
    assert.deepEqual(
      ["tc-1E_127_1", "tc-1E_127_2", "tc-1E_127_3", "tc-1E_127_4"].map((l) => byLabel(l).fields.status.name),
      ["Passed", "Failed", "Pending", "Not run"]
    );
    assert.equal(byLabel("tc-1E_127_2").fields.parent.key, result.storyKey);
    assert.equal(byLabel("bug-1E_127_BUG-01").fields.priority.name, "High");
    assert.equal(byLabel("bug-1E_127_BUG-03"), undefined);
    assert.deepEqual(
      byLabel("bug-1E_127_BUG-01").fields.attachment.map((a: any) => a.filename),
      ["1E_127_BUG-01_1.jpeg", "1E_127_BUG-01_2.png"]
    );
    assert.equal(count("LINK"), 3);
    // Transitions are a property of the workflow step: one read for every new test case.
    assert.equal(jira.calls.filter((c) => c.startsWith("transitions")).length, 1);
  });

  it("a second apply of the same file finds everything by label and changes nothing", async () => {
    const jira = new FakeJira();
    const first = await run(jira, { apply: true });
    const before = jira.issues.size;
    jira.calls = [];
    const { count, result } = await run(jira, { apply: true });
    assert.equal(result.storyKey, first.result.storyKey);
    for (const a of ["CREATE", "UPDATE", "MOVE", "LINK", "ATTACH", "ERROR"]) assert.equal(count(a), 0, a);
    assert.equal(jira.issues.size, before);
    assert.ok(!jira.calls.some((c) => /^(bulk|update|transition |link|attach)/.test(c)));
  });

  it("re-sync puts back a result label changed in Jira — the file is the source of truth — and touches nothing else", async () => {
    const jira = new FakeJira();
    await run(jira, { apply: true });
    const tc4 = [...jira.issues.values()].find((i) => i.fields.labels.includes("tc-1E_127_4"));
    // Someone recorded the run in Jira by hand.
    tc4.fields.labels = tc4.fields.labels.filter((l: string) => l !== "result-notrun").concat("result-pass");
    const { log, count } = await run(jira, { apply: true });
    assert.equal(count("UPDATE"), 1);
    assert.ok(log.some((l) => l.action === "UPDATE" && l.message.includes(tc4.key) && l.message.includes("[labels]")));
    assert.deepEqual(tc4.fields.labels.sort(), ["kbkt-1E_127", "result-notrun", "tc-1E_127_4"]);
  });

  it("uses an existing Story named by the file, and refuses one from another project", async () => {
    const jira = new FakeJira();
    jira.issues.set("AI-33", { key: "AI-33", fields: { summary: "Báo cáo", issuetype: { name: "Story", hierarchyLevel: 0 }, labels: [], parent: null } });
    const { result, count } = await run(jira, { epicRef: null });
    assert.equal(result.storyKey, "AI-33");
    assert.equal(count("CREATE"), 9);
    assert.equal(count("ERROR"), 0);

    const other = await run(new FakeJira(), { storyKey: "GPM-4" });
    assert.equal(other.result.storyKey, null);
    assert.ok(other.log.some((l) => l.action === "ERROR" && l.message.includes("dự án GPM")));
  });

  it("an explicitly chosen existing Story gets every sub-issue and is neither moved nor renamed", async () => {
    const jira = new FakeJira();
    jira.issues.set("AI-40", {
      key: "AI-40",
      fields: { summary: "UC đã có", issuetype: { name: "Story", hierarchyLevel: 0 }, labels: [], parent: { key: "AI-7" } },
    });
    const { result, count } = await run(jira, { apply: true, storyKey: "AI-40", epicRef: null });
    assert.equal(result.storyKey, "AI-40");
    assert.equal(count("ERROR"), 0);
    assert.equal(count("UPDATE"), 0);
    const subs = [...jira.issues.values()].filter((i) => i.fields.labels.some((l: string) => /^(tc|bug)-/.test(l)));
    assert.equal(subs.length, 9);
    assert.ok(subs.every((i) => i.fields.parent?.key === "AI-40"));
    assert.deepEqual(jira.issues.get("AI-40").fields.parent, { key: "AI-7" });
    assert.equal(jira.issues.get("AI-40").fields.summary, "UC đã có");
    // No Story of the file's own was made.
    assert.ok(![...jira.issues.values()].some((i) => i.fields.labels.includes("story-1E_127")));
  });

  it("storyKey null makes a new Story even when the file name names one", async () => {
    const jira = new FakeJira();
    jira.issues.set("AI-33", { key: "AI-33", fields: { summary: "Báo cáo", issuetype: { name: "Story", hierarchyLevel: 0 }, labels: [], parent: null } });
    const { result, count } = await run(jira, { storyKey: null });
    assert.equal(result.storyKey, "new:story-1E_127");
    assert.equal(count("CREATE"), 10);
    assert.ok(!jira.calls.includes("getIssue AI-33"));
  });

  it("writes each part of a test case into its own Jira field, and says which went where", async () => {
    const jira = new FakeJira();
    const { log, count } = await run(jira, { apply: true });
    assert.equal(count("ERROR"), 0);
    const byLabel = (l: string) => [...jira.issues.values()].find((i) => i.fields.labels.includes(l));
    const tc1 = byLabel("tc-1E_127_1").fields;
    assert.equal(tc1.customfield_10101, "Giao diện"); // Module
    assert.equal(adfComparable(tc1.customfield_10103), "1. Mở màn hình"); // Test Steps
    assert.equal(adfComparable(tc1.customfield_10106), "Hiển thị tiêu đề"); // Expected Result
    assert.equal(adfComparable(tc1.customfield_10105), "Đúng"); // Actual Result
    assert.doesNotMatch(adfComparable(tc1.description), /Các bước thực hiện|Kết quả mong muốn/);
    assert.match(adfComparable(tc1.description), /Mục đích kiểm thử/);
    // An empty cell is simply not sent on create.
    assert.ok(!("customfield_10103" in byLabel("tc-1E_127_2").fields));
    assert.deepEqual(byLabel("bug-1E_127_BUG-01").fields.customfield_10201, { id: "customfield_10201-0" }); // Severity "Cao"
    assert.ok(log.some((l) => l.action === "INFO" && l.message.includes("Các bước thực hiện → Test Steps")));
  });

  it("moves the content of issues created before fields existed, once", async () => {
    const jira = new FakeJira();
    jira.screens = false;
    await run(jira, { apply: true });
    jira.screens = true;
    const { log, count } = await run(jira, { apply: true });
    assert.equal(count("CREATE"), 0);
    assert.ok(count("UPDATE") >= 6);
    assert.ok(log.some((l) => l.action === "UPDATE" && /Expected Result.*description|description.*Expected Result/.test(l.message)));
    const tc1 = [...jira.issues.values()].find((i) => i.fields.labels.includes("tc-1E_127_1")).fields;
    assert.equal(adfComparable(tc1.customfield_10103), "1. Mở màn hình");
    assert.doesNotMatch(adfComparable(tc1.description), /Các bước thực hiện/);
    const again = await run(jira, { apply: true });
    assert.equal(again.count("UPDATE"), 0);
  });

  it("a saved map with nothing in it keeps everything in the description", async () => {
    const jira = new FakeJira();
    const log: LogLine[] = [];
    const s = { ...settings, fieldMap: { test: {}, bug: {} } };
    await new KbktSync(jira as unknown as JiraClient, "AI", s, (l) => log.push(l)).run(parseWorkbook(sampleWorkbook()), FILE, {
      ...base,
      apply: true,
    });
    const tc1 = [...jira.issues.values()].find((i) => i.fields.labels.includes("tc-1E_127_1")).fields;
    assert.ok(!Object.keys(tc1).some((k) => k.startsWith("customfield_")));
    assert.match(adfComparable(tc1.description), /Các bước thực hiện/);
  });

  it("a screen that cannot be read is a warning, and the import still runs with the full description", async () => {
    const jira = new FakeJira();
    jira.getCreateMetaFields = async () => {
      throw new JiraApiError(403, '{"errorMessages":["Không có quyền"]}');
    };
    const { log, count } = await run(jira, { apply: true });
    assert.equal(count("ERROR"), 0);
    assert.equal(count("CREATE"), 10);
    assert.ok(log.some((l) => l.action === "WARN" && l.message.includes("Không đọc được các trường của Sub Testcase")));
  });

  it("needs an Epic for a new Story and says so", async () => {
    const { log, result } = await run(new FakeJira(), { epicRef: null });
    assert.equal(result.storyKey, null);
    assert.ok(log.some((l) => l.action === "ERROR" && l.message.includes("chọn Epic")));
  });

  it("an explicitly chosen Story that does not exist is an error, not a new Story", async () => {
    const { log, result } = await run(new FakeJira(), { storyKey: "AI-999" });
    assert.equal(result.storyKey, null);
    assert.ok(log.some((l) => l.action === "ERROR" && l.message.includes("AI-999")));
  });

  it("reports an issue type the project does not have, listing the ones it does", async () => {
    const jira = new FakeJira();
    const log: LogLine[] = [];
    const bad = { ...settings, issueTypes: { ...settings.issueTypes, test: "Test" } };
    const result = await new KbktSync(jira as unknown as JiraClient, "AI", bad, (l) => log.push(l)).run(
      parseWorkbook(sampleWorkbook()),
      FILE,
      base
    );
    assert.equal(result.storyKey, null);
    assert.ok(log.some((l) => l.action === "ERROR" && l.message.includes('"Test"') && l.message.includes("Sub Testcase")));
  });

  it("stops before writing when many test summaries changed, unless forced", async () => {
    const jira = new FakeJira();
    await run(jira, { apply: true });
    for (const i of jira.issues.values()) {
      if (i.fields.labels.some((l: string) => l.startsWith("tc-"))) i.fields.summary = "renamed";
    }
    jira.calls = [];
    const { count } = await run(jira, { apply: true });
    assert.equal(count("SKIP"), 1);
    assert.ok(!jira.calls.some((c) => c.startsWith("update")));
    const forced = await run(jira, { apply: true, force: true });
    assert.equal(forced.count("UPDATE"), 6);
  });

  it("a stop request ends the run between Jira calls", async () => {
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(run(new FakeJira(), { apply: true, signal: abort.signal }), /Đã dừng/);
  });
});
