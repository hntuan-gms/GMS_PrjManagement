// Lập lịch ngay trên Kế hoạch (docs/plans/2026-11-07-dai-phau-ux.md, C1 và C4): việc chưa có ngày có dòng
// riêng và được xếp bằng cách kéo trên dòng đó (cùng đường PATCH và hoàn tác với kéo thanh); ô trong bảng sửa
// tại chỗ bằng F2 / Tab / Enter; nhấp đúp vẫn mở chi tiết.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

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
const patches = async () => (await log()).filter((l) => l.m === "PATCH");

await fetch(API + "/api/__restore", { method: "POST" });
await fetch(API + "/api/__reset", { method: "POST" });
await page.goto(APP);
await page.waitForSelector(".wbs-row");

console.log("\n== Việc chưa có ngày ==");
await step("DEMO-9 (chưa có ngày) có dòng WBS và ô ngày ghi —", async () => {
  const row = page.locator(".wbs-row", { hasText: "DEMO-9" });
  assert.equal(await row.count(), 1);
  assert.ok(await page.locator(".unsched-lane[data-task-id='DEMO-9']").count(), "không có vùng kéo trên dòng");
});
await step("kéo trên dòng DEMO-9 vẽ thanh: PATCH startDate + durationDays, không gì khác", async () => {
  const lane = await page.locator(".unsched-lane[data-task-id='DEMO-9']").boundingBox();
  // The lane spans the whole padded axis, most of it scrolled out of the pane: press inside the part on screen.
  const chart = await page.locator("._CZjuD").boundingBox();
  const y = lane.y + lane.height / 2;
  const x = Math.max(lane.x, chart.x) + 200;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y, { steps: 4 });
  await page.mouse.move(x + 120, y, { steps: 4 });
  assert.ok(await page.locator(".unsched-draw").count(), "không có bóng khi đang kéo");
  await page.mouse.up();
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "PATCH"));
  const p = (await patches())[0];
  assert.equal(p.p, "/api/tasks/DEMO-9");
  assert.match(p.b.startDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(p.b.durationDays >= 2, "thời lượng " + p.b.durationDays);
  assert.deepEqual(Object.keys(p.b).sort(), ["durationDays", "startDate"]);
});
await step("Ctrl Z trả DEMO-9 về chưa có ngày", async () => {
  await page.locator(".gantt-body").click({ position: { x: 20, y: 300 } });
  await page.keyboard.press("Control+z");
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.filter((l) => l.m === "PATCH").length >= 2);
});

console.log("\n== Sửa ô tại chỗ ==");
await step("F2 trên dòng đã chọn sửa tên; Enter lưu", async () => {
  await fetch(API + "/api/__reset", { method: "POST" });
  await page.locator(".wbs-row", { hasText: "DEMO-5" }).locator(".wbs-col-name").click();
  await page.keyboard.press("F2");
  await page.waitForSelector(".wbs-cell-editor");
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Tên mới từ ô");
  await page.keyboard.press("Enter");
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "PATCH"));
  const p = (await patches()).find((x) => x.p === "/api/tasks/DEMO-5");
  assert.equal(p.b.summary, "Tên mới từ ô");
  // Enter moves the editor down to the next row; Esc leaves it.
  await page.keyboard.press("Escape");
  await page.waitForSelector(".wbs-cell-editor", { state: "detached" });
});
await step("nhấp đúp vẫn mở chi tiết", async () => {
  await page.locator(".wbs-row", { hasText: "DEMO-6" }).locator(".wbs-col-name").dblclick();
  await page.waitForSelector(".modal .modal-id");
  assert.equal((await page.textContent(".modal .modal-id")).trim(), "DEMO-6");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".modal", { state: "detached" });
});

assert.deepEqual(problems, [], problems.join("\n"));
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
await browser.close();
process.exit(failed ? 1 : 0);
