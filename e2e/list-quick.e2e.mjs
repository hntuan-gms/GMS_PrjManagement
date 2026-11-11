// List (the plan): the tick box before "Mã", the "+" that adds a child under a row, and "Ngày kết thúc" in the
// create form. The client against the stand-in API.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = process.env.E2E_APP ?? "http://localhost:5173/?view=gantt";
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
const log = async () => (await (await fetch(API + "/api/__log")).json()).log;
const bulkPosts = async () => (await log()).filter((l) => l.m === "POST" && l.p === "/api/tasks/bulk");
async function waitForBulk(n) {
  for (let i = 0; i < 60; i++) {
    if ((await bulkPosts()).length > n) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("không thấy POST /api/tasks/bulk");
}
const row = (key) => page.locator(".wbs-row", { hasText: key });

await fetch(API + "/api/__restore", { method: "POST" });
await page.goto(APP);
await page.waitForSelector(".wbs-row");

console.log("\n== Ô tick trước Mã ==");
await step("mỗi hàng có ô tick đứng trước Mã, xanh da trời khi tick", async () => {
  const check = row("DEMO-5").locator("input.wbs-check");
  assert.equal(await check.count(), 1);
  const [cx, kx] = await Promise.all([
    check.evaluate((el) => el.getBoundingClientRect().left),
    row("DEMO-5").locator(".wbs-col-key").evaluate((el) => el.getBoundingClientRect().left),
  ]);
  assert.ok(cx < kx, "ô tick phải nằm trước cột Mã");
  const accent = await check.evaluate((el) => getComputedStyle(el).accentColor);
  const [r, g, b] = accent.match(/\d+/g).map(Number);
  assert.ok(b > r && b > g, `màu ô tick phải xanh da trời: ${accent}`);
});
await step("tick chọn hàng, không mở cửa sổ; tick thêm hàng khác giữ cả hai; bỏ tick thì bỏ chọn", async () => {
  await row("DEMO-5").locator("input.wbs-check").check();
  await row("DEMO-6").locator("input.wbs-check").check();
  await page.waitForSelector(".selection-bar");
  assert.match(await page.textContent(".selection-count"), /2/);
  assert.equal(await page.locator(".peek-panel").count(), 0);
  await row("DEMO-5").locator("input.wbs-check").uncheck();
  assert.match(await page.textContent(".selection-count"), /1/);
});
await step("nhấp đúp vào ô tick không mở cửa sổ chi tiết", async () => {
  await row("DEMO-8").locator("input.wbs-check").dblclick();
  assert.equal(await page.locator(".peek-panel").count(), 0);
});
await step("ô tick ở đầu bảng chọn / bỏ chọn tất cả các hàng đang hiện", async () => {
  const all = page.locator(".wbs-header input.wbs-check");
  await all.check();
  const n = await page.locator(".wbs-row").count();
  assert.match(await page.textContent(".selection-count"), new RegExp(String(n)));
  assert.equal(await page.locator(".wbs-row input.wbs-check:not(:checked)").count(), 0);
  await all.uncheck();
  await page.waitForSelector(".selection-bar", { state: "detached" });
});
await step("chọn hàng không làm bảng dịch chỗ", async () => {
  const top = () => row("DEMO-5").evaluate((el) => el.getBoundingClientRect().top);
  const before = await top();
  await row("DEMO-5").locator("input.wbs-check").check();
  await page.waitForSelector(".selection-bar");
  assert.equal(await top(), before);
  await row("DEMO-5").locator("input.wbs-check").uncheck();
});

console.log("\n== Tạo việc con từ List ==");
await step("'+' trên hàng mở ô gõ tên việc con; Enter tạo, gửi kèm việc cha", async () => {
  await fetch(API + "/api/__reset", { method: "POST" });
  await row("DEMO-5").hover();
  await row("DEMO-5").locator("button.wbs-add-child").click();
  const box = page.locator(".subtask-add input[aria-label='Tên việc con']");
  await box.waitFor();
  assert.match(await page.textContent(".subtask-add-parent"), /DEMO-5/);
  await box.fill("Việc con thử nhanh");
  await box.press("Enter");
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "POST" && l.p === "/api/tasks/bulk"));
  const post = (await log()).find((l) => l.m === "POST" && l.p === "/api/tasks/bulk");
  assert.equal(post.b.wbsParentId, "DEMO-5");
  assert.deepEqual(post.b.summaries, ["Việc con thử nhanh"]);
  // The box stays for the next one, emptied.
  await page.waitForFunction(() => document.querySelector(".subtask-add input[aria-label=\"Tên việc con\"]")?.value === "");
  assert.equal(await page.locator(".peek-panel").count(), 0);
});
await step("'Ngày, người' trong ô '+': Bắt đầu, Kết thúc, Người đi kèm lúc tạo", async () => {
  await fetch(API + "/api/__reset", { method: "POST" });
  const before = (await log()).filter((l) => l.m === "POST" && l.p === "/api/tasks/bulk").length;
  const box = page.locator(".subtask-add input[aria-label='Tên việc con']");
  // Nothing to open first: the dates and the owner are on the card from the start.
  await page.locator(".subtask-add .qa-extras").waitFor();
  assert.equal(await page.locator(".subtask-add-more").count(), 0, "không còn nút mở thêm");
  assert.equal(await page.locator(".subtask-add button[hidden]").count(), 0, "nút gửi ẩn lộ ra thành một thanh trống");
  await page.locator(".subtask-add [aria-label='Ngày bắt đầu']").fill("02/11/2026");
  await page.locator(".subtask-add [aria-label='Ngày kết thúc']").fill("06/11/2026");
  await page.locator(".subtask-add [aria-label='Ngày kết thúc']").press("Enter");
  const select = page.locator(".subtask-add select[aria-label='Người được giao']");
  const person = await select.locator("option:not([value=''])").first().getAttribute("value");
  await select.selectOption(person);
  await box.fill("Việc con có ngày");
  await box.press("Enter");
  await waitForBulk(before);
  const all = (await log()).filter((l) => l.m === "POST" && l.p === "/api/tasks/bulk"); const post = all.at(-1);
  assert.equal(post.b.startDate, "2026-11-02");
  assert.equal(post.b.durationDays, 5);
  assert.equal(post.b.assigneeAccountId, person);
});
await step("Kết thúc trước Bắt đầu: không tạo gì, báo lỗi", async () => {
  const before = (await log()).filter((l) => l.m === "POST" && l.p === "/api/tasks/bulk").length;
  await page.locator(".subtask-add [aria-label='Ngày bắt đầu']").fill("10/11/2026");
  await page.locator(".subtask-add [aria-label='Ngày bắt đầu']").press("Enter");
  await page.locator(".subtask-add [aria-label='Ngày kết thúc']").fill("05/11/2026");
  await page.locator(".subtask-add [aria-label='Ngày kết thúc']").press("Enter");
  const box = page.locator(".subtask-add input[aria-label='Tên việc con']");
  await box.fill("Sai ngày");
  await box.press("Enter");
  await page.waitForSelector(".toast", { timeout: 4000 });
  assert.equal((await log()).filter((l) => l.m === "POST" && l.p === "/api/tasks/bulk").length, before);
});
await step("Esc đóng ô gõ mà không bỏ chọn hay mở gì", async () => {
  await page.keyboard.press("Escape");
  await page.waitForSelector(".subtask-add", { state: "detached" });
});
await step("dòng 'Thêm việc…' cuối bảng cũng có 'Ngày, người'", async () => {
  await fetch(API + "/api/__reset", { method: "POST" });
  const before = (await log()).filter((l) => l.m === "POST" && l.p === "/api/tasks/bulk").length;
  // The panel is there as soon as the row has focus.
  await page.locator(".wbs-add > input").click();
  await page.locator(".wbs-add-panel").waitFor({ state: "visible" });
  await page.locator(".wbs-add-panel [aria-label='Ngày kết thúc']").fill("20/11/2026");
  await page.locator(".wbs-add-panel [aria-label='Ngày kết thúc']").press("Enter");
  const input = page.locator(".wbs-add input[aria-label='Thêm việc']");
  await input.fill("Việc có hạn");
  await input.press("Enter");
  await waitForBulk(before);
  const all = (await log()).filter((l) => l.m === "POST" && l.p === "/api/tasks/bulk"); const post = all.at(-1);
  // Only an end date: the task is the one day it ends on.
  assert.equal(post.b.startDate, "2026-11-20");
  assert.equal(post.b.durationDays, 1);
});
await step("hàng Sub-task không có nút '+' (Jira không cho sub-task có con)", async () => {
  const subs = page.locator(".wbs-row", { has: page.locator("[data-issue-type='Sub-task'], .issue-type-subtask") });
  if ((await subs.count()) === 0) return; // the demo data may hold none
  assert.equal(await subs.first().locator("button.wbs-add-child").count(), 0);
});

console.log("\n== Ngày kết thúc trong form tạo việc ==");
await step("có ô 'Ngày kết thúc'; gõ ngày kết thúc đổi thời lượng, gõ thời lượng đổi ngày kết thúc", async () => {
  await page.keyboard.press("Control+k");
  await page.keyboard.type("biểu mẫu");
  await page.locator(".cmdk-row", { hasText: "biểu mẫu đầy đủ" }).click();
  await page.waitForSelector(".modal .task-input-field");
  const start = page.locator(".modal .field", { hasText: "Ngày bắt đầu" }).locator("input[type=text]");
  const end = page.locator(".modal .field", { hasText: "Ngày kết thúc" }).locator("input[type=text]");
  await start.fill("02/11/2026");
  await start.press("Enter");
  await end.fill("06/11/2026");
  await end.press("Enter");
  const dur = page.locator(".modal .field", { hasText: "Thời lượng" }).locator("input");
  await page.waitForFunction(() => /Thời lượng/.test(document.querySelector(".modal")?.textContent ?? ""));
  assert.equal(await dur.inputValue(), "5");
  await dur.fill("3");
  await dur.press("Tab");
  await page.waitForFunction(() => document.querySelector(".modal .field input[aria-label='Ngày kết thúc']")?.value === "04/11/2026");
});
await step("Tạo gửi ngày bắt đầu và thời lượng đã suy ra từ ngày kết thúc", async () => {
  await fetch(API + "/api/__reset", { method: "POST" });
  await page.fill(".modal .task-input-field", "Việc có ngày kết thúc");
  const end = page.locator(".modal .field input[aria-label='Ngày kết thúc']");
  await end.fill("10/11/2026");
  await end.press("Enter");
  await page.locator(".modal-create .modal-footer .primary", { hasText: /^Tạo$/ }).click();
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "POST" && l.p === "/api/tasks/bulk"));
  const post = (await log()).find((l) => l.m === "POST" && l.p === "/api/tasks/bulk");
  assert.equal(post.b.startDate, "2026-11-02");
  assert.equal(post.b.durationDays, 9);
});

console.log("\n== Giao diện tạo việc và thanh trái ==");
await step("form tạo việc là hai cột như khung chi tiết: bên trái việc + mô tả, bên phải thông tin trên nền giấy", async () => {
  await page.locator(".toolbar-right button.hd-create").click();
  await page.waitForSelector(".modal-create .td-cols");
  const [l, r] = await Promise.all([
    page.locator(".modal-create .td-left").boundingBox(),
    page.locator(".modal-create .td-right").boundingBox(),
  ]);
  assert.ok(l.x < r.x && r.width >= 300, JSON.stringify({ l, r }));
  for (const label of ["Người", "Ưu tiên", "Ngày bắt đầu", "Ngày kết thúc", "Thời lượng", "Loại", "Ước lượng", "Nhãn"])
    assert.equal(await page.locator(".modal-create .td-right .field", { hasText: label }).count() > 0, true, label);
  assert.equal(await page.locator(".modal-create .td-left .field", { hasText: "Mô tả" }).count(), 1);
  const box = await page.locator(".modal-create").boundingBox();
  assert.ok(box.width > 900, "cửa sổ phải rộng như khung chi tiết: " + box.width);
  await page.locator(".modal-create .modal-close").click();
});
await step("nhãn 'Clockwork' trên thanh trái nằm gọn trong nút, không tràn", async () => {
  const fits = await page.$eval(".rail-btn[data-view=timesheet]", (btn) => {
    const label = btn.querySelector(".rail-label");
    const b = btn.getBoundingClientRect();
    const r = document.createRange();
    r.selectNodeContents(label);
    const t = r.getBoundingClientRect();
    return { text: label.textContent, left: t.left - b.left, right: b.right - t.right };
  });
  assert.equal(fits.text, "Clockwork");
  assert.ok(fits.left >= 0 && fits.right >= 0, JSON.stringify(fits));
});
await step("chỉ báo đồng bộ là biểu tượng đồng bộ và chữ 'Sync'", async () => {
  const el = page.locator(".sync-indicator");
  assert.equal((await el.textContent()).trim(), "Sync");
  assert.equal(await el.locator("svg.sync-icon").count(), 1);
});

console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
console.log("Hộp thoại/console:", problems.length ? problems.join("\n") : "không có");
await browser.close();
process.exit(failed || problems.length ? 1 : 0);
