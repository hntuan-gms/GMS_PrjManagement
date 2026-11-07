// L1: the address follows the lens. Changing lens writes ?view=, F5 stays where it was, Back goes to the
// lens before, a link opens the place it names, and ?view=timesheet is still Nhân lực · Giờ đã ghi.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = (process.env.E2E_APP ?? "http://localhost:5173/").replace(/\?.*$/, "");
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
const view = () => new URL(page.url()).searchParams.get("view");
const current = async () => (await page.locator(".lens-tabs button[aria-current=page]").textContent()).replace(/\d+.*$/, "").trim();

await fetch(API + "/api/__restore", { method: "POST" });
await page.goto(APP + "?view=today");
await page.waitForSelector(".lens-tabs");

console.log("\n== Địa chỉ theo lăng kính ==");
await step("mở ?view=today, bấm Bảng thì địa chỉ thành ?view=board", async () => {
  await page.locator(".lens-tabs button", { hasText: "Bảng" }).click();
  await page.waitForSelector(".bd-switcher");
  assert.equal(view(), "board");
});
await step("F5 giữ nguyên Bảng", async () => {
  await page.reload();
  await page.waitForSelector(".bd-switcher");
  assert.equal(await current(), "Bảng");
});
await step("1 rồi 2 rồi Back về Kế hoạch (không thoát khỏi app)", async () => {
  await page.goto(APP + "?view=today");
  await page.waitForSelector(".lens-tabs");
  await page.keyboard.press("1");
  await page.waitForSelector(".wbs-row");
  await page.keyboard.press("2");
  await page.waitForSelector(".bd-switcher");
  await page.goBack();
  await page.waitForSelector(".wbs-row");
  assert.equal(view(), "gantt");
  assert.equal(await current(), "Kế hoạch");
  await page.goForward();
  await page.waitForSelector(".bd-switcher");
  assert.equal(view(), "board");
});
await step("liên kết ?view=report mở Nhịp dự án", async () => {
  await page.goto(APP + "?view=report");
  await page.waitForSelector(".progress-view");
  assert.equal(await current(), "Nhịp dự án");
});
await step("?view=timesheet mở Nhân lực ở chế độ Giờ đã ghi, đổi chế độ thì địa chỉ đổi theo", async () => {
  await page.goto(APP + "?view=timesheet");
  await page.waitForSelector(".ts-legend");
  assert.equal(await current(), "Nhân lực");
  assert.equal(view(), "timesheet");
  await page.locator("button, [role=tab]", { hasText: /^Mức tải$/ }).first().click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get("view") === "resource");
});
await step("Cài đặt: '← Về …' quay lại bằng Back, không thêm mục lịch sử", async () => {
  await page.goto(APP + "?view=board");
  await page.waitForSelector(".bd-switcher");
  const before = await page.evaluate(() => history.length);
  await page.keyboard.press("g");
  await page.keyboard.press("s");
  await page.waitForSelector(".settings-page");
  assert.equal(view(), "settings");
  await page.locator(".settings-back").click();
  await page.waitForSelector(".bd-switcher");
  assert.equal(view(), "board");
  assert.equal(await page.evaluate(() => history.length), before + 1, "chỉ thêm đúng một mục (lúc vào Cài đặt)");
});
await step("giữ các tham số khác khi đổi lăng kính", async () => {
  await page.goto(APP + "?view=gantt&foo=bar");
  await page.waitForSelector(".wbs-row");
  await page.keyboard.press("3");
  await page.waitForFunction(() => new URL(location.href).searchParams.get("view") === "resource");
  assert.equal(new URL(page.url()).searchParams.get("foo"), "bar");
});

assert.equal(problems.length, 0, "lỗi trong trình duyệt: " + problems.join("; "));
await fetch(API + "/api/__restore", { method: "POST" });
await browser.close();
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
process.exit(failed ? 1 : 0);
