// SLA (G2 #20): the policy dialog in the project menu, the WBS column, the "Trễ SLA" toggle,
// the row in the task window and the report tiles — all read one computed map (client/src/sla.ts).
// The stand-in's seed makes DEMO-3 late, DEMO-4 done on time and DEMO-7 within its deadline.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { fillDate, openDisplay, openFilterPanel, openSettings, quickFilter, quickIsOn } from "./toolbar.mjs";

const APP = process.env.E2E_APP ?? "http://localhost:5173/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
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

const localDay = (n) => {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const row = (key) => page.locator(".wbs-row", { hasText: key });
// Cài đặt is a page: back to the plan ("← Về Kế hoạch") before the steps that read the Gantt.
const backToPlan = async () => {
  await page.locator(".settings-back").click();
  await page.waitForSelector(".wbs-row");
};
// "Trễ SLA" is a switch at the top of the "Bộ lọc" panel: opened to read it, closed again.
const slaRow = async () => {
  await openFilterPanel(page);
  return page.locator(".tf-quick-row", { hasText: "Trễ SLA" });
};
const closePanel = () => page.keyboard.press("Escape");

await page.request.post(new URL("/api/__restore", APP).href);
await page.goto(APP);
await page.waitForSelector(".wbs-row");

console.log("\n== SLA: cài đặt ==");
await step("SLA tắt mặc định: không có nút 'Trễ SLA'", async () => {
  await page.waitForTimeout(300);
  assert.equal(await (await slaRow()).count(), 0);
  await closePanel();
});

await step("menu dự án → Cài đặt dự án → SLA mở mục với lịch mặc định", async () => {
  await openSettings(page, "SLA");
  await page.waitForSelector(".sla-modal");
  assert.match(await page.textContent(".sla-modal .sla-calendar-summary"), /08:00–12:00, 13:00–17:00/);
  // The site's priorities fill the target table.
  await page.waitForFunction(() => document.querySelectorAll(".sla-target").length === 5);
  assert.equal(await page.locator(".sla-target", { hasText: "Highest" }).locator("input").inputValue(), "4");
});

await step("bật SLA, áp dụng từ 60 ngày trước, lưu", async () => {
  await page.locator(".sla-switch input").check();
  await fillDate(page.locator(".sla-modal .date-field input[type=text]").first(), localDay(-60));
  await page.locator(".sla-modal button.primary", { hasText: "Lưu cài đặt" }).click();
  // Saved: the page stays and its Save goes back to disabled (nothing left to save).
  await page.waitForFunction(() => document.querySelector(".sla-modal button.primary")?.disabled);
  await backToPlan();
  await (await slaRow()).waitFor();
  await closePanel();
});

await step("Giờ làm việc nằm ở Lịch làm việc: khung chồng nhau bị máy chủ từ chối; 'Huỷ' trả về giá trị đã lưu, không hỏi", async () => {
  await openSettings(page, "SLA");
  await page.waitForSelector(".sla-modal");
  assert.equal(await page.locator(".sla-modal input[aria-label='Khung 1 kết thúc']").count(), 0, "SLA không còn khung giờ");
  assert.match(await page.textContent(".sla-modal .sla-calendar-summary"), /08:00–12:00, 13:00–17:00 · UTC\+7/);
  await openSettings(page, "Lịch làm việc");
  await page.waitForSelector(".cal-modal");
  const end1 = page.locator(".cal-modal input[aria-label='Khung 1 kết thúc']");
  await end1.fill("13:30");
  await end1.press("Enter");
  await page.locator(".cal-modal button.primary").click();
  await page.waitForSelector(".cal-modal .modal-error");
  assert.match(await page.textContent(".cal-modal .modal-error"), /chồng nhau/);
  await page.locator(".cal-modal .settings-foot button", { hasText: "Huỷ" }).click();
  assert.equal(await page.locator(".dlg").count(), 0, "Huỷ trên trang Cài đặt không hỏi lại");
  assert.equal(await end1.inputValue(), "12:00");
  assert.equal(await page.locator(".cal-modal button.primary").isDisabled(), true);
  await backToPlan();
});

console.log("\n== SLA: Gantt ==");
await step("cột 'SLA': trễ / đúng hạn / còn hạn / không áp dụng", async () => {
  await openDisplay(page);
  await page.locator(".col-chooser-item", { hasText: /^SLA$/ }).click();
  await page.keyboard.press("Escape");
  const cell = (key) => row(key).locator(".wbs-cell-sla");
  await cell("DEMO-3").locator(".sla-chip.is-breached").waitFor();
  assert.match(await cell("DEMO-3").textContent(), /^Trễ /);
  assert.equal((await cell("DEMO-4").textContent()).trim(), "Đúng hạn");
  assert.match(await cell("DEMO-7").textContent(), /^Còn /);
  assert.equal((await cell("DEMO-5").textContent()).trim(), "—", "no createdAt in the seed → not measured");
  assert.equal((await cell("DEMO-1").textContent()).trim(), "—", "Epics are never measured by default");
});

await step("nút 'Trễ SLA (1)' lọc đúng việc trễ, bấm lại thì bỏ lọc", async () => {
  assert.match(await (await slaRow()).textContent(), /Trễ SLA \(1\)/);
  await closePanel();
  await quickFilter(page, "Trễ SLA");
  await page.waitForFunction(() => document.querySelector(".tf-count")?.textContent.includes("1/9"));
  assert.equal(await quickIsOn(page, "sla"), true);
  await quickFilter(page, "Trễ SLA");
  await page.waitForFunction(() => !document.querySelector(".tf-count"));
});

await step("chi tiết task có dòng SLA (chỉ đọc)", async () => {
  await row("DEMO-3").locator(".wbs-summary").dblclick();
  await page.waitForSelector(".modal-detail");
  const text = await page.locator(".td-sla").textContent();
  assert.match(text, /Trễ SLA/);
  assert.match(text, /đã trễ .* làm việc/);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".modal-detail", { state: "detached" });
});

console.log("\n== SLA: Báo cáo ==");
await step("ô 'Trễ SLA' đếm 1 và mở đúng danh sách", async () => {
  await page.locator(".toolbar-tabs button", { hasText: "Nhịp dự án" }).click();
  const tile = page.locator(".pr-tile", { hasText: "Trễ SLA" }).filter({ hasNotText: "Sắp" });
  await tile.waitFor();
  assert.equal((await tile.locator("b").textContent()).trim(), "1");
  await tile.click();
  await page.waitForSelector(".pr-drawer");
  const keys = await page.$$eval(".pr-drawer-row .pr-issue", (els) => els.map((e) => e.textContent));
  assert.deepEqual(keys, ["DEMO-3"]);
  await page.keyboard.press("Escape");
});

await page.request.post(new URL("/api/__restore", APP).href);
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
await browser.close();
process.exit(failed ? 1 : 0);
