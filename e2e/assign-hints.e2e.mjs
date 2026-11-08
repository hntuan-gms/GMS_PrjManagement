// Chọn người có đủ thông tin (docs/plans/2026-11-07-dai-phau-ux.md, 0-3, F1, F10): "Gán…" ở thẻ việc chưa gán
// cho thấy ai rảnh / trùng mấy ngày TRONG khoảng ngày của việc, người rảnh đứng trước; gán người đã kín
// thì có toast kèm Hoàn tác, không bị chặn.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = (process.env.E2E_APP ?? "http://localhost:5173/?view=gantt").replace(/\?.*$/, "") + "?view=resource";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.setDefaultTimeout(8000);
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
let failed = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log("  ok  ", name);
  } catch (e) {
    failed++;
    console.log("  FAIL", name, "\n       ", String(e.message).split("\n")[0]);
  }
}
const patches = async () => (await (await fetch(API + "/api/__log")).json()).log.filter((l) => l.m === "PATCH");

await fetch(API + "/api/__restore", { method: "POST" });
await fetch(API + "/api/__reset", { method: "POST" });
await page.goto(APP);
await page.waitForSelector(".rv-pill-warn");
await page.locator(".rv-pill-warn").click();
await page.waitForSelector(".rv-unassigned");

await step("thẻ việc chưa gán ghi khoảng ngày của việc", async () => {
  assert.match(await page.locator(".rv-unassigned").innerText(), /\d+–\d+\/\d+ · \d+ ngày/);
});
await step("'Gán…' liệt kê người kèm rảnh / trùng n ngày, người rảnh đứng trước", async () => {
  await page.locator(".rv-unassigned button", { hasText: "Gán" }).first().click();
  await page.waitForSelector(".cell-picker-item");
  const items = await page.locator(".cell-picker-item").allTextContents();
  assert.ok(items.some((t) => t.includes("rảnh")), items.join(" | "));
  assert.ok(items.some((t) => /trùng \d+ ngày/.test(t)), items.join(" | "));
  const firstBusy = items.findIndex((t) => /trùng/.test(t));
  const lastFree = items.map((t) => t.includes("rảnh")).lastIndexOf(true);
  assert.ok(lastFree < firstBusy, "người rảnh phải đứng trước người trùng: " + items.join(" | "));
});
await step("gán người đã kín: vẫn gán, có toast nói đã kín và nút Hoàn tác", async () => {
  await page.locator(".cell-picker-item", { hasText: /trùng \d+ ngày/ }).first().click();
  for (let i = 0; i < 40 && (await patches()).length === 0; i++) await page.waitForTimeout(100);
  assert.equal((await patches()).length, 1, "không có PATCH gán người");
  const toast = page.locator(".toast", { hasText: "kín" });
  await toast.waitFor();
  await toast.getByRole("button", { name: "Hoàn tác" }).click();
  for (let i = 0; i < 40 && (await patches()).length < 2; i++) await page.waitForTimeout(100);
  const all = await patches();
  assert.equal(all.length, 2, "Hoàn tác không ghi lại");
  assert.ok(all[1].b.assigneeAccountId === null || all[1].b.assigneeAccountId === "" || all[1].b.assigneeAccountId === undefined, JSON.stringify(all[1].b));
});

assert.deepEqual(problems, [], problems.join("\n"));
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
await browser.close();
process.exit(failed ? 1 : 0);
