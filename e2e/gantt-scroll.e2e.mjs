// Scrolling a big chart sideways must be steady. gantt-task-react re-rendered the whole
// chart on every wheel event and its scrollbar echoed older positions back, so on a big
// project the chart jerked and could lose steps (see client/vite.gantt-patch.ts).
// Exact speed is machine-dependent (perf-scroll.mjs measures it); the frame-time check
// fails only on the order-of-magnitude regression: 100ms+ frames on a 1500-row chart.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = process.env.E2E_APP ?? "http://localhost:5173/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.setDefaultTimeout(15000);
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && problems.push("console: " + m.text().slice(0, 200)));
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

await fetch(API + "/api/__restore", { method: "POST" });
await fetch(API + "/api/__tasks/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ n: 1500 }) });
await page.goto(APP);
await page.waitForFunction(() => document.querySelectorAll(".wbs-row").length >= 1400, null, { timeout: 60000 });
await page.waitForTimeout(1000);

/** The element the chart scrolls sideways in: the widest scrollable ancestor of the bars. */
const chartScrollLeft = () =>
  page.evaluate(() => {
    const svg = document.querySelector("g.bar")?.ownerSVGElement;
    for (let el = svg?.parentElement; el; el = el.parentElement) if (el.scrollWidth > el.clientWidth + 5) return el.scrollLeft;
    return -1;
  });

console.log("\n== Cuộn ngang bảng lớn (1500 dòng) ==");
await step("mỗi cú cuộn đi tiếp về phía trước: không lùi lại, không mất bước", async () => {
  const box = await page.locator(".gantt-body").boundingBox();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
  const start = await chartScrollLeft();
  assert(start >= 0, "không tìm thấy vùng cuộn của biểu đồ");
  const seen = [start];
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(80, 0);
    await page.waitForTimeout(12);
    seen.push(await chartScrollLeft());
  }
  await page.waitForTimeout(300);
  seen.push(await chartScrollLeft());
  for (let i = 1; i < seen.length; i++) {
    assert(seen[i] >= seen[i - 1], `lùi lại ở bước ${i}: ${seen[i - 1]} → ${seen[i]}`);
  }
  const moved = seen.at(-1) - start;
  assert(moved >= 40 * 80 * 0.95, `chỉ đi được ${moved}px trong 40 bước 80px — mất bước`);
});
await step("cuộn ngang và dọc đều mượt: khung hình p95 dưới 50ms", async () => {
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = (now) => {
      window.__frames.push(now - last);
      last = now;
      window.__raf = requestAnimationFrame(tick);
    };
    window.__raf = requestAnimationFrame(tick);
  });
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(i % 2 ? 80 : 0, i % 2 ? 0 : 120);
    await page.waitForTimeout(16);
  }
  const frames = await page.evaluate(() => {
    cancelAnimationFrame(window.__raf);
    return window.__frames.slice(2);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  assert(frames.length > 30, "quá ít khung hình để đo: " + frames.length);
  assert(p95 < 50, `khung hình p95 = ${p95.toFixed(0)}ms (tệ nhất ${sorted.at(-1).toFixed(0)}ms)`);
});
await step("bảng WBS và biểu đồ vẫn chọn/nhấp đúp được sau khi cuộn", async () => {
  await page.locator(".wbs-row", { hasText: "DEMO-5" }).first().scrollIntoViewIfNeeded();
  await page.locator(".wbs-row", { hasText: "DEMO-5" }).first().locator(".wbs-col-name").dblclick();
  await page.waitForSelector(".modal .modal-id");
  await page.keyboard.press("Escape");
});
await step("không có lỗi trình duyệt (kể cả 'Maximum update depth')", async () => {
  assert.deepEqual(problems, []);
});

// The stand-in API is shared by every file in a run: give back the small seed project.
await fetch(API + "/api/__restore", { method: "POST" });
await browser.close();
if (failed) {
  console.log(`\n${failed} lỗi`);
  process.exit(1);
}
console.log("\nđạt hết");
