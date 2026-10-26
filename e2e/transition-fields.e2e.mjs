// Changing a status when the workflow wants more than a click: a box on the transition's screen
// ("RootCause" on the way to Done) or one only a validator checks (a reason for Rejected). Plus the
// detail window's unsaved-changes guard and the app's own dialogs. Client against the stand-in API.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.setDefaultTimeout(8000);
const problems = [];
const native = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
// Refused moves are the point of several steps; the browser logs each 400 as a console error.
page.on("console", (m) => m.type() === "error" && !m.text().includes("400 (Bad Request)") && problems.push("console: " + m.text()));
page.on("dialog", async (d) => {
  native.push(d.message());
  await d.dismiss();
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
const reset = () => fetch(API + "/api/__reset", { method: "POST" });
const patches = async () => (await (await fetch(API + "/api/__log")).json()).log.filter((l) => l.m === "PATCH");
const row = (id) => page.locator(".wbs-row", { hasText: id });

await page.goto(process.env.E2E_APP ?? "http://localhost:5173/");
await page.waitForSelector(".wbs-row");

async function selectTwo() {
  await row("DEMO-5").click();
  await row("DEMO-6").click({ modifiers: ["Control"] });
  await page.waitForSelector(".selection-bar");
}
const openStatusMenu = () => page.locator(".selection-bar .selection-trigger", { hasText: "Đổi trạng thái" }).click();

console.log("\n== Đổi trạng thái hàng loạt ==");
await step("menu chỉ liệt kê bước quy trình cho phép, kèm số việc chuyển được và trường cần nhập", async () => {
  await reset();
  await selectTwo();
  await openStatusMenu();
  await page.waitForSelector(".bulk-status-item");
  const items = await page.$$eval(".bulk-status-item", (b) => b.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  assert.ok(items.some((t) => t.includes("In Progress") && t.includes("2/2")), items.join(" | "));
  assert.ok(items.some((t) => t.includes("Done") && t.includes("Cần nhập: RootCause")), items.join(" | "));
  assert.ok(!items.some((t) => t.includes("Pending") || t.includes("OPEN")), "đưa ra trạng thái mà quy trình không cho: " + items);
});
await step("Done cần RootCause: hỏi trước, chưa gửi gì, rồi gửi kèm giá trị cho cả hai việc", async () => {
  await page.locator(".bulk-status-item", { hasText: "Done" }).click();
  assert.equal((await patches()).length, 0, "đã gửi trước khi hỏi");
  const submit = page.locator(".bulk-fields button[type=submit]");
  assert.equal(await submit.isDisabled(), true, "nút Chuyển phải khoá khi chưa nhập");
  await page.locator(".bulk-fields .field", { hasText: "RootCause" }).locator("input").fill("Cấu hình sai");
  await submit.click();
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.filter((l) => l.m === "PATCH").length >= 2);
  const p = await patches();
  assert.ok(p.every((x) => x.b.statusTransition === "Done" && x.b.transitionFields.customfield_9 === "Cấu hình sai"), JSON.stringify(p.map((x) => x.b)));
});
await step("một hộp chỉ validator đòi (Rejected): lần gửi đầu bị từ chối → hộp thoại hỏi một lần → gửi lại cả hai", async () => {
  await reset();
  await page.reload();
  await page.waitForSelector(".wbs-row");
  await selectTwo();
  await openStatusMenu();
  await page.locator(".bulk-status-item", { hasText: "Rejected" }).click();
  const dlg = page.locator(".dlg");
  await dlg.waitFor();
  assert.ok((await dlg.textContent()).includes("Vui lòng nhập Lý do từ chối"), "phải nói lý do Jira đưa ra");
  assert.equal(await dlg.locator("button[type=submit]").isDisabled(), true);
  await dlg.locator(".field", { hasText: "Lý do từ chối" }).locator("input").fill("Trùng việc");
  await dlg.locator("button[type=submit]").click();
  await dlg.waitFor({ state: "detached" });
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.filter((l) => l.m === "PATCH" && l.b.transitionFields?.customfield_8 === "Trùng việc").length >= 2);
});

console.log("\n== Cửa sổ chi tiết ==");
async function openTask(id) {
  await reset();
  await page.reload();
  await page.waitForSelector(".wbs-row");
  await row(id).dblclick();
  await page.waitForSelector(".modal-detail .modal-id");
}
const statusSelect = () => page.locator("#td-status");

await step("bố cục hai cột: nội dung chính bên trái, chi tiết bên phải; trạng thái ở đầu bảng chi tiết", async () => {
  await openTask("DEMO-5");
  const main = await page.locator(".td-main").boundingBox();
  const side = await page.locator(".td-side").boundingBox();
  assert.ok(side.x > main.x + main.width - 2, "bảng chi tiết phải nằm bên phải");
  const groups = await page.$$eval(".td-group-title", (h) => h.map((x) => x.textContent));
  assert.deepEqual(groups.slice(0, 2), ["Trạng thái", "Con người"]);
  assert.equal(await page.locator(".modal-detail").getAttribute("role"), "dialog");
});
await step("danh sách trạng thái là danh sách của ứng dụng (select tuỳ biến), không phải của hệ điều hành", async () => {
  const appearance = await statusSelect().evaluate((el) => getComputedStyle(el).appearance);
  assert.equal(appearance, "base-select");
});
await step("chọn Done: hiện ô RootCause; bấm Lưu khi chưa nhập thì không gửi mà báo thiếu gì", async () => {
  await statusSelect().selectOption({ label: "Done · cần nhập thêm" });
  await page.locator(".td-needs").waitFor();
  await page.locator(".modal-footer .primary").click();
  assert.ok((await page.locator(".td-error").textContent()).includes("RootCause"));
  assert.equal((await patches()).length, 0);
});
await step("nhập RootCause → lưu gửi kèm transitionFields", async () => {
  await page.locator(".td-needs .field", { hasText: "RootCause" }).locator("input").fill("Thiếu index");
  await page.locator(".modal-footer .primary").click();
  await page.waitForSelector(".modal", { state: "detached" });
  const p = (await patches()).at(-1).b;
  assert.equal(p.statusTransition, "31");
  assert.equal(p.transitionFields.customfield_9, "Thiếu index");
});
await step("Rejected (validator): lần lưu đầu bị từ chối → ô xuất hiện ngay tại chỗ với câu của Jira → lưu lại thành công", async () => {
  await openTask("DEMO-5");
  await statusSelect().selectOption({ label: "Rejected (Reject)" });
  await page.locator(".modal-footer .primary").click();
  const needs = page.locator(".td-needs");
  await needs.waitFor();
  assert.ok((await needs.textContent()).includes("Vui lòng nhập Lý do từ chối"));
  assert.equal(await page.locator(".modal").count(), 1, "cửa sổ không được đóng");
  await needs.locator("input").fill("Không làm nữa");
  await page.locator(".modal-footer .primary").click();
  await page.waitForSelector(".modal", { state: "detached" });
  assert.equal((await patches()).at(-1).b.transitionFields.customfield_8, "Không làm nữa");
});

console.log("\n== Thay đổi chưa lưu & hộp thoại ==");
await step("sửa tiêu đề rồi Esc → hỏi 'Bỏ thay đổi?'; chọn tiếp tục thì ở lại, bỏ thì đóng", async () => {
  await openTask("DEMO-5");
  await page.locator(".td-title").fill("Tiêu đề mới");
  assert.ok(await page.locator(".td-dirty").isVisible(), "phải báo có thay đổi chưa lưu");
  await page.keyboard.press("Escape");
  const dlg = page.locator(".dlg");
  await dlg.waitFor();
  assert.ok((await dlg.textContent()).includes("thay đổi chưa lưu"));
  await dlg.locator("button", { hasText: "Tiếp tục chỉnh sửa" }).click();
  assert.equal(await page.locator(".modal-detail").count(), 1);
  assert.equal(await page.locator(".td-title").inputValue(), "Tiêu đề mới", "mất nội dung đã gõ");
  await page.keyboard.press("Escape");
  await dlg.waitFor();
  await dlg.locator("button.danger-solid").click();
  await page.waitForSelector(".modal", { state: "detached" });
  assert.equal((await patches()).length, 0, "không được lưu gì");
});
await step("không sửa gì thì đóng ngay, không hỏi", async () => {
  await openTask("DEMO-5");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".modal", { state: "detached" });
  assert.equal(await page.locator(".dlg").count(), 0);
});
await step("Esc trong hộp thoại chỉ đóng hộp thoại; focus trả về chỗ cũ", async () => {
  await openTask("DEMO-5");
  await page.locator(".td-title").fill("x");
  await page.locator("button.modal-close").focus();
  await page.keyboard.press("Escape");
  await page.locator(".dlg").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".dlg").waitFor({ state: "detached" });
  assert.equal(await page.locator(".modal-detail").count(), 1, "Esc trong hộp thoại đã đóng luôn cửa sổ chi tiết");
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("modal-close")), true, "focus phải về nút cũ");
  await page.locator("button.modal-close").click();
  await page.locator(".dlg button.danger-solid").click();
  await page.waitForSelector(".modal", { state: "detached" });
});
await step("không có hộp thoại nào của trình duyệt được bật", async () => {
  assert.deepEqual(native, []);
});

assert.equal(problems.length, 0, "lỗi trong trình duyệt: " + problems.join("; "));
await browser.close();
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
process.exit(failed ? 1 : 0);
