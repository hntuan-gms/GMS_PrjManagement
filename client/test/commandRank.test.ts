import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rankSearch } from "../src/commandRank";

const tasks = [
  { id: "DEMO-6", summary: "Dựng API đăng nhập", statusCategory: "new" },
  { id: "DEMO-5", summary: "Thiết kế bảng", statusCategory: "new" },
  { id: "DEMO-50", summary: "Việc cũ", statusCategory: "done" },
];
const commands = [
  { label: "Bật bản nháp kế hoạch", aliases: "nhap thu draft", group: "Kế hoạch" },
  { label: "Đọc lại từ Jira", aliases: "dong bo", group: "Dự án" },
  { label: "Nháp nhanh", group: "Khác" },
];
const names = (r: ReturnType<typeof rankSearch<(typeof tasks)[number], (typeof commands)[number]>>) =>
  r.map((x) => (x.kind === "task" ? x.task.id : x.cmd.label));

describe("rankSearch", () => {
  it("an exact key wins over everything", () => {
    assert.equal(names(rankSearch("demo-5", tasks, commands))[0], "DEMO-5");
  });
  it("a key prefix beats a command", () => {
    assert.deepEqual(names(rankSearch("DEMO-5", tasks, commands)).slice(0, 2), ["DEMO-5", "DEMO-50"]);
  });
  it("a command starting with the query comes first", () => {
    assert.equal(names(rankSearch("nháp", tasks, commands))[0], "Nháp nhanh");
  });
  it("the typed accent beats the folded one: 'nháp' finds the command before 'đăng nhập'", () => {
    const r = names(rankSearch("nháp", tasks, commands));
    assert.ok(r.indexOf("Bật bản nháp kế hoạch") < r.indexOf("DEMO-6"), r.join(" | "));
  });
  it("folded matches still appear, after the exact ones", () => {
    const r = names(rankSearch("nhap", tasks, commands));
    assert.ok(r.includes("DEMO-6"));
    assert.ok(r.indexOf("Bật bản nháp kế hoạch") < r.indexOf("DEMO-6"), r.join(" | "));
  });
  it("same step: command before task, unfinished before finished", () => {
    const r = names(rankSearch("viec", [{ id: "A-1", summary: "việc a", statusCategory: "done" }, { id: "A-2", summary: "việc b", statusCategory: "new" }], []));
    assert.deepEqual(r, ["A-2", "A-1"]);
  });
  it("an empty query ranks nothing", () => {
    assert.deepEqual(rankSearch("  ", tasks, commands), []);
  });
  it("the task limit does not push commands out", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `X-${i}`, summary: "nháp thử", statusCategory: "new" }));
    const r = rankSearch("nháp", many, commands, 3);
    assert.equal(r.filter((x) => x.kind === "task").length, 3);
    assert.equal(r.filter((x) => x.kind === "command").length, 2);
  });
});
