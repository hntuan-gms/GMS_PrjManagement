// Bảng, Chấm công and Báo cáo are fetched when the project opens, not when their tab is clicked: each is asked
// for exactly once, the tab then opens on that answer without asking again, and a change to the tasks (a sync,
// an edit) makes the tab ask afresh.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

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
const tab = (name) => page.locator(".toolbar-tabs button", { hasText: name }).click();
const counts = { tasks: 0, board: 0, timesheet: 0, progress: 0 };
page.on("request", (r) => {
  const m = r.url().match(/\/api\/(tasks|board|timesheet|progress)(\?|$)/);
  if (m && r.method() === "GET") counts[m[1]]++;
});
const snapshot = () => ({ ...counts });

await page.goto(process.env.E2E_APP ?? "http://localhost:5173/");
await page.waitForSelector(".wbs-row");
await page.waitForTimeout(1500);

console.log("\n== Tải sẵn khi mở dự án ==");
await step("mỗi tab được hỏi đúng một lần, trước khi bấm vào", async () => {
  const { board, timesheet, progress } = counts;
  assert.deepEqual({ board, timesheet, progress }, { board: 1, timesheet: 1, progress: 1 }, JSON.stringify(counts));
});

console.log("\n== Mở tab: không hỏi lại ==");
const before = snapshot();
await step("Bảng hiện thẻ ngay, không có request mới", async () => {
  await tab("Bảng");
  await page.waitForSelector(".bd-card", { timeout: 1000 });
});
await step("Chấm công hiện bảng ngay, không có request mới", async () => {
  await tab("Chấm công");
  await page.waitForSelector(".ts-wrap .ts-grid tbody tr", { timeout: 1000 });
});
await step("Báo cáo hiện số liệu ngay, không có request mới", async () => {
  await tab("Báo cáo");
  await page.waitForSelector(".pr-loading", { state: "detached", timeout: 1000 });
});
await step("cả ba tab không gọi thêm API nào", async () => {
  await page.waitForTimeout(600);
  assert.deepEqual(snapshot(), before);
});

console.log("\n== Việc đổi thì hỏi lại ==");
await step("sau khi đồng bộ, mở lại Bảng thì hỏi lại", async () => {
  await tab("Gantt");
  await page.getByRole("button", { name: /Đồng bộ từ Jira/ }).click();
  await page.waitForFunction(() => [...document.querySelectorAll(".toolbar button")].some((b) => b.textContent.includes("Đồng bộ từ Jira")));
  const boardBefore = counts.board;
  await tab("Bảng");
  await page.waitForSelector(".bd-card");
  await page.waitForTimeout(500);
  assert.ok(counts.board > boardBefore, "Bảng không hỏi lại dù việc đã đổi");
});

await step("không có lỗi trình duyệt", async () => {
  assert.deepEqual(problems, []);
});
await browser.close();
if (failed) {
  console.log(`\n${failed} lỗi`);
  process.exit(1);
}
console.log("\nđạt hết");
