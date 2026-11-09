// Cài đặt dự án is a page (plan B4): `G S` and the project menu open it, `?view=settings` too, a menu on the
// left with four sections (Lịch làm việc, SLA, Nhập KBKT, Thẻ trên board), "← Về <nơi trước>" at the top, no lens underlined,
// Save at the foot of each section and on only when something changed, and a read-only form for someone who
// is not a project admin. The sections are the bodies of the old dialogs (classes .cal-modal, .sla-modal, .kb-settings).
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { openLens, openSettings } from "./toolbar.mjs";

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
const activeSection = async () => (await page.locator(".settings-nav-item.active").textContent()).trim();

await api("POST", "/api/__restore");
await page.goto(APP);
await page.waitForSelector(".wbs-row");

console.log("\n== Mở trang ==");
await step("menu tên dự án có 'Cài đặt dự án', không còn 'Cài đặt SLA' riêng", async () => {
  await page.locator(".project-switch").click();
  assert.ok(await page.locator("[role=menuitem]", { hasText: "Cài đặt dự án" }).isVisible());
  assert.equal(await page.locator("[role=menuitem]", { hasText: "Cài đặt SLA" }).count(), 0);
  await page.keyboard.press("Escape");
});

await step("G rồi S mở trang; không lăng kính nào được gạch chân", async () => {
  await page.keyboard.press("g");
  await page.keyboard.press("s");
  await page.waitForSelector(".settings-page");
  assert.equal(await page.locator(".toolbar-tabs button[aria-current=page]").count(), 0);
  assert.equal(await page.locator(".toolbar-tabs button.active").count(), 0);
});

await step("menu trái có đúng bốn mục", async () => {
  const labels = (await page.locator(".settings-nav-item").allTextContents()).map((t) => t.trim());
  assert.deepEqual(labels, ["Lịch làm việc", "SLA", "Nhập KBKT", "Thẻ trên board"]);
  assert.equal(await activeSection(), "Lịch làm việc");
  await page.locator(".cal-modal").waitFor();
});

await step("'← Về Kế hoạch' ở trên cùng, bấm thì về kế hoạch", async () => {
  const back = page.locator(".settings-back");
  assert.match(await back.textContent(), /Về List/);
  await back.click();
  await page.waitForSelector(".wbs-row");
  assert.equal(await page.locator(".settings-page").count(), 0);
});

await step("?view=settings mở thẳng trang, và không được nhớ làm nơi mở lại", async () => {
  const url = new URL(APP);
  url.searchParams.set("view", "settings");
  await page.goto(url.href);
  await page.waitForSelector(".settings-page");
  const plain = new URL(APP);
  plain.searchParams.delete("view");
  await page.goto(plain.href);
  await page.waitForSelector(".toolbar-tabs");
  assert.equal(await page.locator(".settings-page").count(), 0, "mở lại dự án không được rơi vào trang cài đặt");
  await page.goto(APP);
  await page.waitForSelector(".wbs-row");
});

console.log("\n== Các mục ==");
await step("lệnh Ctrl K 'Cài đặt SLA…' mở đúng mục SLA", async () => {
  await page.keyboard.press("Control+k");
  await page.fill(".cmdk input", "SLA");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".settings-page .sla-modal:not(.cal-modal)");
  assert.equal(await activeSection(), "SLA");
});

await step("sửa một ô: Lưu bật; Huỷ trả về giá trị đã lưu không hỏi", async () => {
  const save = page.locator(".sla-modal .settings-foot button.primary");
  assert.equal(await save.isDisabled(), true, "chưa sửa gì thì Lưu tắt");
  await page.locator(".sla-switch input").check();
  assert.equal(await save.isDisabled(), false);
  await page.locator(".sla-modal .settings-foot button", { hasText: "Huỷ" }).click();
  assert.equal(await page.locator(".dlg").count(), 0);
  assert.equal(await page.locator(".sla-switch input").isChecked(), false);
  assert.equal(await save.isDisabled(), true);
});

await step("đang sửa mà đổi mục: hỏi; 'Tiếp tục sửa' ở lại, 'Bỏ thay đổi' đi", async () => {
  await page.locator(".sla-switch input").check();
  await page.locator(".settings-nav-item", { hasText: "Lịch làm việc" }).click();
  await page.waitForSelector(".dlg");
  await page.locator(".dlg button", { hasText: "Tiếp tục sửa" }).click();
  assert.equal(await activeSection(), "SLA");
  await page.locator(".settings-nav-item", { hasText: "Lịch làm việc" }).click();
  await page.locator(".dlg button.danger-solid").click();
  await page.waitForSelector(".cal-modal");
  assert.equal(await activeSection(), "Lịch làm việc");
});

await step("'Mở Lịch làm việc' trong SLA chuyển mục", async () => {
  await page.locator(".settings-nav-item", { hasText: "SLA" }).click();
  await page.locator(".sla-calendar-summary button").click();
  await page.waitForSelector(".cal-modal");
  assert.equal(await activeSection(), "Lịch làm việc");
});

await step("Nhập KBKT: cấu hình dùng chung, Lưu chỉ bật khi đổi", async () => {
  await page.locator(".settings-nav-item", { hasText: "Nhập KBKT" }).click();
  await page.waitForSelector(".settings-body .kb-settings .kb-settings-body");
  const save = page.locator(".kb-settings .settings-foot button.primary");
  assert.equal(await save.isDisabled(), true);
  const select = page.locator(".kb-settings select").first();
  const before = await select.inputValue();
  const options = await select.locator("option").evaluateAll((os) => os.map((o) => o.value));
  const other = options.find((o) => o !== before);
  assert.ok(other, "cần ít nhất hai lựa chọn để thử");
  await select.selectOption(other);
  assert.equal(await save.isDisabled(), false);
  await page.locator(".kb-settings .settings-foot button", { hasText: "Huỷ" }).click();
  assert.equal(await select.inputValue(), before);
  assert.equal(await save.isDisabled(), true);
});

await step("Thẻ trên board: đổi ở đây thì nút Thẻ của Bảng thấy ngay", async () => {
  await page.locator(".settings-nav-item", { hasText: "Thẻ trên board" }).click();
  // Before the Bảng tab has been drawn there is no board to edit.
  await page.locator(".settings-body .sla-muted", { hasText: "Chưa mở tab Board" }).waitFor();
  await openLens(page, "Board");
  await page.waitForSelector(".bd-card");
  await openSettings(page, "Thẻ trên board");
  const box = page.locator(".board-card-settings");
  await box.waitFor();
  const key = box.locator("label.bd-card-opt", { hasText: /^Mã$/ }).locator("input");
  assert.equal(await key.isChecked(), true);
  await key.uncheck();
  await openLens(page, "Board");
  await page.waitForSelector(".bd-card");
  await page.locator(".bd-cardbtn").click();
  const same = page.locator(".bd-card-menu label.bd-card-opt", { hasText: /^Mã$/ }).locator("input");
  assert.equal(await same.isChecked(), false);
  await same.check();
  await page.keyboard.press("Escape");
});

console.log("\n== Quyền ==");
await step("không phải quản trị dự án: cả hai mục chỉ đọc, một dòng giải thích, không có nút lưu", async () => {
  await api("POST", "/api/__sla-canedit", { canEdit: false });
  await page.reload();
  await page.waitForSelector(".toolbar");
  for (const [section, root] of [
    ["Lịch làm việc", ".cal-modal"],
    ["SLA", ".sla-modal:not(.cal-modal)"],
  ]) {
    await openSettings(page, section);
    const box = page.locator(root);
    await box.waitFor();
    await box.locator(".sla-note", { hasText: "Chỉ quản trị dự án được sửa" }).waitFor();
    assert.notEqual(await box.locator("fieldset").getAttribute("disabled"), null);
    assert.equal(await box.locator("button.primary").count(), 0);
  }
});

await api("POST", "/api/__restore");
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
console.log("Hộp thoại/console:", problems.length ? problems.join("\n") : "không có");
await browser.close();
process.exit(failed ? 1 : 0);
