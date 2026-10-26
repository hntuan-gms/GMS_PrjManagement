// The KBKT import dialog, end to end: the stand-in API runs the REAL workbook
// parser and sync engine against an in-memory Jira (mock-api.mts), so this proves
// upload → preview → streamed apply → re-sync from the client's side. What Jira
// itself does with the writes is still checked by hand (docs/test-reports).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { ioAction } from "./toolbar.mjs";

const API = process.env.E2E_API ?? "http://localhost:4000";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.setDefaultTimeout(10000);
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && problems.push("console: " + m.text()));
const dialogs = [];
let confirmationText = "";
page.on("dialog", (d) => {
  dialogs.push(d.message());
  d.accept();
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
const posts = async (p) => (await (await fetch(API + "/api/__log")).json()).log.filter((l) => l.m === "POST" && l.p === p);

// Two versions of the same workbook (code 1E_127): only the higher _vN may be imported.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kbkt-e2e-"));
const bytes = Buffer.from(await (await fetch(API + "/api/__kbkt/sample")).arrayBuffer());
const v1 = path.join(dir, "AI-xx_1E127_BaoCao_v1.xlsx");
const v2 = path.join(dir, "AI-xx_1E127_BaoCao_v2.xlsx");
fs.writeFileSync(v1, bytes);
fs.writeFileSync(v2, bytes);

await fetch(API + "/api/__reset", { method: "POST" });
await fetch(API + "/api/__kbkt/reset", { method: "POST" });
await page.goto(process.env.E2E_APP ?? "http://localhost:5173/");
// Generous: when this runs first, Vite compiles the client on this request.
await page.waitForSelector(".wbs-row", { timeout: 60000 });

const modal = page.locator(".kb-modal");
// By the card's own heading: the v1 card's "superseded" notice also names the v2 file.
const card = (name) => modal.locator(".kb-file").filter({ has: page.locator(".kb-file-name strong", { hasText: name }) });
const preview = async () => {
  await modal.locator("button", { hasText: /^Xem trước$/ }).click();
  await page.waitForFunction(() => [...document.querySelectorAll(".kb-modal button")].some((b) => b.textContent === "Xem trước" && !b.disabled));
};
const applyBtn = modal.locator("button.primary", { hasText: "Áp dụng lên Jira" });

console.log("\n== Nhập KBKT ==");
await step("mục 'Nhập KBKT' (cạnh Xuất CSV, trong menu Nhập / Xuất) mở hộp thoại, cấu hình dự án tải từ máy chủ", async () => {
  await ioAction(page, "Nhập KBKT");
  await modal.waitFor();
  await modal.locator(".kb-settings > summary").click();
  await modal.locator(".kb-settings-body").waitFor();
  // "Sub Bug" in the settings matches the project's "Sub-Bug" only at sync time; the picker flags it.
  assert.ok(await modal.locator(".kb-settings-body option", { hasText: "Sub Bug (không có trong dự án)" }).count());
  await modal.locator(".kb-settings > summary").click();
});

await step("chọn 2 file → 2 thẻ, chưa xem trước thì không áp dụng được", async () => {
  await modal.locator('input[type="file"]').setInputFiles([v1, v2]);
  await card("_v1.xlsx").waitFor();
  await card("_v2.xlsx").waitFor();
  assert.ok(await applyBtn.isDisabled());
});

await step("không chọn Epic → máy chủ báo cần Epic, không áp dụng được", async () => {
  await preview();
  await card("_v2.xlsx").locator(".modal-error", { hasText: "chọn Epic" }).waitFor();
  assert.ok(await applyBtn.isDisabled());
});

await step("chọn Epic → xem lại: bản _v1 bị bỏ qua, bản _v2 sẽ tạo 10 issue", async () => {
  await modal.locator(".kb-params select").selectOption("DEMO-1");
  // Changing the Epic throws the old preview away.
  assert.equal(await card("_v2.xlsx").locator(".kb-chips").count(), 0);
  await preview();
  await card("_v1.xlsx").locator(".notice-warn", { hasText: "Bản cũ của 1E_127" }).waitFor();
  const chips = await card("_v2.xlsx").locator(".kb-chips").first().textContent();
  assert.match(chips, /Tạo mới\s*10/);
  assert.match(chips, /Liên kết\s*3/);
  assert.match(chips, /Đính kèm\s*2/);
  // The sheet's own warnings are shown without opening the details.
  await card("_v2.xlsx").locator(".notice-warn", { hasText: "BUG-02" }).waitFor();
  assert.ok(await applyBtn.isEnabled());
  assert.equal((await posts("/api/kbkt/apply")).length, 0, "preview must not apply");
});

await step("áp dụng → xác nhận, ghi đúng 1 file, nhật ký chạy dần và kết thúc bằng Story mới", async () => {
  await applyBtn.click();
  // The app's own confirmation (not the browser's): it names how many issues will be created.
  const confirmation = page.locator(".dlg");
  await confirmation.waitFor();
  confirmationText = await confirmation.textContent();
  await confirmation.locator("button.primary").click();
  await card("_v2.xlsx").locator(".kb-notice-ok", { hasText: /Xong — Story DEMO-\d+/ }).waitFor();
  assert.ok(confirmationText.includes("tạo 10 issue"), confirmationText);
  const applied = await posts("/api/kbkt/apply");
  assert.equal(applied.length, 1);
  const log = await card("_v2.xlsx").locator(".kb-log li").allTextContents();
  assert.ok(log.some((l) => l.startsWith("Chuyển trạng thái")), "no MOVE line in the streamed log");
  // The workspace reloads its tasks after a run that wrote something.
  assert.ok((await posts("/api/kbkt/apply")).length === 1);
});

await step("xem trước lại cùng file → không còn gì cần ghi (khớp theo nhãn), nút Áp dụng tắt", async () => {
  await preview();
  await card("_v2.xlsx").locator(".kb-muted", { hasText: "Không có gì cần ghi lên Jira." }).waitFor();
  // The sheet's warnings are still reported, they are just not changes.
  assert.match(await card("_v2.xlsx").locator(".kb-chips").textContent(), /Cảnh báo/);
  assert.ok(await applyBtn.isDisabled());
  await modal.locator(".footer-summary", { hasText: "Không có file nào cần ghi lên Jira." }).waitFor();
});

await step("'Story có sẵn': tìm theo tên, chọn DEMO-50 → xem trước chỉ chuyển test case sang DEMO-50, không gửi Epic", async () => {
  const c = card("_v2.xlsx");
  await c.getByLabel("Story có sẵn").check();
  await c.locator(".kb-picker input").fill("đăng nhập");
  await c.locator(".kb-picker-list button", { hasText: "DEMO-50" }).click();
  await c.locator(".kb-picked", { hasText: "UC đăng nhập hệ thống" }).waitFor();
  await preview();
  const chips = await c.locator(".kb-chips").first().textContent();
  assert.match(chips, /Cập nhật\s*9/);
  assert.doesNotMatch(chips, /Tạo mới/);
  const q = (await posts("/api/kbkt/preview")).at(-1).q;
  assert.equal(q.story, "DEMO-50");
  assert.equal(q.epic, undefined, "the Epic must not be sent with an existing Story");
});

await step("áp dụng → mọi test case và lỗi nằm dưới DEMO-50; DEMO-50 giữ nguyên Epic và tên", async () => {
  await applyBtn.click();
  // The app's own confirmation (not the browser's): it names how many issues will be created.
  const confirmation = page.locator(".dlg");
  await confirmation.waitFor();
  confirmationText = await confirmation.textContent();
  await confirmation.locator("button.primary").click();
  await card("_v2.xlsx").locator(".kb-notice-ok", { hasText: "Xong — Story DEMO-50." }).waitFor();
  const issues = await (await fetch(API + "/api/__kbkt/issues")).json();
  const subs = issues.filter((i) => i.labels.some((l) => /^(tc|bug)-/.test(l)));
  assert.equal(subs.length, 9);
  assert.ok(subs.every((i) => i.parent === "DEMO-50"), JSON.stringify(subs.map((i) => i.parent)));
  const story = issues.find((i) => i.key === "DEMO-50");
  assert.deepEqual([story.parent, story.summary], ["DEMO-1", "UC đăng nhập hệ thống"]);
});

await step("file tên 'DEMO-50_…' tự chọn Story DEMO-50; mã không có thì quay về Story riêng và nói rõ", async () => {
  const named = path.join(dir, "DEMO-50_1E127_BaoCao_v3.xlsx");
  const missing = path.join(dir, "DEMO-999_1E127_BaoCao_v4.xlsx");
  fs.writeFileSync(named, bytes);
  fs.writeFileSync(missing, bytes);
  await modal.locator('input[type="file"]').setInputFiles([named, missing]);
  await card("DEMO-50_").locator(".kb-picked", { hasText: "UC đăng nhập hệ thống" }).waitFor();
  assert.ok(await card("DEMO-50_").getByLabel("Story có sẵn").isChecked());
  await card("DEMO-999_").locator(".kb-muted", { hasText: "DEMO-999 không có trong dự án" }).waitFor();
  assert.ok(await card("DEMO-999_").getByLabel(/Story riêng của file/).isChecked());
});

await step("không có lỗi trình duyệt", async () => {
  assert.deepEqual(problems, []);
});

await browser.close();
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
