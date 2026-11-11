// Giờ đã ghi, làm lại (Nhân lực › Giờ đã ghi): "Của tôi" là lưới việc × ngày gõ thẳng vào ô, "Cả nhóm" là bảng đọc.
// Jira chỉ cho ghi giờ dưới tên người đăng nhập, nên chỉ lưới "Của tôi" có ô nhập.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { openTimesheet } from "./toolbar.mjs";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = process.env.E2E_APP ?? "http://localhost:5173/?view=gantt";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.setDefaultTimeout(8000);
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("dialog", async (d) => {
  problems.push("hộp thoại của trình duyệt: " + d.message());
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
const log = async () => (await (await fetch(API + "/api/__log")).json()).log.filter((l) => l.p.startsWith("/api/timesheet/worklogs"));
const waitLog = async (pred) => {
  for (let i = 0; i < 40; i++) {
    const hit = (await log()).find(pred);
    if (hit) return hit;
    await page.waitForTimeout(100);
  }
  throw new Error("không thấy yêu cầu mong đợi: " + JSON.stringify(await log()));
};
const reset = () => fetch(API + "/api/__reset", { method: "POST" });
const failWrites = (on) => fetch(API + "/api/__worklogs/fail", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on }) });
const cell = (key, i) => page.locator(`.ts-mine input[data-key='${key}']`).nth(i);
const keysInOrder = () => page.locator(".ts-mine .ts-row .ts-key").allTextContents();
const active = (prop) => page.evaluate((p) => document.activeElement?.dataset?.[p], prop);

await fetch(API + "/api/__restore", { method: "POST" });
await reset();
await page.goto(APP);
await page.waitForSelector(".wbs-row");
await openTimesheet(page);

console.log("\n== Của tôi ==");
await step("mở ra là lưới của mình: việc đã ghi trước, việc của mình chưa ghi là dòng gợi ý", async () => {
  await page.waitForSelector(".ts-mine");
  assert.equal(await page.locator("[data-scope=mine][aria-selected=true]").count(), 1);
  const keys = await keysInOrder();
  assert.equal(keys[0], "DEMO-3", "việc đã ghi đứng đầu");
  assert.ok(keys.includes("DEMO-9"), "việc đang mở của mình có dòng gợi ý");
  assert.ok((await page.locator(".ts-row.is-suggested .ts-hint").count()) > 0);
});
await step("tuần hiện đủ 7 cột, hôm nay có vạch son, tổng ngày ở chân bảng", async () => {
  assert.equal(await page.locator(".ts-mine thead th.ts-day").count(), 7);
  assert.equal(await page.locator(".ts-mine thead th.is-today").count(), 1);
  assert.equal(await page.locator(".ts-mine tfoot .ts-foot").count(), 7);
});
await step("gõ 2h30 vào dòng gợi ý rồi Enter: ghi 2,5h đúng ngày, dòng không nhảy chỗ", async () => {
  const before = await keysInOrder();
  await cell("DEMO-9", 0).fill("2h30");
  await cell("DEMO-9", 0).press("Enter");
  const posted = await waitLog((l) => l.m === "POST");
  assert.equal(posted.b.issueKey, "DEMO-9");
  assert.equal(posted.b.hours, 2.5);
  assert.match(posted.b.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(await cell("DEMO-9", 0).inputValue(), "2,5");
  assert.deepEqual(await keysInOrder(), before, "dòng vừa có giờ đầu tiên không được đổi chỗ");
});
await step("Enter chuyển xuống ô dòng dưới, mũi tên đi lại như bảng tính", async () => {
  await cell("DEMO-3", 1).focus();
  await page.keyboard.press("Enter");
  assert.equal((await active("key")) + "|" + (await active("c")), "DEMO-9|1");
  await page.keyboard.press("ArrowUp");
  assert.equal(await active("key"), "DEMO-3");
  await page.keyboard.press("ArrowRight");
  assert.equal(await active("c"), "2");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await active("c"), "1");
});
await step("chữ không phải giờ: ô đỏ, có một câu giải thích, không ghi gì", async () => {
  await reset();
  await cell("DEMO-3", 1).fill("abc");
  await cell("DEMO-3", 1).press("Tab");
  await page.waitForSelector(".ts-in.is-bad");
  await page.waitForSelector(".toast-error", { timeout: 2000 });
  await page.waitForTimeout(250);
  assert.equal((await log()).length, 0);
  await cell("DEMO-3", 1).fill("");
  await cell("DEMO-3", 1).press("Tab");
  assert.equal(await page.locator(".ts-in.is-bad").count(), 0);
});
await step("Esc khi đang gõ trả giá trị cũ và không ghi gì", async () => {
  await reset();
  // An empty cell, found rather than assumed: the demo worklogs follow today's weekday, so a fixed column
  // is empty on some days and holds hours on others.
  const cells = page.locator(".ts-mine input[data-key='DEMO-3']");
  const empty = await cells.evaluateAll((els) => els.findIndex((e) => e.value === "" && !e.disabled));
  assert.ok(empty >= 0, "không có ô trống để thử");
  await cells.nth(empty).fill("7");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  assert.equal(await cells.nth(empty).inputValue(), "");
  assert.equal((await log()).length, 0);
});
await step("sửa ô đã có giờ: chỉ PUT số giờ, số mới hiện ngay, tổng của dòng đổi theo", async () => {
  await reset();
  const cells = page.locator(".ts-mine input[data-key='DEMO-3']");
  const idx = await cells.evaluateAll((els) => els.findIndex((e) => e.value === "4"));
  assert.ok(idx >= 0);
  await cells.nth(idx).fill("6");
  await cells.nth(idx).press("Tab");
  const put = await waitLog((l) => l.m === "PUT");
  assert.equal(put.b.hours, 6);
  assert.equal("date" in put.b, false);
  assert.equal(await cells.nth(idx).inputValue(), "6");
  assert.match(await page.locator(".ts-mine .ts-row", { hasText: "DEMO-3" }).locator(".ts-total").textContent(), /6/);
});
await step("vượt công suất: ô và tổng ngày báo ▲, số liệu đầu trang đếm", async () => {
  await cell("DEMO-3", 3).fill("9");
  await cell("DEMO-3", 3).press("Tab");
  await page.waitForSelector(".ts-mine td.ts-cell.is-over");
  assert.ok((await page.locator(".ts-mine tfoot .ts-foot.st-over").textContent()).includes("▲"));
  await page.waitForFunction(() => document.querySelector(".ts-tiles")?.textContent.includes("ngày vượt công suất"));
});
await step("xoá ô: DELETE, không hộp thoại, 'Hoàn tác' ghi lại đúng giờ cũ", async () => {
  await reset();
  await cell("DEMO-3", 3).fill("");
  await cell("DEMO-3", 3).press("Tab");
  await waitLog((l) => l.m === "DELETE");
  await page.locator(".toast-action", { hasText: "Hoàn tác" }).click();
  const back = await waitLog((l) => l.m === "POST");
  assert.equal(back.b.hours, 9);
});
await step("hai lần ghi trong một ô: hiện tổng kèm ×2, bấm mở danh sách, sửa ghi chú và xoá được", async () => {
  await reset();
  const cells = page.locator(".ts-mine input[data-key='DEMO-3']");
  const idx = await cells.evaluateAll((els) => els.findIndex((e) => e.value === "6"));
  assert.ok(idx >= 0, "không thấy ô 6h");
  const td = page.locator(".ts-mine .ts-row", { hasText: "DEMO-3" }).locator("td.ts-cell").nth(idx);
  await td.hover();
  await td.locator(".ts-more").click();
  await page.waitForSelector(".ts-list");
  await page.locator(".ts-list .ts-list-new .ts-list-hours").fill("1,5");
  await page.locator(".ts-list .ts-list-new .ts-list-note").fill("họp thêm");
  await page.locator(".ts-list-add").click();
  const post = await waitLog((l) => l.m === "POST");
  assert.equal(post.b.hours, 1.5);
  assert.equal(post.b.comment, "họp thêm");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".ts-list", { state: "detached" });
  const multi = td.locator("button.ts-multi");
  assert.match(await multi.textContent(), /7,5.*×2/);
  await multi.click();
  await page.waitForSelector(".ts-list");
  const note = page.locator(".ts-list-rows li").first().locator(".ts-list-note");
  await note.fill("ghi chú mới");
  await note.press("Enter");
  await waitLog((l) => l.m === "PUT" && l.b.comment === "ghi chú mới");
  await page.locator(".ts-list-del").last().click();
  await waitLog((l) => l.m === "DELETE");
  await page.keyboard.press("Escape");
});
await step("Jira từ chối: số vừa gõ trở về như cũ và có lời báo lỗi", async () => {
  await reset();
  await failWrites(true);
  await cell("DEMO-9", 4).fill("3");
  await cell("DEMO-9", 4).press("Tab");
  await page.locator(".toast-error", { hasText: "Không ghi được 3h cho DEMO-9" }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll(".ts-mine input[data-key='DEMO-9']")][4]?.value === "");
  await failWrites(false);
});
await step("'+ Thêm việc' chọn một việc: thành dòng mới, con trỏ vào ô hôm nay", async () => {
  await reset();
  await page.locator("button.ts-add").click();
  await page.waitForSelector(".cell-picker-item");
  await page.locator(".cell-picker input").fill("DEMO-4");
  await page.locator(".cell-picker-item").first().click();
  await page.waitForSelector(".ts-row.is-added");
  assert.equal(await active("key"), "DEMO-4");
  await page.keyboard.type("1");
  await page.keyboard.press("Tab");
  const post = await waitLog((l) => l.m === "POST");
  assert.equal(post.b.issueKey, "DEMO-4");
  assert.equal(post.b.hours, 1);
});
await step("dòng chưa có giờ bỏ được bằng ×", async () => {
  const before = await page.locator(".ts-mine .ts-row").count();
  await page.locator("button.ts-add").click();
  await page.locator(".cell-picker input").fill("DEMO-5");
  await page.locator(".cell-picker-item").first().click();
  await page.waitForSelector(".ts-row.is-added:has(.ts-dismiss)");
  await page.locator(".ts-row.is-added .ts-dismiss").first().click();
  assert.equal(await page.locator(".ts-mine .ts-row").count(), before);
});
await step("tháng: đủ cột ngày, vẫn gõ được", async () => {
  await page.locator(".ts-toolbar button", { hasText: /^Tháng$/ }).click();
  await page.waitForFunction(() => document.querySelectorAll(".ts-mine thead th.ts-day").length >= 28);
  assert.ok((await page.locator(".ts-mine input.ts-in").count()) >= 28);
  await page.locator(".ts-toolbar button", { hasText: /^Tuần$/ }).click();
  await page.waitForFunction(() => document.querySelectorAll(".ts-mine thead th.ts-day").length === 7);
});

console.log("\n== Cả nhóm ==");
await step("'Cả nhóm': bạn đứng đầu, chỉ ô của bạn bấm được, không có ô nhập", async () => {
  await page.locator("[data-scope=team]").click();
  await page.waitForSelector(".ts-team");
  assert.ok((await page.locator(".ts-prow").first().getAttribute("class")).includes("is-me"));
  assert.equal(await page.locator(".ts-prow:not(.is-me) .ts-cell-btn").count(), 0, "ô của người khác không có nút sửa");
  assert.equal(await page.locator(".ts-team input.ts-in").count(), 0, "bảng nhóm không có ô nhập");
});
await step("cuối mỗi dòng nói thiếu bao nhiêu ngày, không còn dấu chấm ở từng ô", async () => {
  assert.ok((await page.locator(".ts-owes").count()) > 0);
  assert.equal(await page.locator(".ts-gap").count(), 0);
});
await step("lọc 'Còn thiếu', tìm theo tên không dấu", async () => {
  await page.locator(".ts-tile-missing").click();
  const n = await page.locator(".ts-prow").count();
  assert.ok(n > 0 && n <= 4);
  await page.locator(".ts-tile-missing").click();
  assert.equal(await page.locator(".ts-prow").count(), 4, "bấm lần nữa thì xem tất cả");
  await page.fill("input[aria-label='Tìm thành viên']", "tran binh");
  await page.waitForFunction(() => document.querySelectorAll(".ts-prow").length === 1);
  await page.fill("input[aria-label='Tìm thành viên']", "");
});
await step("bấm tên một người: mở ra các việc họ đã ghi, bấm lại thì gập", async () => {
  const anh = page.locator(".ts-prow", { hasText: "Nguyễn Anh" });
  await anh.locator(".ts-person-btn").click();
  await page.waitForSelector(".ts-trow");
  assert.ok((await page.locator(".ts-trow").first().textContent()).includes("DEMO-4"));
  await anh.locator(".ts-person-btn").click();
  assert.equal(await page.locator(".ts-trow").count(), 0);
});
await step("bấm ô của chính mình: về 'Của tôi' và con trỏ vào đúng ngày đó", async () => {
  const btn = page.locator(".ts-prow.is-me .ts-cell-btn").nth(2);
  const aria = await btn.getAttribute("aria-label");
  const dm = aria.match(/(\d\d\/\d\d)/)[1];
  await btn.click();
  await page.waitForSelector(".ts-mine");
  await page.waitForFunction(() => document.activeElement?.matches?.(".ts-mine [data-date]"));
  const date = await active("date");
  assert.equal(date.slice(8, 10) + "/" + date.slice(5, 7), dm);
});
await step("phạm vi đã chọn được nhớ qua lần tải lại", async () => {
  await page.locator("[data-scope=team]").click();
  await page.reload();
  // The address says ?view=timesheet, so the reload lands on Clockwork itself.
  await page.waitForSelector(".app-rail");
  await page.waitForSelector(".ts-team");
  await page.locator("[data-scope=mine]").click();
});

assert.deepEqual(problems, [], problems.join("\n"));
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
await browser.close();
process.exit(failed ? 1 : 0);
