// Một bộ lọc cho mọi lăng kính (docs/plans/2026-11-07-dai-phau-ux.md, E1 và E2): "Của tôi" bật ở Kế hoạch
// thì Bảng cũng đang lọc, Shift F xoá ở cả hai, bấm Epic ở panel Backlog hiện thành chip ở Kế hoạch,
// và tải lại vẫn giữ. Cần ProjectWorkspace đã truyền taskFilter/onFilterChange vào BoardView.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const page = await ctx.newPage();
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
const lens = (name) => page.locator(".toolbar-tabs button", { hasText: name }).click();
const mineButton = () => page.locator(".tf-bar button[title='Việc của tôi']");

await fetch(API + "/api/__restore", { method: "POST" });
await page.goto(process.env.E2E_APP ?? "http://localhost:5173/?view=gantt");
await page.waitForSelector(".wbs-row");
await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes("filter")).forEach((k) => localStorage.removeItem(k)));
await page.reload();
await page.waitForSelector(".wbs-row");

console.log("\n== Kế hoạch → Bảng ==");
await step("Của tôi ở Kế hoạch: có bộ đếm, nút sáng", async () => {
  await mineButton().click();
  await page.waitForSelector(".tf-count");
  assert.equal(await mineButton().getAttribute("aria-pressed"), "true");
});
await step("sang Bảng (phím 2): Bảng đang lọc Của tôi, cùng nút, cùng bộ đếm", async () => {
  await page.keyboard.press("2");
  await page.waitForSelector(".bd-card, .bd-empty");
  await page.waitForSelector(".bd-filters .tf-active");
  assert.equal(await mineButton().getAttribute("aria-pressed"), "true", "Của tôi phải còn sáng ở Bảng");
  assert.ok((await page.textContent(".bd-filters .tf-count")).includes("thẻ"));
});
await step("Shift F xoá ở Bảng, và Kế hoạch cũng sạch", async () => {
  await page.keyboard.press("Shift+F");
  await page.waitForFunction(() => !document.querySelector(".bd-filters .tf-active"));
  assert.equal(await mineButton().getAttribute("aria-pressed"), "false");
  await page.keyboard.press("1");
  await page.waitForSelector(".wbs-row");
  assert.equal(await page.locator(".tf-count").count(), 0, "Kế hoạch vẫn đang lọc");
});

console.log("\n== Bảng → Kế hoạch ==");
await step("lọc đặt ở Bảng (Quá hạn) hiện ở Kế hoạch, và tải lại vẫn giữ", async () => {
  await page.keyboard.press("2");
  await page.waitForSelector(".bd-filters");
  await page.locator(".bd-filters .tf-bar button[title='Quá hạn và chưa xong']").click();
  await page.keyboard.press("1");
  await page.waitForSelector(".wbs-row");
  const overdue = page.locator(".tf-bar button[title='Quá hạn và chưa xong']");
  assert.equal(await overdue.getAttribute("aria-pressed"), "true");
  await page.reload();
  await page.waitForSelector(".wbs-row");
  assert.equal(await page.locator(".tf-bar button[title='Quá hạn và chưa xong']").getAttribute("aria-pressed"), "true", "mất lọc sau khi tải lại");
  await page.keyboard.press("Shift+F");
  await page.waitForFunction(() => !document.querySelector(".tf-count"));
});
await step("panel Epic của Backlog ghi vào bộ lọc chung: Kế hoạch thấy chip Epic", async () => {
  await page.keyboard.press("2");
  await page.waitForSelector(".bd-seg");
  await page.locator(".bd-seg button", { hasText: "Backlog" }).click();
  await page.waitForSelector(".bl-panel .bl-panel-row");
  await page.locator(".bl-panel-row").first().click();
  await page.waitForSelector(".bd-filters .tf-chip");
  await page.keyboard.press("1");
  await page.waitForSelector(".wbs-row");
  assert.ok((await page.locator(".tf-chip").allTextContents()).some((t) => t.includes("Epic")), "Kế hoạch không có chip Epic");
  await page.keyboard.press("Shift+F");
  await page.waitForFunction(() => !document.querySelector(".tf-chip"));
});

await browser.close();
if (problems.length) console.log("\nCảnh báo trình duyệt:\n" + problems.join("\n"));
console.log(failed ? `\n${failed} lỗi` : "\nTất cả đạt");
process.exit(failed ? 1 : 0);
