// The decluttered header and the one-row Gantt toolbar: project switcher, underline tabs,
// account menu, panels instead of rows of buttons, filter chips, and a selection bar that
// moves nothing. Behaviour of the client against the stand-in API.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { displaySwitch, ioAction, openDisplay, pickFacet } from "./toolbar.mjs";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.setDefaultTimeout(8000);
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && problems.push("console: " + m.text()));
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
const box = (selector) => page.locator(selector).first().boundingBox();

await page.goto(process.env.E2E_APP ?? "http://localhost:5173/");
await page.waitForSelector(".wbs-row");

console.log("\n== Header ==");
await step("không còn nút 'Đổi dự án' và 'Đăng xuất' rời; chỉ một nút đặc là 'Task mới'", async () => {
  const labels = await page.$$eval(".toolbar > .toolbar-right > button, .toolbar-left > button", (b) => b.map((x) => x.textContent.trim()));
  assert.ok(!labels.some((t) => t === "Đổi dự án" || t === "Đăng xuất"), labels.join("|"));
  const solid = await page.$$eval(".toolbar button.primary", (b) => b.map((x) => x.textContent.trim()));
  assert.deepEqual(solid, ["Task mới"]);
});
await step("huy hiệu dự án là menu đổi dự án; Esc đóng và trả tiêu điểm", async () => {
  const trigger = page.locator(".project-switch");
  await trigger.click();
  assert.equal(await trigger.getAttribute("aria-expanded"), "true");
  assert.ok(await page.locator("[role=menuitem]", { hasText: "Đổi dự án" }).isVisible());
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".popover-menu").count(), 0);
  assert.equal(await trigger.evaluate((el) => el === document.activeElement), true);
});
await step("'Đổi dự án…' mở bộ chọn dự án", async () => {
  await page.locator(".project-switch").click();
  await page.locator("[role=menuitem]", { hasText: "Đổi dự án" }).click();
  await page.waitForSelector(".picker-title");
  assert.equal((await page.textContent(".picker-title")).trim(), "Chọn dự án");
  await page.click(".modal-close");
  await page.waitForSelector(".wbs-row");
});
await step("tab dạng gạch chân: tab hiện tại có aria-current và gạch màu chính", async () => {
  const current = page.locator(".toolbar-tabs button[aria-current=page]");
  assert.equal((await current.textContent()).trim(), "Gantt / WBS");
  const bar = await current.evaluate((el) => getComputedStyle(el).borderBottomColor);
  assert.notEqual(bar, "rgba(0, 0, 0, 0)");
  const idle = await page.locator(".toolbar-tabs button:not(.active)").first().evaluate((el) => getComputedStyle(el).borderBottomColor);
  assert.equal(idle, "rgba(0, 0, 0, 0)");
});
await step("avatar mở menu tài khoản có 'Đăng xuất'", async () => {
  await page.locator(".hd-avatar").click();
  assert.ok(await page.locator("[role=menuitem]", { hasText: "Đăng xuất" }).isVisible());
  await page.keyboard.press("Escape");
});
await step("điều khiển header cao 36px", async () => {
  for (const sel of [".project-switch", ".toolbar button.primary", ".hd-avatar"]) {
    assert.equal(Math.round((await box(sel)).height), 36, sel);
  }
});

console.log("\n== Toolbar một hàng ==");
await step("không còn dải hướng dẫn tĩnh; có nút ? mở bảng thao tác", async () => {
  assert.equal(await page.locator(".selection-idle").count(), 0);
  assert.equal(await page.getByText("Nhấp để chọn ·").count(), 0);
  await page.locator("button[aria-label='Thao tác và phím tắt']").click();
  const help = await page.textContent(".help-menu");
  assert.ok(help.includes("chọn cả dải") && help.includes("mở chi tiết"), help);
  await page.keyboard.press("Escape");
});
await step("một hàng ở 1500px, điều khiển cao 32px, không tràn", async () => {
  const bar = await box(".gantt-toolbar");
  assert.ok(bar.height <= 49, "toolbar cao " + bar.height);
  for (const sel of [".tf-search", ".tf-add", ".seg-group", ".gantt-toolbar .tb-btn"]) {
    assert.equal(Math.round((await box(sel)).height), 32, sel);
  }
  const overflow = await page.$eval(".gantt-toolbar", (el) => el.scrollWidth - el.clientWidth);
  assert.ok(overflow <= 1, "tràn " + overflow);
  // Nothing wraps: every control's centre sits inside the bar's height.
  const outside = await page.$$eval(".gantt-toolbar button, .gantt-toolbar input", (els) => {
    const b = document.querySelector(".gantt-toolbar").getBoundingClientRect();
    return els.filter((e) => { const r = e.getBoundingClientRect(); const c = r.top + r.height / 2; return r.height > 0 && (c < b.top || c > b.bottom); }).length;
  });
  assert.equal(outside, 0);
});
await step("sáu ô lọc chi tiết gộp trong một bảng 'Bộ lọc'", async () => {
  assert.equal(await page.locator(".gantt-toolbar .tf-select:not(.sf-select)").count(), 0);
  await page.locator(".tf-add").click();
  const heads = await page.$$eval(".tf-facet-head .tf-facet-name", (b) => b.map((x) => x.textContent));
  for (const k of ["Người phụ trách", "Trạng thái", "Loại", "Epic", "Nhãn", "Ưu tiên"]) assert.ok(heads.includes(k), k + " thiếu: " + heads);
  await page.keyboard.press("Escape");
});
await step("lọc → chip có nút bỏ lọc, nhãn đầy đủ trong title; bỏ chip thì hết lọc", async () => {
  await pickFacet(page, "Trạng thái", "In Progress");
  await page.waitForSelector(".tf-chip");
  const chip = page.locator(".tf-chip", { hasText: "Trạng thái: In Progress" });
  assert.equal(await chip.count(), 1);
  assert.ok((await chip.getAttribute("title")).includes("In Progress"));
  assert.ok((await page.textContent(".tf-count")).includes("1/9"));
  await chip.locator("button[aria-label='Bỏ lọc Trạng thái']").click();
  await page.waitForFunction(() => !document.querySelector(".tf-active"));
});
await step("JQL nằm cạnh ô tìm kiếm và mở thành bảng riêng, không thêm hàng", async () => {
  const search = await box(".tf-search");
  const toggle = await box(".tf-jql-toggle");
  assert.ok(toggle.x >= search.x && toggle.x + toggle.width <= search.x + search.width + 1, "JQL không nằm trong ô tìm kiếm");
  const before = await box(".gantt-body");
  await page.locator(".tf-jql-toggle").click();
  await page.waitForSelector(".tf-jql input");
  assert.equal((await box(".gantt-body")).y, before.y, "mở JQL làm dịch biểu đồ");
  await page.keyboard.press("Escape");
});
await step("'Hiển thị' gom Đường găng, Phụ thuộc, Baseline và cột; công tắc đổi được", async () => {
  await openDisplay(page);
  for (const k of ["Đường găng", "Phụ thuộc", "Baseline"]) assert.equal(await page.locator(".view-menu .switch-row", { hasText: k }).count(), 1, k);
  assert.ok(await page.locator(".view-menu .col-chooser-item").count() >= 5);
  const sw = displaySwitch(page, "Đường găng");
  assert.equal(await sw.isChecked(), false);
  await sw.click();
  assert.equal(await sw.isChecked(), true);
  await sw.click();
  await page.keyboard.press("Escape");
});
await step("menu 'Nhập / Xuất' có đủ ba mục và duyệt được bằng phím mũi tên", async () => {
  const trigger = page.locator(".gantt-toolbar button", { hasText: "Nhập / Xuất" });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  const items = await page.$$eval(".io-menu [role=menuitem]", (b) => b.map((x) => x.textContent));
  assert.equal(items.length, 3, items.join("|"));
  assert.ok(items[0].includes("Nhập công việc") && items[1].includes("Nhập KBKT") && items[2].includes("Xuất CSV"));
  assert.equal(await page.evaluate(() => document.activeElement?.textContent.includes("Nhập công việc")), true);
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent.includes("Nhập KBKT")), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".io-menu").count(), 0);
});
await step("nút chỉ có biểu tượng đều có tên truy cập", async () => {
  const unnamed = await page.$$eval(".toolbar button, .gantt-toolbar button", (bs) =>
    bs.filter((b) => !b.textContent.trim() && !b.getAttribute("aria-label")).length
  );
  assert.equal(unnamed, 0);
});

console.log("\n== Thanh chọn ==");
await step("chọn hàng không làm dịch bảng, và không che toolbar", async () => {
  const before = await box(".gantt-body");
  await page.locator(".wbs-row", { hasText: "DEMO-5" }).click();
  await page.waitForSelector(".selection-bar");
  assert.equal((await box(".gantt-body")).y, before.y, "thanh chọn làm dịch bảng");
  const bar = await box(".selection-bar");
  const tool = await box(".gantt-toolbar");
  assert.ok(bar.y > tool.y + tool.height, "thanh chọn che toolbar");
  // The toolbar still works with a selection: its search takes typing.
  await page.fill(".tf-search input", "DEMO");
  await page.fill(".tf-search input", "");
});
await step("Esc đóng bảng đang mở mà KHÔNG xoá lựa chọn; Esc lần nữa mới bỏ chọn", async () => {
  await page.locator("button[aria-label='Thao tác và phím tắt']").click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".help-menu").count(), 0);
  assert.equal(await page.locator(".selection-bar").count(), 1, "Esc trong bảng đã xoá lựa chọn");
  await page.locator(".gantt-toolbar").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".selection-bar"));
});

console.log("\n== Chưa có ngày ==");
await step("cảnh báo 'Chưa có ngày (n)' vẫn ở hàng nhanh và mở được task", async () => {
  const pill = page.locator(".gantt-toolbar .warning-pill");
  assert.match((await pill.textContent()).trim(), /^Chưa có ngày \(\d+\)$/);
  await pill.click();
  await page.locator(".unscheduled-item").first().click();
  await page.waitForSelector(".modal .modal-id");
  await page.click(".modal-close");
});
await step("ioAction vẫn tải CSV", async () => {
  const [dl] = await Promise.all([page.waitForEvent("download"), ioAction(page, "Xuất CSV")]);
  assert.ok((await dl.suggestedFilename()).endsWith(".csv"));
});

assert.equal(problems.length, 0, "lỗi trong trình duyệt: " + problems.join("; "));
await browser.close();
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
process.exit(failed ? 1 : 0);
