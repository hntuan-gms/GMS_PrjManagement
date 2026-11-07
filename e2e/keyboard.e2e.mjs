// L2, L3, L5: every key the "?" sheet promises works on the plan, and Ctrl Z right after a drag undoes it
// even though the bar just dragged still has focus.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
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
const task = async (id) => (await (await fetch(API + "/api/tasks")).json()).find((t) => t.id === id);
const row = (id) => page.locator(".wbs-row", { hasText: id }).first();
const select = (id) => row(id).locator(".wbs-col-name").click();
const picker = ".cp-list, .cell-picker, [role=listbox]";

async function fresh() {
  await fetch(API + "/api/__restore", { method: "POST" });
  await page.goto(process.env.E2E_APP ?? "http://localhost:5173/?view=gantt");
  await page.waitForSelector(".wbs-row");
}

await fresh();
console.log("\n== Phím cho việc đang chọn ==");
await step("S: mở danh sách trạng thái của dòng đang chọn", async () => {
  await select("DEMO-6");
  await page.keyboard.press("s");
  await page.waitForSelector(picker);
  await page.keyboard.press("Escape");
});
await step("A: mở bộ chọn người", async () => {
  await select("DEMO-6");
  await page.keyboard.press("a");
  await page.waitForSelector(picker);
  await page.keyboard.press("Escape");
});
await step("Alt →: dời việc đang chọn một ngày; Alt ←: dời lại", async () => {
  await select("DEMO-8");
  const before = (await task("DEMO-8")).startDate;
  await page.keyboard.press("Alt+ArrowRight");
  await page.waitForFunction(async ([, b]) => (await (await fetch("/api/tasks")).json()).find((t) => t.id === "DEMO-8").startDate !== b, [API, before]);
  const moved = (await task("DEMO-8")).startDate;
  assert.equal(Date.parse(moved) - Date.parse(before), 86400000);
  await page.keyboard.press("Alt+ArrowLeft");
  await page.waitForFunction(async ([, b]) => (await (await fetch("/api/tasks")).json()).find((t) => t.id === "DEMO-8").startDate === b, [API, before]);
});
await step("Ctrl .: sao chép mã, có thông báo", async () => {
  await select("DEMO-6");
  await page.keyboard.press("Control+.");
  await page.waitForSelector(".toast", { hasText: "DEMO-6" });
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "DEMO-6");
});
await step("J / K: đi xuống, đi lên theo dòng đang hiện", async () => {
  await select("DEMO-3");
  const keyOf = async () => (await page.locator(".wbs-row-selected .wbs-col-key").first().textContent()).trim();
  const start = await keyOf();
  await page.keyboard.press("j");
  await page.waitForFunction((s) => document.querySelector(".wbs-row-selected .wbs-col-key")?.textContent.trim() !== s, start);
  await page.keyboard.press("k");
  await page.waitForFunction((s) => document.querySelector(".wbs-row-selected .wbs-col-key")?.textContent.trim() === s, start);
});
await step("Ctrl A: chọn mọi dòng đang hiện", async () => {
  await select("DEMO-3");
  await page.keyboard.press("Control+a");
  const total = await page.locator(".wbs-row").count();
  await page.waitForFunction((n) => document.querySelectorAll(".wbs-row-selected").length === n, total);
});
await step("nhiều dòng đang chọn, bấm S: mở menu đổi trạng thái của thanh chọn", async () => {
  await page.keyboard.press("s");
  await page.waitForSelector(".bulk-status-menu");
  await page.keyboard.press("Escape");
});
await step("/: đưa con trỏ vào ô tìm", async () => {
  await page.keyboard.press("Escape");
  await page.keyboard.press("/");
  assert.equal(await page.evaluate(() => document.activeElement?.type), "search");
  await page.keyboard.press("Escape");
});
await step("G T mở Giờ đã ghi; G H về Hôm nay, L mở tờ ghi giờ", async () => {
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("g");
  await page.keyboard.press("t");
  await page.waitForFunction(() => new URL(location.href).searchParams.get("view") === "timesheet");
  await page.keyboard.press("g");
  await page.keyboard.press("h");
  await page.waitForSelector(".today-log-btn");
  await page.keyboard.press("l");
  await page.waitForSelector(".side-sheet");
  await page.keyboard.press("Escape");
});

console.log("\n== Hoàn tác ==");
await fresh();
await step("kéo thanh rồi Ctrl Z ngay (thanh còn focus): về chỗ cũ, có toast", async () => {
  const before = await task("DEMO-5");
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
  await page.waitForFunction(async ([, s]) => (await (await fetch("/api/tasks")).json()).find((t) => t.id === "DEMO-5").startDate !== s, [API, before.startDate]);
  await page.waitForSelector(".toast", { hasText: "Đã dời DEMO-5" });
  await page.keyboard.press("Control+z");
  await page.waitForFunction(async ([, s]) => (await (await fetch("/api/tasks")).json()).find((t) => t.id === "DEMO-5").startDate === s, [API, before.startDate]);
});

assert.equal(problems.length, 0, "lỗi trong trình duyệt: " + problems.join("; "));
await fetch(API + "/api/__restore", { method: "POST" });
await browser.close();
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
process.exit(failed ? 1 : 0);
