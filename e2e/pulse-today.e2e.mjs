// Hôm nay and Nhịp dự án (plan H2, H3, H6): what each page says is built by code from the tasks the workspace
// already holds. Hôm nay: counts, adding a task for today from the page itself, the circle that moves a task
// to its workflow's done step (the detail window opens when that move needs a box filled), the "Ghi giờ" side sheet. Nhịp dự án: one sentence, at most
// three decision rows with the action at the end, no health badge, "Vì sao?" for the reasons.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = process.env.E2E_APP ?? "http://localhost:5173/?view=gantt";
const HOME = APP.replace(/\?view=[a-z]+/, "");
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
    console.log("  FAIL", name, "\n       ", String(e.message).split("\n").slice(0, 3).join(" | "));
  }
}
const log = async () => (await (await fetch(API + "/api/__log")).json()).log;
const reset = () => fetch(API + "/api/__reset", { method: "POST" });

await fetch(API + "/api/__restore", { method: "POST" });

console.log("\n== Hôm nay ==");
await step("đầu trang: lời chào, ngày, số đếm; không có số 0 hiện ra", async () => {
  await page.goto(HOME);
  await page.waitForSelector(".today-view");
  assert.match(await page.textContent(".today-greeting"), /^Chào /);
  assert.ok((await page.textContent(".today-date")).trim().length > 0);
  const counts = await page.locator(".today-counts").innerText();
  assert.ok(!/(^|\s)0\s/.test(counts), "đang hiện số đếm bằng 0: " + counts);
});

let addedKey = "";
await step("'Thêm việc cho hôm nay…' tạo một việc của tôi, bắt đầu hôm nay, và nó hiện ở mục Hôm nay", async () => {
  await reset();
  const before = await page.locator(".today-row").count();
  const box = page.locator(".today-add input");
  await box.fill("Việc thử pulse");
  await box.press("Enter");
  await page.waitForFunction((n) => document.querySelectorAll(".today-row").length > n, before);
  const row = page.locator(".today-row", { hasText: "Việc thử pulse" });
  await row.waitFor();
  addedKey = (await row.locator(".today-key").textContent()).trim();
  const writes = (await log()).filter((l) => l.m === "POST");
  assert.ok(writes.length >= 1, "không có ghi nào lên API");
  assert.ok(await page.locator(".today-section", { hasText: "Hôm nay" }).locator(".today-row", { hasText: addedKey }).count());
});

// The stand-in's workflow has no done step that needs nothing: "Done" has a screen asking for RootCause and
// "Reject" a validator asking for a reason. Either way the circle must not leave the row half-done and must
// not end on a bare error: the detail window opens and asks for the missing box.
await step("vòng tròn cuối dòng: bước xong cần ô nhập thì mở khung chi tiết để nhập, dòng không bị đánh dấu xong", async () => {
  await reset();
  const row = page.locator(".today-row", { hasText: addedKey });
  await row.locator(".today-check").click();
  await page.waitForSelector(".peek-panel .modal-id");
  assert.match(await page.textContent(".peek-panel .modal-id"), new RegExp(addedKey));
  assert.equal(await page.locator(".today-row.is-done").count(), 0);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".peek-panel", { state: "detached" });
});

await step("'Ghi giờ' mở tờ bên; Esc đóng tờ, không đóng trang", async () => {
  await page.locator(".today-log-btn").click();
  await page.locator(".side-sheet").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".side-sheet").waitFor({ state: "detached" });
  assert.ok(await page.locator(".today-view").isVisible());
});

await step("Hôm nay không có lăng kính; bấm Dự án khi tờ Ghi giờ đang mở: tờ đóng, dự án mở", async () => {
  assert.equal(await page.locator(".lens-tabs").count(), 0);
  await page.locator(".today-log-btn").click();
  await page.locator(".side-sheet").waitFor();
  await page.locator(".rail-btn[data-view=plan]").click();
  await page.locator(".side-sheet").waitFor({ state: "detached" });
  await page.waitForSelector(".lens-tabs");
  assert.equal(await page.locator(".today-view").count(), 0);
});

console.log("\n== Nhịp dự án ==");
await step("một câu do code dựng; không có huy hiệu sức khoẻ riêng", async () => {
  await page.locator(".toolbar-tabs button", { hasText: "Nhịp dự án" }).click();
  await page.waitForSelector(".pulse-lead");
  assert.ok((await page.textContent(".pulse-lead")).trim().length > 10);
  assert.equal(await page.locator(".pr-header .pr-health, .pr-header .health-badge, .pr-header [class*=badge]").count(), 0);
});

await step("tối đa ba dòng 'Cần bạn quyết', mỗi dòng có hành động ở cuối", async () => {
  const rows = page.locator(".pulse-row");
  const n = await rows.count();
  assert.ok(n <= 3, `có ${n} dòng`);
  for (let i = 0; i < n; i++) {
    const last = rows.nth(i).locator(".pulse-actions button").last();
    assert.ok((await last.textContent()).trim().length > 0);
  }
});

await step("'Vì sao?' mở rồi ẩn lý do, đổi nhãn theo trạng thái", async () => {
  const btn = page.locator(".np-why", { hasText: /^Vì sao\?$/ });
  await btn.click();
  const hide = page.locator(".np-why", { hasText: "Ẩn lý do" });
  await hide.waitFor();
  assert.equal(await hide.getAttribute("aria-expanded"), "true");
  assert.ok((await page.locator(".pulse-reasons li").count()) > 0);
  await hide.click();
  await page.locator(".np-why", { hasText: /^Vì sao\?$/ }).waitFor();
});

await step("một con số không bị nói hai lần: % chỉ ở thanh, không thập phân, không còn thẻ Tiến độ/Thời hạn", async () => {
  const lead = await page.textContent(".pulse-lead");
  assert.doesNotMatch(lead, /%/, "câu nhận định không lặp lại %");
  const text = await page.textContent(".np-summary");
  assert.doesNotMatch(text, /\d+\.\d+%/, "không còn % có phần thập phân");
  assert.equal(await page.locator(".pr-card-hero, .pr-card-schedule, .pr-quality").count(), 0);
});

await step("dòng quá hạn có 'Dời hạn' và 'Giao lại'; dời hạn gửi đúng một PATCH", async () => {
  const row = page.locator(".pulse-row", { hasText: "trễ" }).first();
  await row.waitFor();
  assert.ok(await row.locator("button", { hasText: "Giao lại" }).count());
  await row.locator("button", { hasText: "Dời hạn" }).click();
  await page.locator(".np-resched-quick button", { hasText: "+1 tuần" }).click();
  await page.locator(".np-resched-body button[type=submit]").click();
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "PATCH" && "durationDays" in (l.b ?? {})));
  const patch = (await (await fetch(API + "/api/__log")).json()).log.filter((l) => l.m === "PATCH").at(-1);
  assert.deepEqual(Object.keys(patch.b).sort(), ["durationDays", "startDate"]);
  await fetch(API + "/api/__restore", { method: "POST" });
});

await step("không có lỗi trình duyệt hay hộp thoại gốc", async () => {
  assert.deepEqual(problems, []);
});

await fetch(API + "/api/__restore", { method: "POST" });
await browser.close();
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
process.exit(failed ? 1 : 0);
