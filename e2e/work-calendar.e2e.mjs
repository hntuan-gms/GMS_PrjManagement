// The project's working calendar (G4 #10/#11): "Lịch làm việc & ngày lễ…" in the project menu, holidays
// entered as a range, make-up days, and every view that reads it — the resource heatmap (no capacity on a
// holiday, a day's capacity on a make-up Saturday), the timesheet (a holiday is nobody's gap), the SLA
// dialog's summary — plus the two rules the server enforces: saving SLA never writes the calendar, and only
// a project admin may save it. The stand-in API runs the server's own validator (validateCalendar).
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { fillDate, openLens, openSettings, openTimesheet, setGranularity } from "./toolbar.mjs";

const APP = process.env.E2E_APP ?? "http://localhost:5173/";
const API = process.env.E2E_API ?? "http://localhost:4000";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.setDefaultTimeout(8000);
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("dialog", (d) => {
  problems.push("native dialog: " + d.message());
  d.dismiss();
});
let failed = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log("  ok  ", name);
  } catch (e) {
    failed++;
    console.log("  FAIL", name, "\n       ", String(e.message).split("\n").slice(0, 4).join(" | "));
  }
}
const api = (method, path, body) =>
  fetch(API + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

const localDay = (n) => {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const dmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
// The holiday covers the whole week around today, so the timesheet's week view is all holiday.
const HOLIDAY_FROM = localDay(-6);
const HOLIDAY_TO = localDay(6);
let k = 7;
while (weekdayOf(localDay(k)) !== 6) k++;
const SATURDAY = localDay(k);
let m = 7;
while (weekdayOf(localDay(m)) !== 1) m++;
const MONDAY = localDay(m);

const cal = () => page.locator(".cal-modal");

await api("POST", "/api/__restore");
await page.goto(APP);
await page.waitForSelector(".wbs-row");

console.log("\n== Lịch làm việc & ngày lễ ==");
await step("menu dự án → Cài đặt dự án → Lịch làm việc, mặc định T2–T6", async () => {
  await openSettings(page, "Lịch làm việc");
  await cal().waitFor();
  const checked = await cal()
    .locator(".sla-check")
    .evaluateAll((els) => els.filter((e) => e.querySelector("input").checked).map((e) => e.textContent.trim()));
  assert.deepEqual(checked, ["T2", "T3", "T4", "T5", "T6"]);
});

await step("thêm ngày lễ theo khoảng: một dòng gom 13 ngày", async () => {
  const dates = cal().locator(".cal-add-range .date-field input[type=text]");
  await fillDate(dates.nth(0), HOLIDAY_FROM);
  await fillDate(dates.nth(1), HOLIDAY_TO);
  await cal().locator(".cal-add-range input[placeholder^='vd']").fill("Nghỉ lễ thử");
  await cal().locator(".cal-add-range button", { hasText: "Thêm" }).click();
  const row = cal().locator(".cal-list li", { hasText: "Nghỉ lễ thử" });
  await row.waitFor();
  assert.match(await row.textContent(), /13 ngày/);
});

await step("ngày làm bù: ngày thường bị cảnh báo, Thứ 7 thì thêm được", async () => {
  const date = cal().locator(".cal-add-single .date-field input[type=text]");
  await fillDate(date, MONDAY);
  await cal().locator(".cal-error", { hasText: "vốn đã là ngày làm việc" }).waitFor();
  assert.equal(await cal().locator(".cal-add-single button", { hasText: "Thêm" }).isDisabled(), true);
  await fillDate(date, SATURDAY);
  await cal().locator(".cal-add-single input[placeholder^='vd']").fill("Làm bù thử");
  await cal().locator(".cal-add-single button", { hasText: "Thêm" }).click();
  await cal().locator(".cal-list li", { hasText: "Làm bù thử" }).waitFor();
});

await step("lưu: nút Lưu tắt lại, máy chủ giữ 13 ngày lễ và 1 ngày làm bù", async () => {
  await cal().locator("button.primary", { hasText: "Lưu lịch" }).click();
  await page.waitForFunction(() => document.querySelector(".cal-modal button.primary")?.disabled);
  const { calendar } = await (await api("GET", "/api/calendar")).json();
  assert.equal(calendar.holidays.length, 13);
  assert.deepEqual(calendar.makeUpDays, [{ date: SATURDAY, name: "Làm bù thử" }]);
});

console.log("\n== Các màn hình đọc lịch ==");
await step("Nguồn lực: ngày lễ ghi 'Ngày lễ: …', Thứ 7 làm bù có công suất 8h", async () => {
  await openLens(page, "Nhân lực");
  await page.waitForSelector(".resource-view .rv-row-person");
  await setGranularity(page, "day");
  const titles = await page.locator(".rv-row-person").first().locator(".rv-cell").evaluateAll((els) => els.map((e) => e.title));
  const today = titles.find((t) => t.startsWith(dmy(localDay(0))));
  assert.ok(today, "không thấy ô của hôm nay");
  assert.match(today, /Ngày lễ: Nghỉ lễ thử/);
  const sat = titles.find((t) => t.startsWith(dmy(SATURDAY)));
  assert.ok(sat, "không thấy ô của Thứ 7 làm bù");
  assert.match(sat, /h \/ 8h/);
});

await step("Chấm công: cả tuần là ngày lễ — không ô 'chưa ghi', giờ kỳ vọng 0h", async () => {
  await openTimesheet(page);
  await page.locator("[data-scope=team]").click();
  await page.waitForSelector(".ts-prow");
  const heads = await page.locator(".ts-grid thead th.is-holiday").count();
  assert.equal(heads, 7, `${heads} cột ngày lễ`);
  assert.equal(await page.locator(".ts-owes").count(), 0, "ngày lễ không phải ngày thiếu");
  assert.match(await page.locator(".ts-prow").first().locator(".ts-total").textContent(), /\/ 0h/);
});

console.log("\n== SLA dùng chung lịch ==");
await step("mục SLA chỉ tóm tắt lịch và chuyển được sang mục Lịch làm việc", async () => {
  await openSettings(page, "SLA");
  await page.waitForSelector(".sla-modal");
  const summary = page.locator(".sla-calendar-summary");
  assert.match(await summary.textContent(), /T2–T6 · 08:00–12:00, 13:00–17:00 · UTC\+7 · 13 ngày lễ · 1 ngày làm bù/);
  await summary.locator("button", { hasText: "Mở Lịch làm việc" }).click();
  await cal().waitFor();
  assert.equal(await page.locator(".sla-modal:not(.cal-modal)").count(), 0, "mục SLA không còn hiện");
  assert.equal(await page.locator(".settings-nav-item.active").textContent(), "Lịch làm việc");
});

await step("lưu SLA không xoá ngày lễ đã lưu", async () => {
  await openSettings(page, "SLA");
  await page.waitForSelector(".sla-modal");
  await page.locator(".sla-switch input").check();
  await page.locator(".sla-modal button.primary", { hasText: "Lưu cài đặt" }).click();
  await page.waitForFunction(() => document.querySelector(".sla-modal button.primary")?.disabled);
  const { calendar } = await (await api("GET", "/api/calendar")).json();
  assert.equal(calendar.holidays.length, 13);
  assert.equal(calendar.makeUpDays.length, 1);
});

await step("người không phải quản trị dự án: chỉ xem, không có nút lưu", async () => {
  await api("POST", "/api/__sla-canedit", { canEdit: false });
  await page.reload();
  await page.waitForSelector(".toolbar");
  await openSettings(page, "Lịch làm việc");
  await cal().waitFor();
  await cal().locator(".sla-note", { hasText: "Chỉ quản trị dự án được sửa" }).waitFor();
  assert.notEqual(await cal().locator("fieldset").getAttribute("disabled"), null);
  assert.equal(await cal().locator("button.primary").count(), 0);
});

await api("POST", "/api/__restore");
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
console.log("Hộp thoại/console:", problems.length ? problems.join("\n") : "không có");
await browser.close();
process.exit(failed || problems.length ? 1 : 0);
