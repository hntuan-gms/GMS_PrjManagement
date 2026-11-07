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
const statusChip = () => page.locator("#td-status");
const chooseStatus = async (label) => {
  await statusChip().click();
  await page.locator(".cell-picker-item", { has: page.locator(".cell-picker-label", { hasText: new RegExp("^" + label + "$") }) }).click();
};

await step("hai khung: tên và mô tả bên trái, trạng thái · người · ưu tiên và chi tiết bên phải, trạng thái nằm đầu khung phải", async () => {
  await openTask("DEMO-5");
  await page.waitForTimeout(500); // the layer fades in
  const left = await page.locator(".td-left").boundingBox();
  const right = await page.locator(".td-right").boundingBox();
  const title = await page.locator(".td-title").boundingBox();
  const status = await statusChip().boundingBox();
  const desc = await page.locator(".td-left .tdx-block").first().boundingBox();
  assert.ok(right.x >= left.x + left.width - 1, "hai khung phải cạnh nhau");
  assert.ok(title.y + title.height <= desc.y + 2, "mô tả phải nằm dưới tên việc");
  assert.ok(status.x >= right.x && status.y - right.y < 60, "trạng thái phải ở đầu khung phải");
  assert.equal(await page.locator(".td-group-title").count(), 0, "không còn tiêu đề nhóm");
  assert.equal(await page.locator(".modal-footer").count(), 0, "không còn chân khung với nút Lưu");
  assert.equal(await page.locator(".modal-detail").getAttribute("role"), "dialog");
});
await step("danh sách trạng thái là danh sách của ứng dụng, không phải của hệ điều hành", async () => {
  await statusChip().click();
  await page.locator(".cell-picker").waitFor();
  assert.equal(await page.locator(".modal-detail select#td-status").count(), 0);
  await page.keyboard.press("Escape");
  await page.locator(".cell-picker").waitFor({ state: "detached" });
  assert.equal(await page.locator(".modal-detail").count(), 1, "Esc đã đóng luôn cửa sổ chi tiết");
});
await step("chọn Done: hiện ô RootCause; bấm Chuyển khi chưa nhập thì không gửi mà báo thiếu gì", async () => {
  await chooseStatus("Done");
  await page.locator(".td-needs").waitFor();
  await page.locator(".td-needs button.primary").click();
  assert.ok((await page.locator(".td-needs .td-error").textContent()).includes("RootCause"));
  assert.equal((await patches()).length, 0);
});
await step("nhập RootCause → chuyển gửi kèm transitionFields, khung vẫn mở và đã sang Done", async () => {
  await page.locator(".td-needs .field", { hasText: "RootCause" }).locator("input").fill("Thiếu index");
  await page.locator(".td-needs button.primary").click();
  await page.locator(".td-needs").waitFor({ state: "detached" });
  const p = (await patches()).at(-1).b;
  assert.equal(p.statusTransition, "31");
  assert.equal(p.transitionFields.customfield_9, "Thiếu index");
  assert.ok((await statusChip().textContent()).includes("Done"));
  assert.equal(await page.locator(".modal-detail").count(), 1, "khung phải còn mở");
});
await step("Rejected (validator): bị từ chối → ô xuất hiện ngay tại chỗ với câu của Jira, trạng thái trả về cũ → chuyển lại thành công", async () => {
  await openTask("DEMO-5");
  const was = (await statusChip().textContent()).trim();
  await chooseStatus("Rejected");
  const needs = page.locator(".td-needs");
  await needs.waitFor();
  assert.ok((await needs.textContent()).includes("Vui lòng nhập Lý do từ chối"));
  assert.equal(await page.locator(".modal-detail").count(), 1, "cửa sổ không được đóng");
  assert.equal((await statusChip().textContent()).trim(), was, "bị từ chối thì trạng thái phải trả về cũ");
  await needs.locator("input").fill("Không làm nữa");
  await needs.locator("button.primary").click();
  await needs.waitFor({ state: "detached" });
  assert.equal((await patches()).at(-1).b.transitionFields.customfield_8, "Không làm nữa");
  assert.ok((await statusChip().textContent()).includes("Rejected"));
});

console.log("\n== Lưu từng trường & hộp thoại ==");
await step("sửa tiêu đề rồi Enter → lưu ngay một yêu cầu riêng, báo 'Đã lưu', không có nút Lưu", async () => {
  await openTask("DEMO-5");
  const t = page.locator(".td-title");
  await t.fill("Tiêu đề mới");
  await t.press("Enter");
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "PATCH" && l.b.summary === "Tiêu đề mới"));
  const last = (await patches()).at(-1);
  assert.deepEqual(Object.keys(last.b), ["summary"], "chỉ gửi trường vừa sửa");
  await page.locator(".tdx-save.is-saved").waitFor();
  assert.equal(await page.locator(".modal-detail").count(), 1);
  assert.equal(await page.locator(".dlg").count(), 0, "không được hỏi gì");
});
await step("Esc khi đang sửa tiêu đề → trả tiêu đề cũ, khung còn nguyên, không gửi gì", async () => {
  await openTask("DEMO-5");
  const before = await page.locator(".td-title").inputValue();
  await page.locator(".td-title").fill("Gõ dở");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".td-title").inputValue(), before);
  assert.equal(await page.locator(".modal-detail").count(), 1, "Esc đã đóng khung khi đang sửa");
  await page.waitForTimeout(300);
  assert.equal((await patches()).length, 0);
});
await step("không sửa gì thì Esc đóng ngay, không hỏi", async () => {
  await openTask("DEMO-5");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".modal", { state: "detached" });
  assert.equal(await page.locator(".dlg").count(), 0);
});
await step("Esc trong hộp thoại chỉ đóng hộp thoại, khung chi tiết còn nguyên", async () => {
  // The one dialog the panel still raises is "Xoá …?" (last item of the ⋯ menu): Esc there closes only the dialog.
  await openTask("DEMO-5");
  await page.locator(".td-more").click();
  await page.locator(".td-more-menu .menu-item.is-danger").click();
  await page.locator(".dlg").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".dlg").waitFor({ state: "detached" });
  assert.equal(await page.locator(".modal-detail").count(), 1, "Esc trong hộp thoại đã đóng luôn cửa sổ chi tiết");
  await page.locator("button.modal-close").click();
  await page.waitForSelector(".modal", { state: "detached" });
});
await step("không có hộp thoại nào của trình duyệt được bật", async () => {
  assert.deepEqual(native, []);
});

assert.equal(problems.length, 0, "lỗi trong trình duyệt: " + problems.join("; "));
await browser.close();
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
process.exit(failed ? 1 : 0);
