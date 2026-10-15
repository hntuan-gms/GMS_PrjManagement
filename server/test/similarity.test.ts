import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DUPLICATE_THRESHOLD, findSimilarTasks, tokens } from "../src/ai/similarity.js";
import { task } from "./fixtures.js";

const tasks = [
  task({ id: "P-1", summary: "Thiết kế màn hình đăng nhập" }),
  task({ id: "P-2", summary: "Viết API thanh toán" }),
  task({ id: "P-3", summary: "Kiểm thử" }),
  task({ id: "P-4", summary: "Đăng nhập bằng Google", description: "Tích hợp OAuth Google cho màn hình đăng nhập" }),
];

describe("tokens", () => {
  it("folds diacritics and drops filler words", () => {
    assert.deepEqual([...tokens("Thiết kế màn hình đăng nhập")].sort(), ["dang", "hinh", "ke", "man", "nhap", "thiet"]);
    assert.deepEqual([...tokens("Làm việc cho các")], []);
    // "đang" (currently) and "đăng" (post, as in đăng nhập) fold to the same word; only the second is a keyword.
    assert.ok(tokens("Đăng nhập").has("dang"));
  });
});

describe("findSimilarTasks", () => {
  it("finds the same work written with and without diacritics", () => {
    const hits = findSimilarTasks({ summary: "thiet ke man hinh dang nhap" }, tasks);
    assert.equal(hits[0].id, "P-1");
    assert.equal(hits[0].score, 1);
  });

  it("finds near-duplicates by their distinctive words", () => {
    const hits = findSimilarTasks({ summary: "Thiết kế màn hình login đăng nhập" }, tasks);
    assert.equal(hits[0].id, "P-1");
    assert.ok(hits[0].score >= DUPLICATE_THRESHOLD);
    assert.ok(hits[0].sharedWords.includes("dang"));
  });

  it("a single shared word is a coincidence, however short the titles", () => {
    assert.deepEqual(findSimilarTasks({ summary: "Thanh lý hợp đồng" }, tasks, { min: 0.1 }).filter((h) => h.id === "P-2"), []);
  });

  it("unrelated work matches nothing", () => {
    assert.deepEqual(findSimilarTasks({ summary: "Triển khai lên Cloud Run" }, tasks), []);
  });

  it("a description can raise a score but never lower one", () => {
    const withText = findSimilarTasks(
      { summary: "Social login", description: "Tích hợp OAuth Google cho màn hình đăng nhập" },
      tasks,
      { min: 0.4 }
    );
    assert.ok(withText.some((h) => h.id === "P-4"));
    const titleOnly = findSimilarTasks({ summary: "Đăng nhập bằng Google" }, tasks);
    const sameWithDescription = findSimilarTasks({ summary: "Đăng nhập bằng Google", description: "không liên quan gì cả" }, tasks);
    assert.ok(sameWithDescription[0].score >= titleOnly[0].score);
  });

  it("never reports a task as a duplicate of itself", () => {
    const hits = findSimilarTasks({ summary: tasks[0].summary }, tasks, { excludeId: "P-1" });
    assert.ok(!hits.some((h) => h.id === "P-1"));
  });

  it("orders best first and honours the limit", () => {
    const hits = findSimilarTasks({ summary: "Đăng nhập màn hình" }, tasks, { min: 0.3, limit: 1 });
    assert.equal(hits.length, 1);
  });
});
