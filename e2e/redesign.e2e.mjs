// The redesign's new behaviour (docs/plans/2026-11-06-tai-thiet-giao-dien.md): the Hôm nay home page,
// editing a cell in place, the plan draft (no write until "Áp dụng"), violated links, DateField and
// dark mode. The client against the stand-in API.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = process.env.E2E_APP ?? "http://localhost:5173/?view=gantt";
const HOME = APP.replace(/\?view=[a-z]+/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const page = await ctx.newPage();
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
const log = async () => (await (await fetch(API + "/api/__log")).json()).log;
const reset = () => fetch(API + "/api/__reset", { method: "POST" });
const writes = async () => (await log()).filter((l) => l.m === "PATCH" || l.m === "PUT" || l.m === "POST");

await fetch(API + "/api/__restore", { method: "POST" });

console.log("\n== Hôm nay ==");
await step("lần đầu mở app là trang Hôm nay: lời chào do code dựng, các mục, dải ghi giờ", async () => {
  await page.goto(HOME);
  await page.waitForSelector(".today-view");
  assert.match(await page.textContent(".today-greeting"), /^Chào /);
  assert.equal(await page.locator("[data-view=today][aria-current=page]").count(), 1);
  assert.ok(await page.locator(".today-log-btn").isVisible());
});
await step("việc của tôi chưa có ngày nằm ở 'Chưa xếp lịch'; bấm mở khung chi tiết", async () => {
  const sec = page.locator(".today-section", { hasText: "Chưa xếp lịch" });
  await sec.locator(".today-row").first().click();
  await page.waitForSelector(".peek-panel .modal-id");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".peek-panel", { state: "detached" });
});
await step("nhớ lăng kính cuối: mở Kế hoạch rồi tải lại thì vẫn ở Kế hoạch", async () => {
  await page.keyboard.press("1");
  await page.waitForSelector(".wbs-row");
  await page.goto(HOME);
  await page.waitForSelector(".wbs-row");
});

console.log("\n== Sửa ô tại chỗ ==");
await step("bấm ô Người → chọn người → PATCH chỉ đổi người phụ trách, không mở cửa sổ", async () => {
  await reset();
  const row = page.locator(".wbs-row", { hasText: "DEMO-8" });
  await row.locator(".wbs-cell-assignee").click();
  await page.waitForSelector(".cell-picker");
  await page.keyboard.type("chi");
  await page.keyboard.press("Enter");
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "PATCH"));
  const patch = (await log()).find((l) => l.m === "PATCH");
  assert.equal(patch.p, "/api/tasks/DEMO-8");
  assert.deepEqual(Object.keys(patch.b), ["assigneeAccountId"]);
  assert.equal(await page.locator(".peek-panel").count(), 0);
  await page.waitForFunction(() => document.querySelector(".wbs-row:nth-child(n) .wbs-cell-assignee") !== null);
});
await step("Epic: ô Người không mở bộ chọn (Epic không có người phụ trách)", async () => {
  const epic = page.locator(".wbs-row", { hasText: "DEMO-1" });
  assert.equal(await epic.locator(".wbs-cell-assignee.is-editable").count(), 0);
});
await step("bấm ô Trạng thái → danh sách bước của workflow, Esc đóng không ghi gì", async () => {
  await reset();
  await page.locator(".wbs-row", { hasText: "DEMO-5" }).locator(".wbs-cell-status").click();
  await page.waitForSelector(".cell-picker-item");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".cell-picker", { state: "detached" });
  assert.equal((await log()).filter((l) => l.m === "PATCH").length, 0);
});

console.log("\n== Bản nháp kế hoạch ==");
await step("Shift D bật nháp; kéo một thanh không gửi gì lên Jira, dải nháp đếm thay đổi", async () => {
  await reset();
  await page.locator(".gantt-body").click({ position: { x: 1000, y: 700 } });
  await page.keyboard.press("Shift+D");
  await page.waitForSelector(".draft-bar");
  const target = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".wbs-row")];
    const bars = [...document.querySelectorAll("g.bar > g")];
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].textContent.includes("DEMO-5")) continue;
      const r = bars[i]?.querySelector("g[tabindex] rect")?.getBoundingClientRect();
      if (r) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  });
  assert.ok(target, "không thấy thanh DEMO-5");
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 40, target.y, { steps: 5 });
  await page.mouse.move(target.x + 90, target.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(() => /\d+\s*việc thay đổi/.test(document.querySelector(".draft-bar")?.textContent ?? "") && !/\b0\s*việc thay đổi/.test(document.querySelector(".draft-bar").textContent));
  await page.waitForTimeout(400);
  assert.equal((await writes()).length, 0, "bản nháp đã ghi lên Jira");
  assert.ok((await page.locator(".draft-ghost").count()) >= 1, "không có bóng vị trí cũ");
});
await step("'Xem thay đổi' liệt kê việc bạn dời và việc bị đẩy theo", async () => {
  await page.locator(".draft-link").click();
  const items = await page.locator(".draft-item").allTextContents();
  assert.ok(items.some((t) => t.includes("DEMO-5") && t.includes("bạn dời")), items.join(" | "));
  await page.locator(".draft-link").click();
});
await step("Áp dụng: chỉ việc bạn dời được PATCH, rồi dải nháp biến mất", async () => {
  await page.locator(".draft-bar button.primary").click();
  await page.waitForSelector(".draft-bar", { state: "detached" });
  const patches = (await log()).filter((l) => l.m === "PATCH");
  assert.deepEqual(patches.map((p) => p.p), ["/api/tasks/DEMO-5"]);
  assert.ok(patches[0].b.startDate);
});
await step("Bỏ nháp không có thay đổi thì tắt ngay, không hỏi", async () => {
  await page.keyboard.press("Shift+D");
  await page.waitForSelector(".draft-bar");
  await page.locator(".draft-bar button", { hasText: "Bỏ nháp" }).click();
  await page.waitForSelector(".draft-bar", { state: "detached" });
  assert.equal(await page.locator(".dlg").count(), 0);
});

console.log("\n== Phụ thuộc vi phạm ==");
await step("việc sau bắt đầu sớm hơn ràng buộc → mũi tên đỏ nét đứt; 'Dời theo' ghi ngày sớm nhất", async () => {
  // Link DEMO-5 → DEMO-6 (FS) and start DEMO-6 with DEMO-5, behind the client's back: a broken link.
  const t5 = (await (await fetch(API + "/api/tasks")).json()).find((t) => t.id === "DEMO-5");
  await fetch(API + "/api/tasks/DEMO-6", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ startDate: t5.startDate, predecessors: [{ taskId: "DEMO-5", type: "FS", lagDays: 0 }] }),
  });
  await page.goto(APP);
  await page.waitForSelector(".wbs-row");
  await page.waitForSelector(".dep-arrow-violated", { timeout: 6000 });
  await reset();
  await page.locator(".dep-arrow-violated .dep-arrow-hit").first().dispatchEvent("mousedown");
  await page.locator(".dep-violation button", { hasText: "Dời theo" }).click();
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "PATCH"));
  const patch = (await log()).find((l) => l.m === "PATCH");
  assert.equal(patch.p, "/api/tasks/DEMO-6");
});

console.log("\n== Ngày và giao diện ==");
await step("ngày trong khung chi tiết luôn DD/MM/YYYY và nhận 't6' / '+3n'", async () => {
  await page.goto(APP);
  await page.waitForSelector(".wbs-row");
  await page.locator(".wbs-row", { hasText: "DEMO-3" }).locator(".wbs-col-name").dblclick();
  const box = page.locator(".peek-panel .date-field input[type=text]").first();
  await box.waitFor();
  assert.match(await box.inputValue(), /^\d{2}\/\d{2}\/\d{4}$/);
  await box.fill("+3n");
  await box.press("Enter");
  assert.match(await box.inputValue(), /^\d{2}\/\d{2}\/\d{4}$/);
  await box.fill("không phải ngày");
  await box.press("Enter");
  assert.equal(await page.locator(".peek-panel .date-field.is-bad").count(), 1);
  await box.press("Escape");
  await page.locator(".peek-panel .modal-close").click();
  await page.waitForSelector(".peek-panel", { state: "detached" });
});
await step("chế độ tối: menu avatar đổi data-theme và nền trang tối đi", async () => {
  await page.locator(".rail-avatar").click();
  await page.locator(".rail-menu button", { hasText: "Tối" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const [r, g, b] = bg.match(/\d+/g).map(Number);
  assert.ok(r + g + b < 120, "nền chưa tối: " + bg);
  await page.locator(".rail-menu button", { hasText: "Sáng" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  await page.keyboard.press("Escape");
});

await fetch(API + "/api/__restore", { method: "POST" });
assert.equal(problems.length, 0, "lỗi trong trình duyệt: " + problems.join("; "));
await browser.close();
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
process.exit(failed ? 1 : 0);
