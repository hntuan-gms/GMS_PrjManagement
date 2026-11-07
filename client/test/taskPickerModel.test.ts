import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { descendantIds, rankTasks } from "../src/taskPickerModel";
import { task } from "./fixtures";

const tasks = [
  task({ id: "AI-3", summary: "Đăng nhập bằng Google" }),
  task({ id: "AI-33", summary: "Báo cáo tuần", statusCategory: "done" }),
  task({ id: "AI-34", summary: "Bảng điều khiển" }),
  task({ id: "AI-103", summary: "Xuất báo cáo ra Excel" }),
  task({ id: "AI-7", summary: "Kiểm thử đăng ký" }),
];
const ids = (r: { id: string }[]) => r.map((t) => t.id);

describe("rankTasks", () => {
  it("lists everything on an empty query, finished work last", () => {
    assert.deepEqual(ids(rankTasks(tasks, "")), ["AI-3", "AI-34", "AI-103", "AI-7", "AI-33"]);
  });

  it("finds by key, with or without the project prefix", () => {
    assert.equal(rankTasks(tasks, "ai-34")[0].id, "AI-34");
    assert.equal(rankTasks(tasks, "AI 34")[0].id, "AI-34");
    assert.deepEqual(ids(rankTasks(tasks, "34")), ["AI-34"]);
  });

  it("an exact key leads even when that task is finished", () => {
    assert.equal(rankTasks(tasks, "33")[0].id, "AI-33");
    assert.equal(rankTasks(tasks, "ai-3")[0].id, "AI-3");
  });

  it("a key prefix lists the longer keys after the exact one", () => {
    assert.deepEqual(ids(rankTasks(tasks, "ai-3")), ["AI-3", "AI-34", "AI-33"]);
  });

  it("finds by title without diacritics, all words needed", () => {
    assert.deepEqual(ids(rankTasks(tasks, "dang nhap")), ["AI-3"]);
    assert.deepEqual(ids(rankTasks(tasks, "bao cao")), ["AI-103", "AI-33"]);
    assert.deepEqual(ids(rankTasks(tasks, "bao cao tuan")), ["AI-33"]);
    assert.deepEqual(rankTasks(tasks, "khong co"), []);
  });

  it("đ matches d", () => {
    assert.deepEqual(ids(rankTasks(tasks, "dang")), ["AI-3", "AI-7"]);
  });

  it("prefers a word that starts with the query over one that merely contains it", () => {
    const t = [task({ id: "B-1", summary: "Thêm cột nhãn" }), task({ id: "B-2", summary: "Nhãn dán" })];
    assert.deepEqual(ids(rankTasks(t, "nhan")), ["B-1", "B-2"]); // both start a word: plan order
    const u = [task({ id: "B-1", summary: "Banhan" }), task({ id: "B-2", summary: "Nhãn dán" })];
    assert.deepEqual(ids(rankTasks(u, "nhan")), ["B-2", "B-1"]);
  });

  it("honours exclude and filter", () => {
    assert.ok(!ids(rankTasks(tasks, "", { exclude: ["AI-3"] })).includes("AI-3"));
    assert.deepEqual(ids(rankTasks(tasks, "", { filter: (t) => t.id === "AI-7" })), ["AI-7"]);
    assert.deepEqual(ids(rankTasks(tasks, "ai-3", { exclude: new Set(["AI-3", "AI-34"]) })), ["AI-33"]);
  });

  it("returns at most 30 by default, or the limit given", () => {
    const many = Array.from({ length: 100 }, (_, i) => task({ id: `M-${i + 1}`, summary: `Việc ${i + 1}` }));
    assert.equal(rankTasks(many, "").length, 30);
    assert.equal(rankTasks(many, "viec").length, 30);
    assert.equal(rankTasks(many, "", { limit: 5 }).length, 5);
  });
});

describe("descendantIds", () => {
  it("is the task and everything beneath it", () => {
    const t = [
      task({ id: "E-1", summary: "e" }),
      task({ id: "S-1", summary: "s", wbsParentId: "E-1" }),
      task({ id: "T-1", summary: "t", wbsParentId: "S-1" }),
      task({ id: "S-2", summary: "other", wbsParentId: "E-1" }),
    ];
    assert.deepEqual([...descendantIds(t, "S-1")].sort(), ["S-1", "T-1"]);
    assert.deepEqual([...descendantIds(t, "T-1")], ["T-1"]);
  });
});
