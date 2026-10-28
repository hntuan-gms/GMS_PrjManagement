// Phase 2 · stage 3 in a real browser, against the stand-in API: the resource tab (skills matrix, edited
// leave, month columns, period buttons), the timesheet's edit, the board (quick filters, card options,
// sub-tasks, flag, Epic/Version panel, bulk actions, capacity, delete sprint) and the report page (daily
// trend, Agile charts). What reaches Jira for real is on the manual checklist (section E).
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
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
const tab = (name) => page.locator(".toolbar-tabs button", { hasText: name }).click();
const log = async () => (await (await fetch(API + "/api/__log")).json()).log;
const reset = () => fetch(API + "/api/__reset", { method: "POST" });
/** Polls the stand-in API's request log until `pred` finds a request. */
async function waitLog(pred) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    const hit = (await log()).find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("request never reached the API");
}
const isoIn = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

await fetch(API + "/api/__restore", { method: "POST" });
await page.goto(process.env.E2E_APP ?? "http://localhost:5173/");
await page.waitForSelector(".wbs-row");

console.log("\n== Nguồn lực: kỹ năng, nghỉ phép, kỳ ==");
await step("ma trận kỹ năng: thêm cột, bấm ô → lưu vào hồ sơ người đó", async () => {
  await tab("Nguồn lực");
  await page.waitForSelector(".resource-view .rv-modes");
  await page.locator(".rv-modes button", { hasText: "Kỹ năng" }).click();
  await page.waitForSelector(".sm-view");
  await page.locator(".sm-add input").fill("React");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sm-table");
  await reset();
  await page.locator(".sm-cell").first().click();
  const put = await waitLog((l) => l.m === "PUT" && l.p.startsWith("/api/resources/"));
  assert.deepEqual(put.b.skills, ["React"]);
  await page.waitForSelector(".sm-cell.is-on");
});
await step("gõ 'react' ở ô tìm chỉ còn người có kỹ năng đó", async () => {
  await page.locator(".sm-toolbar .rv-search").fill("REACT");
  assert.equal(await page.locator(".sm-table tbody tr").count(), 1);
  await page.locator(".sm-toolbar .rv-search").fill("");
});
await step("sửa kỳ nghỉ: thêm rồi đổi ngày kết thúc (PATCH, không xoá-tạo lại)", async () => {
  await page.locator(".rv-modes button", { hasText: "Mức tải" }).click();
  await page.waitForSelector(".rv-row-person");
  // By name, not "the first row": a person with new leave on a day they have work moves up the list.
  const who = (await page.locator(".rv-row-person .rv-person-text b").first().textContent()).trim();
  const openProfile = () => page.locator(".rv-row-person", { hasText: who }).locator(".rv-profile-btn").click();
  await openProfile();
  await page.waitForSelector(".rv-drawer");
  const from = isoIn(3);
  const to = isoIn(4);
  const later = isoIn(6);
  await page.locator(".rv-drawer input[type=date]").nth(0).fill(from);
  await page.locator(".rv-drawer input[type=date]").nth(1).fill(to);
  await page.locator(".rv-drawer-foot button.primary", { hasText: "Lưu thay đổi" }).click();
  await page.waitForSelector(".rv-drawer", { state: "detached" });
  await openProfile();
  await page.waitForSelector(".rv-abs-chip");
  await reset();
  await page.locator(".rv-abs-chip button[aria-label='Sửa kỳ nghỉ']").click();
  assert.equal(await page.locator(".rv-drawer input[type=date]").nth(1).inputValue(), to);
  await page.locator(".rv-drawer input[type=date]").nth(1).fill(later);
  await page.locator(".rv-drawer-foot button.primary", { hasText: "Lưu thay đổi" }).click();
  const patch = await waitLog((l) => l.m === "PATCH" && l.p.startsWith("/api/resources/absences/"));
  assert.equal(patch.b.to, later);
  await page.waitForSelector(".rv-drawer", { state: "detached" });
  await openProfile();
  assert.equal(await page.locator(".rv-abs-chip").count(), 1, "vẫn một kỳ nghỉ, không nhân đôi");
});
await step("kỹ năng + ghi chú lưu cùng một nút 'Lưu thay đổi'", async () => {
  await page.locator(".skills-input input").fill("SQL");
  await page.keyboard.press("Enter");
  await page.locator(".rv-notes-field textarea").fill("chỉ làm buổi sáng");
  await reset();
  await page.locator(".rv-drawer-foot button.primary", { hasText: "Lưu thay đổi" }).click();
  const put = await waitLog((l) => l.m === "PUT" && l.p.startsWith("/api/resources/"));
  assert.ok(put.b.skills.includes("SQL"), JSON.stringify(put.b));
  assert.equal(put.b.notes, "chỉ làm buổi sáng");
});
await step("nút kỳ trước/sau dời cả khoảng; 'Tháng này' (trong menu Khoảng) + cột theo tháng", async () => {
  const from0 = await page.locator(".rv-range input[type=date]").nth(0).inputValue();
  await page.locator(".rv-step[aria-label='Kỳ sau']").click();
  const from1 = await page.locator(".rv-range input[type=date]").nth(0).inputValue();
  assert.ok(from1 > from0, `${from0} → ${from1}`);
  await page.locator(".rv-preset").click();
  await page.locator("[role=menuitemradio]", { hasText: "Tháng này" }).click();
  assert.ok((await page.locator(".rv-range input[type=date]").nth(0).inputValue()).endsWith("-01"));
  assert.ok((await page.locator(".rv-preset").textContent()).includes("Tháng này"), "nhãn nút phải theo khoảng đang chọn");
  await page.locator(".rv-granularity").selectOption("month");
  await page.waitForSelector(".rv-grid-week");
  assert.ok((await page.locator(".rv-head-cell").first().textContent()).startsWith("Thg"));
  await page.locator(".rv-granularity").selectOption("auto");
});

console.log("\n== Chấm công: sửa giờ ==");
await step("sửa giờ của mình: chỉ gửi phần đã đổi", async () => {
  await tab("Chấm công");
  await page.waitForSelector(".ts-grid");
  await page.locator(".ts-person-filter").selectOption("me");
  await page.locator(".ts-person-btn").first().click();
  await page.waitForSelector(".ts-entries li");
  await reset();
  await page.locator(".ts-entry-edit").first().click();
  assert.ok((await page.textContent(".modal-id")).includes("Sửa giờ đã ghi"));
  assert.equal(await page.locator(".modal select").first().isDisabled(), true, "không đổi được việc khi sửa");
  await page.locator(".modal input").nth(1).fill("5");
  await page.locator(".modal-footer .primary", { hasText: "Lưu thay đổi" }).click();
  const put = await waitLog((l) => l.m === "PUT" && l.p.startsWith("/api/timesheet/worklogs/"));
  assert.equal(put.b.hours, 5);
  assert.equal("date" in put.b, false, "cùng ngày thì không gửi ngày");
});

console.log("\n== Bảng: thẻ, lọc, sub-task, cờ ==");
await step("bộ lọc nhanh của board hiện thành nút; bật 'Chỉ lỗi' hỏi Jira rồi lọc", async () => {
  await tab("Bảng");
  await page.waitForSelector(".bd-card");
  const before = await page.locator(".bd-card").count();
  assert.equal(await page.locator(".bd-quick-filter").count(), 2);
  await page.locator(".bd-quick-filter", { hasText: "Chỉ lỗi" }).click();
  await page.waitForFunction((n) => document.querySelectorAll(".bd-card").length < n, before);
  await page.locator(".bd-quick-filter", { hasText: "Chỉ lỗi" }).click();
  await page.waitForFunction((n) => document.querySelectorAll(".bd-card").length === n, before);
});
await step("thẻ cha liệt kê sub-task: 1/2, bấm mở danh sách", async () => {
  const toggle = page.locator(".bd-subtasks-toggle").first();
  assert.ok((await toggle.textContent()).includes("1/2 sub-task"));
  await toggle.click();
  assert.equal(await page.locator(".bd-subtasks-list li").count(), 2);
});
await step("'Gộp sub-task vào thẻ cha' ẩn thẻ riêng của sub-task", async () => {
  const before = await page.locator(".bd-card").count();
  await page.locator(".bd-cardbtn").click();
  await page.locator(".bd-card-opt", { hasText: "Gộp sub-task" }).locator("input").check();
  await page.keyboard.press("Escape");
  await page.waitForFunction((n) => document.querySelectorAll(".bd-card").length === n - 2, before);
});
await step("chọn trường hiện trên thẻ + màu thẻ theo ưu tiên", async () => {
  await page.locator(".bd-cardbtn").click();
  await page.locator(".bd-card-opt", { hasText: /^\s*Độ ưu tiên\s*$/ }).locator("input").uncheck();
  await page.locator(".bd-card-opt", { hasText: /Theo độ ưu tiên/ }).locator("input").check();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".bd-card .bd-prio").count(), 0, "đã tắt hiện ưu tiên");
  assert.ok((await page.locator(".bd-card.has-accent").count()) > 0, "thẻ phải có viền màu");
  // Remembered per board: a reload keeps it.
  await page.reload();
  await tab("Bảng");
  await page.waitForSelector(".bd-card");
  assert.ok((await page.locator(".bd-card.has-accent").count()) > 0);
});
await step("gắn cờ một thẻ → PUT /board/issues/:key/flag", async () => {
  await reset();
  const card = page.locator(".bd-card").first();
  await card.hover();
  await card.locator(".bd-card-flag").click();
  const put = await waitLog((l) => l.m === "PUT" && l.p.endsWith("/flag"));
  assert.equal(put.b.flagged, true);
});

console.log("\n== Backlog: panel, hàng loạt, năng lực, xoá sprint ==");
await step("panel Epic: bấm một Epic lọc backlog; bấm lại bỏ lọc", async () => {
  await page.locator(".bd-seg button", { hasText: "Backlog" }).click();
  await page.waitForSelector(".bl-panel .bl-panel-row");
  const rows = await page.locator(".bl-row").count();
  await page.locator(".bl-panel-row").first().click();
  await page.waitForFunction((n) => document.querySelectorAll(".bl-row").length < n, rows);
  await page.locator(".bl-panel-row.is-on").click();
  await page.waitForFunction((n) => document.querySelectorAll(".bl-row").length === n, rows);
});
await step("panel Phiên bản: bấm 1.0 chỉ còn việc của bản đó", async () => {
  const rows = await page.locator(".bl-row").count();
  await page.locator(".bl-panel-tabs button", { hasText: "Phiên bản" }).click();
  await page.locator(".bl-panel-row", { hasText: "1.0" }).click();
  await page.waitForFunction((n) => document.querySelectorAll(".bl-row").length < n, rows);
  assert.ok((await page.locator(".tf-chip").count()) >= 1, "có chip lọc để bỏ");
  await page.locator(".tf-clear").click();
});
await step("chọn nhiều việc rồi gán cho một người (từng việc một)", async () => {
  await page.locator(".bl-row").nth(0).click();
  await page.locator(".bl-row").nth(1).click({ modifiers: ["Control"] });
  await page.waitForSelector(".bl-selection");
  await reset();
  await page.locator(".bl-bulk-assign").selectOption({ label: "Lê Chi" });
  const end = Date.now() + 8000;
  let patches = [];
  while (Date.now() < end && patches.length < 2) {
    patches = (await log()).filter((l) => l.m === "PATCH" && l.p.startsWith("/api/tasks/"));
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.equal(patches.length, 2);
  assert.ok(patches.every((p) => p.b.assigneeAccountId === "chi"));
});
await step("'Năng lực' của sprint: bảng từng người, người nghỉ cả sprint được đánh dấu", async () => {
  await page.locator(".bl-action", { hasText: "Năng lực" }).first().click();
  await page.waitForSelector(".cap-table");
  assert.ok((await page.locator(".cap-table tbody tr").count()) >= 4);
  assert.ok((await page.textContent(".cap-table")).includes("80h"));
});
await step("xoá sprint chưa chạy: hỏi trong app rồi DELETE", async () => {
  await reset();
  await page.locator(".bl-section", { hasText: "Sprint 8" }).locator("button[aria-label='Xoá sprint']").click();
  await page.waitForSelector(".dlg");
  await page.locator(".dlg button.danger-solid").click();
  await waitLog((l) => l.m === "DELETE" && l.p === "/api/board/sprints/8");
});

console.log("\n== Báo cáo: xu hướng theo ngày, Agile ==");
await step("xu hướng theo ngày vẽ được từ số đo đã lưu, không cần báo cáo AI", async () => {
  await tab("Báo cáo");
  await page.waitForSelector(".progress-view .pr-trend");
  assert.ok((await page.textContent(".progress-view")).includes("Xu hướng theo ngày"));
  assert.ok((await page.locator(".pr-trend svg").first().getAttribute("aria-label")).includes("3 ngày"));
});
await step("có nút In / Lưu PDF (không có 'So sánh' khi chưa đủ 2 báo cáo AI)", async () => {
  assert.ok(await page.locator(".pr-header-tools button", { hasText: "In / Lưu PDF" }).count());
  assert.equal(await page.locator(".pr-header-tools button", { hasText: "So sánh" }).count(), 0);
});
await step("Agile → Vận tốc: 3 cột + đường trung bình", async () => {
  await page.locator(".ag-head").click();
  await page.waitForSelector(".ag-bar");
  assert.equal(await page.locator(".ag-bar").count(), 3);
  assert.equal(await page.locator(".ag-avg-line").count(), 1);
});
await step("Agile → Sprint & burnup: cam kết/thêm/xong và đường burnup", async () => {
  await page.locator(".ag-tabs button", { hasText: "Sprint & burnup" }).click();
  await page.waitForSelector(".ag-tile");
  assert.equal(await page.locator(".ag-tile").count(), 4);
  assert.ok(await page.locator(".ag-scope-line").count());
});
await step("Agile → Luồng công việc: 3 dải theo trạng thái", async () => {
  await page.locator(".ag-tabs button", { hasText: "Luồng công việc" }).click();
  await page.waitForSelector("path.ag-band");
  assert.equal(await page.locator("path.ag-band").count(), 3);
});
await step("Agile → Thời gian xử lý: cycle 2 chấm, lead 3 chấm", async () => {
  await page.locator(".ag-tabs button", { hasText: "Thời gian xử lý" }).click();
  await page.waitForSelector(".ag-dot");
  assert.equal(await page.locator(".ag-dot").count(), 2);
  await page.locator("button", { hasText: "Lead time" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".ag-dot").length === 3);
});
await step("Agile → Tạo và xong: cột tạo và cột xong", async () => {
  await page.locator(".ag-tabs button", { hasText: "Tạo và xong" }).click();
  await page.waitForSelector(".ag-created");
  assert.equal(await page.locator(".ag-created").count(), 3);
  assert.equal(await page.locator(".ag-resolved").count(), 3);
});

await step("không có lỗi JS/console trong suốt phiên", async () => {
  assert.deepEqual(problems.filter((p) => !/favicon|Failed to load resource/.test(p)), []);
});

await fetch(API + "/api/__restore", { method: "POST" });
await browser.close();
console.log(failed ? `\n${failed} bước hỏng` : "\nTất cả đạt");
process.exit(failed ? 1 : 0);
