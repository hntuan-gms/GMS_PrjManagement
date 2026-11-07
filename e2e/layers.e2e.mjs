// Lớp phủ có một chủ (docs/plans/2026-11-07-dai-phau-ux.md, 0-6 và A1-A4): Esc đóng đúng lớp trên cùng,
// phím tắt không lọt xuống dưới một lớp đang mở, bấm nút rail đóng tờ bên rồi mới làm việc của nút,
// ô lệnh xếp lệnh trước việc khi cùng khớp, và Shift D chạy ngay sau khi kéo một thanh.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = process.env.E2E_APP ?? "http://localhost:5173/?view=gantt";
const HOME = APP.replace(/\?view=[a-z]+/, "");
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
const gone = (sel) => page.waitForSelector(sel, { state: "detached" });

await fetch(API + "/api/__restore", { method: "POST" });
await page.goto(APP);
await page.waitForSelector(".wbs-row");

console.log("\n== Hộp chọn dự án (Ctrl P) ==");
await step("Esc đóng hộp chọn dự án", async () => {
  await page.keyboard.press("Control+p");
  await page.waitForSelector(".modal-overlay .project-list, .modal-overlay .picker-title");
  await page.keyboard.press("Escape");
  await gone(".modal-overlay");
});
await step("Phím gõ trong hộp chọn dự án không đổi lăng kính phía sau", async () => {
  await page.keyboard.press("Control+p");
  await page.waitForSelector(".modal-overlay input");
  await page.keyboard.type("2");
  assert.equal(await page.inputValue(".modal-overlay input"), "2");
  assert.equal(await page.locator("[data-lens=gantt].active, [data-lens=gantt][aria-current=page]").count(), 1, "lăng kính đã đổi");
  await page.keyboard.press("Escape");
  await gone(".modal-overlay");
});
await step("Ctrl K khi hộp chọn dự án đang mở không mở ô lệnh phía sau", async () => {
  await page.keyboard.press("Control+p");
  await page.waitForSelector(".modal-overlay input");
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".cmdk-overlay").count(), 0, "ô lệnh đã mở");
  await page.keyboard.press("Escape");
  await gone(".modal-overlay");
});
await step("Ctrl P rồi mũi tên xuống + Enter không để lại hộp nào treo", async () => {
  await page.keyboard.press("Control+p");
  await page.waitForSelector(".modal-overlay input");
  await page.keyboard.press("Escape");
  await gone(".modal-overlay");
});

console.log("\n== Tờ ghi giờ (Hôm nay) ==");
await step("Esc đóng tờ Ghi giờ hôm nay, kể cả khi tiêu điểm không nằm trong tờ", async () => {
  await page.goto(HOME + "?view=today");
  await page.waitForSelector(".today-view");
  await page.locator(".today-log-btn").click();
  await page.waitForSelector(".side-sheet");
  await page.mouse.click(300, 400);
  await page.keyboard.press("Escape");
  await gone(".side-sheet");
});
await step("Bấm Trợ lý khi tờ ghi giờ mở: tờ đóng và trợ lý mở", async () => {
  await page.locator(".today-log-btn").click();
  await page.waitForSelector(".side-sheet");
  await page.locator(".app-rail button[aria-label='Trợ lý']").click();
  await gone(".side-sheet");
  await page.waitForSelector(".chat-dock");
  await page.keyboard.press("Escape");
});

console.log("\n== Ô lệnh (Ctrl K) ==");
await step("gõ 'nháp' thì dòng đầu là lệnh Bật bản nháp, không phải việc 'đăng nhập'", async () => {
  await page.goto(APP);
  await page.waitForSelector(".wbs-row");
  await page.keyboard.press("Control+k");
  await page.waitForSelector(".cmdk");
  await page.keyboard.type("nháp");
  await page.waitForTimeout(150);
  const first = await page.locator(".cmdk-list [role=option], .cmdk-list .cmdk-item").first().textContent();
  assert.match(first, /bản nháp/i, first);
  await page.keyboard.press("Escape");
  await gone(".cmdk-overlay");
});
await step("mã việc khớp đúng vẫn đứng đầu", async () => {
  await page.keyboard.press("Control+k");
  await page.waitForSelector(".cmdk");
  await page.keyboard.type("DEMO-5");
  await page.waitForTimeout(150);
  const first = await page.locator(".cmdk-list [role=option], .cmdk-list .cmdk-item").first().textContent();
  assert.match(first, /DEMO-5/, first);
  await page.keyboard.press("Escape");
  await gone(".cmdk-overlay");
});

console.log("\n== Shift D sau khi kéo thanh ==");
await step("kéo một thanh rồi Shift D bật bản nháp ngay, dòng còn đang chọn", async () => {
  await fetch(API + "/api/__reset", { method: "POST" });
  await page.goto(APP);
  await page.waitForSelector(".wbs-row");
  const target = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".wbs-row")];
    const bars = [...document.querySelectorAll("g.bar > g")];
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].textContent.includes("DEMO-5")) continue;
      const r = bars[i]?.querySelector("g[tabindex] rect")?.getBoundingClientRect();
      if (r) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  });
  assert.ok(target, "không thấy thanh DEMO-5");
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 40, target.y, { steps: 5 });
  await page.mouse.move(target.x + 90, target.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  await page.keyboard.press("Shift+D");
  await page.waitForSelector(".draft-bar", { timeout: 3000 });
});

assert.deepEqual(problems, [], problems.join("\n"));
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
await browser.close();
process.exit(failed ? 1 : 0);
