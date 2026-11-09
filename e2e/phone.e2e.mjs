// 3.9: on a phone (390px) the app is Hôm nay and the board as a list. The rail is a bar along the bottom, the other
// lenses are not offered (a link to one lands on Hôm nay), the board's columns are stacked and the page does not scroll sideways.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = (process.env.E2E_APP ?? "http://localhost:5173/").replace(/\?.*$/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
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

await fetch(API + "/api/__restore", { method: "POST" });
await page.goto(APP + "?view=gantt");
await page.waitForSelector(".app-rail");

console.log("\n== Điện thoại ==");
await step("liên kết tới Kế hoạch mở Hôm nay; Hôm nay không có lăng kính", async () => {
  await page.waitForSelector(".today-view");
  assert.equal(await page.locator(".lens-tabs").count(), 0);
});
await step("thanh bên thành thanh dưới cùng, không che nội dung", async () => {
  const r = await page.locator(".app-rail").boundingBox();
  assert.ok(r.y + r.height >= 779 && r.width >= 380 && r.height <= 64, JSON.stringify(r));
  assert.equal(await page.locator(".rail-mark").isVisible(), false);
});
await step("trang không cuộn ngang ở Hôm nay và ở Bảng", async () => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  // On a phone "Dự án" on the bottom bar opens the board, the one lens there is room for.
  await page.locator(".rail-btn[data-view=plan]").click();
  await page.waitForSelector(".bd-card");
  assert.deepEqual(await page.locator(".lens-tabs button").allTextContents().then((t) => t.map((x) => x.trim())), ["Board"]);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
});
await step("cột của Bảng xếp dọc, mỗi cột có tên phía trên thẻ", async () => {
  const xs = await page.$$eval(".bd-col:not(.is-folded)", (c) => c.map((e) => Math.round(e.getBoundingClientRect().left)));
  assert.ok(xs.length >= 2 && new Set(xs).size === 1, "cột chưa xếp dọc: " + xs);
  const name = await page.$eval(".bd-col[data-col]", (e) => getComputedStyle(e, "::before").content);
  assert.ok(name.length > 2, name);
});
await step("mở thẻ: khung chi tiết chiếm cả màn hình", async () => {
  await page.locator(".bd-card").first().click();
  await page.waitForSelector(".modal-detail");
  const w = (await page.locator(".modal-detail").boundingBox()).width;
  assert.ok(w >= 380, "khung rộng " + w);
  await page.keyboard.press("Escape");
});
await step("rộng lại thì có đủ bốn lăng kính", async () => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForFunction(() => document.querySelectorAll(".lens-tabs button").length === 4);
});

assert.equal(problems.length, 0, "lỗi trong trình duyệt: " + problems.join("; "));
await fetch(API + "/api/__restore", { method: "POST" });
await browser.close();
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
process.exit(failed ? 1 : 0);
