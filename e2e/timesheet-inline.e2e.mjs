// Ghi giờ ngay trong ô (docs/plans/2026-11-07-dai-phau-ux.md, F5): trên dòng của chính mình, gõ số giờ vào ô
// ngày trống, chọn việc, Enter. Dòng người khác không nhận giờ (Jira chỉ cho ghi dưới tên người đăng nhập).
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { openTimesheet } from "./toolbar.mjs";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = process.env.E2E_APP ?? "http://localhost:5173/?view=gantt";
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
const log = async () => (await (await fetch(API + "/api/__log")).json()).log;

await fetch(API + "/api/__restore", { method: "POST" });
await fetch(API + "/api/__reset", { method: "POST" });
await page.goto(APP);
await page.waitForSelector(".wbs-row");
await openTimesheet(page);

const mine = () => page.locator(".ts-grid tbody tr", { has: page.locator(".ts-tag", { hasText: "bạn" }) });
const emptyDay = () => mine().locator("input.ts-inline").first();

await step("chỉ dòng của mình có ô nhập; dòng người khác thì không", async () => {
  assert.ok((await mine().locator("input.ts-inline").count()) > 0, "dòng của mình không có ô nhập");
  const others = page.locator(".ts-grid tbody tr", { hasNot: page.locator(".ts-tag", { hasText: "bạn" }) });
  assert.equal(await others.locator("input.ts-inline").count(), 0, "dòng người khác có ô nhập");
});
await step("gõ chữ không phải giờ rồi Enter: ô đỏ, không hỏi việc, không ghi gì", async () => {
  await emptyDay().fill("abc");
  await emptyDay().press("Enter");
  await page.waitForSelector("input.ts-inline.is-bad");
  assert.equal(await page.locator(".cell-picker").count(), 0);
  assert.equal((await log()).filter((l) => l.m === "POST").length, 0);
  await emptyDay().fill("");
});
await step("gõ 2h30, Enter, chọn việc: POST /timesheet/worklogs đúng giờ", async () => {
  await emptyDay().fill("2h30");
  await emptyDay().press("Enter");
  await page.waitForSelector(".cell-picker-item");
  await page.locator(".cell-picker-item").first().click();
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "POST" && l.p === "/api/timesheet/worklogs"));
  const posted = (await log()).find((l) => l.m === "POST" && l.p === "/api/timesheet/worklogs");
  assert.equal(posted.b.hours, 2.5);
  assert.match(posted.b.issueKey, /^DEMO-\d+$/);
  assert.match(posted.b.date, /^\d{4}-\d{2}-\d{2}$/);
});

assert.deepEqual(problems, [], problems.join("\n"));
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
await browser.close();
process.exit(failed ? 1 : 0);
