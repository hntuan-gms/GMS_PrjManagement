// Bảng, Chấm công and Báo cáo paint the last answer they showed when reopened, instead of
// starting blank and waiting on Jira (client/src/viewCache.ts). The stand-in API is held
// back on the second visit, so anything on screen before it answers came from the cache.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { openTimesheet } from "./toolbar.mjs";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.setDefaultTimeout(8000);
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && problems.push("console: " + m.text()));
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
const tab = (name) => page.locator(".toolbar-tabs button", { hasText: name }).click();

await page.goto(process.env.E2E_APP ?? "http://localhost:5173/");
await page.waitForSelector(".wbs-row");

/**
 * Tabs fetched ahead and untouched are not asked for again (viewCache.isViewFresh); an edit or a sync makes
 * what was fetched stale, so the tab asks again — which is what these steps need to observe.
 */
async function makeStale() {
  await page.locator(".sync-indicator").click();
  await page.waitForFunction(() => document.querySelector(".sync-indicator")?.textContent.includes("Khớp Jira"));
  await page.waitForTimeout(150);
}

/** Holds back every request whose path matches, until `release()`. */
async function hold(pattern) {
  let release;
  const gate = new Promise((r) => (release = r));
  const requests = [];
  await page.route(pattern, async (route) => {
    requests.push(route.request().url());
    await gate;
    await route.continue().catch(() => {});
  });
  return { release, requests, stop: () => page.unroute(pattern) };
}

console.log("\n== Mở lại tab ==");
await step("Bảng: lần đầu đợi API, lần sau hiện thẻ ngay khi API còn chưa trả lời", async () => {
  await tab("Bảng");
  await page.waitForSelector(".bd-card");
  await tab("Kế hoạch");
  await page.waitForSelector(".wbs-row");
  await makeStale();
  const held = await hold("**/api/board*");
  await tab("Bảng");
  await page.waitForSelector(".bd-card", { timeout: 1500 });
  assert.ok(held.requests.length >= 1, "vẫn phải hỏi lại để cập nhật");
  held.release();
  await held.stop();
});
await step("Chấm công: hiện lại bảng giờ công cũ trong lúc tải", async () => {
  await openTimesheet(page, { wait: false });
  await page.waitForSelector(".ts-wrap");
  await page.waitForFunction(() => !document.body.textContent.includes("Đang tải từ Jira"));
  const before = await page.locator(".ts-grid tbody tr").count();
  await tab("Kế hoạch");
  await makeStale();
  const held = await hold("**/api/timesheet*");
  await openTimesheet(page, { wait: false });
  await page.waitForSelector(".ts-wrap");
  assert.ok(await page.getByText("Đang tải từ Jira").count(), "phải báo đang tải lại");
  assert.equal(await page.locator(".ts-grid tbody tr").count(), before, "bảng cũ phải còn hiện");
  held.release();
  await held.stop();
});
await step("Báo cáo: hiện số liệu cũ ngay, không có màn 'đang tải'", async () => {
  await tab("Nhịp dự án");
  await page.waitForFunction(() => !document.querySelector(".pr-loading"));
  await tab("Kế hoạch");
  await makeStale();
  const held = await hold("**/api/progress?*");
  await tab("Nhịp dự án");
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".pr-loading").count(), 0, "đang hiện màn tải thay vì số liệu cũ");
  assert.ok((await page.textContent(".app-body")).includes("Trạng thái việc"));
  assert.ok(held.requests.length >= 1);
  held.release();
  await held.stop();
});
assert.equal(problems.length, 0, "lỗi trong trình duyệt: " + problems.join("; "));
await browser.close();
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
process.exit(failed ? 1 : 0);
