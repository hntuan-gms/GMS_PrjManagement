// What a person does on the plan shows on screen at once, not when Jira answers (the real one takes ~3 s a
// write). The stand-in API is slowed to 2.5 s for every write and each step checks the screen within 800 ms:
// the new row, the edited name, the "Hoàn tác" after a date change, the removed row. When Jira refuses, the
// row goes again and the toast offers "Thử lại". Contract for ProjectWorkspace's optimistic paths.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = process.env.E2E_APP ?? "http://localhost:5173/?view=gantt";
const SLOW = 2500;
const FAST = 800;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.setDefaultTimeout(8000);
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("dialog", (d) => {
  problems.push("dialog: " + d.message());
  d.dismiss();
});
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
const slow = (ms) => fetch(API + "/api/__writedelay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ms }) });
const row = (key) => page.locator(".wbs-row", { hasText: key });

await fetch(API + "/api/__restore", { method: "POST" });
// Dates in the table, so a date can be edited in a cell.
await page.addInitScript(() => localStorage.setItem("gms.gantt.columns", JSON.stringify(["status", "assignee", "start", "due", "pct"])));
await page.goto(APP);
await page.waitForSelector(".wbs-row");
await slow(SLOW);

console.log("\n== Việc mới hiện ngay ==");
await step("thêm việc ở dòng cuối: dòng hiện ngay (mờ), vài giây sau thành việc thật", async () => {
  const input = page.locator(".wbs-add > input");
  await input.fill("Việc tạo nhanh");
  await input.press("Enter");
  await page.locator(".wbs-row.is-pending", { hasText: "Việc tạo nhanh" }).waitFor({ timeout: FAST });
  await page.waitForFunction(() => !document.querySelector(".wbs-row.is-pending"), null, { timeout: SLOW + 4000 });
  assert.equal(await page.locator(".wbs-row", { hasText: "Việc tạo nhanh" }).count(), 1, "mất dòng hoặc thành hai dòng");
  assert.equal(await input.inputValue(), "", "ô nhập không được xoá ngay");
});
await step("việc con từ '+': dòng hiện ngay dưới việc cha", async () => {
  await row("DEMO-5").hover();
  await row("DEMO-5").locator("button.wbs-add-child").click();
  const box = page.locator(".subtask-add input[aria-label='Tên việc con']");
  await box.fill("Con tạo nhanh");
  await box.press("Enter");
  await page.locator(".wbs-row.is-pending", { hasText: "Con tạo nhanh" }).waitFor({ timeout: FAST });
  assert.equal(await box.inputValue(), "", "thẻ + phải sẵn sàng cho việc kế tiếp ngay");
  await page.waitForFunction(() => !document.querySelector(".wbs-row.is-pending"), null, { timeout: SLOW + 4000 });
  await page.keyboard.press("Escape");
});
await step("Jira từ chối: dòng biến mất, báo lỗi kèm 'Thử lại'", async () => {
  const input = page.locator(".wbs-add > input");
  await input.fill("Việc sẽ bị từ chối [cần hạn]");
  await fetch(API + "/api/__requirements", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  await input.press("Enter");
  await page.locator(".wbs-row.is-pending", { hasText: "bị từ chối" }).waitFor({ timeout: FAST });
  await page.waitForFunction(() => ![...document.querySelectorAll(".wbs-row")].some((r) => r.textContent.includes("bị từ chối")), null, { timeout: SLOW + 4000 });
  await page.locator(".toast-error", { hasText: "bắt buộc điền" }).last().waitFor();
  assert.ok(await page.locator(".toast-error button", { hasText: "Thử lại" }).count(), "thiếu nút Thử lại");
});

console.log("\n== Sửa hiện ngay ==");
// The refusal above leaves its (sticky) toast over the bottom-left rows; close what is there.
while (await page.locator(".toast-close").count()) await page.locator(".toast-close").first().click();
await step("đổi ngày bắt đầu ở ô: 'Đã dời' và 'Hoàn tác' hiện ngay, không chờ Jira", async () => {
  await row("DEMO-8").locator(".wbs-col-name").click();
  await row("DEMO-8").locator("[data-cell='start']").click();
  const editor = page.locator(".wbs-cell-editor input[type=text], .wbs-cell-editor input").first();
  await editor.waitFor();
  await editor.fill("25/12/2026");
  await editor.press("Enter");
  const toast = page.locator(".toast", { hasText: "Đã dời DEMO-8" });
  await toast.waitFor({ timeout: FAST });
  assert.ok(await toast.locator("button", { hasText: "Hoàn tác" }).count(), "thiếu Hoàn tác");
  // The cell shows the date at once, too.
  assert.match(await row("DEMO-8").locator("[data-cell='start']").textContent(), /25\/12\/2026|25\/12/);
  await page.waitForTimeout(SLOW + 500);
});
await step("sửa tên bằng F2: tên mới hiện ngay", async () => {
  await row("DEMO-6").locator(".wbs-col-name").click();
  await page.keyboard.press("F2");
  await page.waitForSelector(".wbs-cell-editor");
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Tên sửa nhanh");
  await page.keyboard.press("Enter");
  await page.locator(".wbs-row", { hasText: "Tên sửa nhanh" }).first().waitFor({ timeout: FAST });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(SLOW + 500);
});
await step("dời ngày hàng loạt (Alt →): ngày đổi ngay trên các dòng đã chọn", async () => {
  await row("DEMO-3").locator(".wbs-col-name").click();
  const before = await row("DEMO-3").locator("[data-cell='start']").textContent();
  await page.keyboard.press("Alt+ArrowRight");
  await page.waitForFunction(
    ([k, b]) => document.querySelector(`.wbs-row[data-row-id="${k}"] [data-cell="start"]`)?.textContent !== b,
    ["DEMO-3", before],
    { timeout: FAST }
  );
  await page.waitForTimeout(SLOW + 500);
});

console.log("\n== Xoá hiện ngay ==");
await step("xoá việc: dòng biến mất ngay, không chờ Jira", async () => {
  await row("DEMO-7").locator(".wbs-col-name").click();
  await page.locator(".selection-bar button.danger").click();
  await page.locator(".dlg button.danger-solid").click();
  await page.waitForFunction(() => !document.querySelector('.wbs-row[data-row-id="DEMO-7"]'), null, { timeout: FAST });
  await page.waitForTimeout(SLOW + 800);
  assert.equal(await row("DEMO-7").count(), 0, "việc đã xoá hiện lại sau khi Jira trả lời");
});

await slow(0);
assert.deepEqual(problems, [], problems.join("\n"));
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
await browser.close();
process.exit(failed ? 1 : 0);
