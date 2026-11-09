// Zoom keeps its date: the day under the pointer stays under it while the columns change width and
// across the thresholds where day columns hand over to week and week to month (and back). The library
// scrolls in pixels, so before this the chart slid to another date at every step and jumped at each handoff.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
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

await page.goto(process.env.E2E_APP ?? "http://localhost:5173/");
await page.waitForSelector(".wbs-row");
await page.waitForSelector("g.bar > g rect");
await page.waitForTimeout(600);

/** The viewport x of the left edge of the n-th drawn bar, and which column kind is showing. */
const probe = (n) =>
  page.evaluate((i) => {
    const rect = document.querySelectorAll("g.bar > g")[i]?.querySelector("rect")?.getBoundingClientRect();
    return rect ? { left: rect.left, width: rect.width } : null;
  }, n);

async function zoom(x, y, ticks, delta) {
  await page.mouse.move(x, y);
  await page.keyboard.down("Control");
  for (let i = 0; i < ticks; i++) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(40);
  }
  await page.keyboard.up("Control");
  await page.waitForTimeout(350);
}

/** Puts the n-th bar's start 300px in from the chart's left edge and returns the pointer position on it. */
async function placeBar(n) {
  return page.evaluate((i) => {
    const sc = document.querySelector("._CZjuD");
    const bar = document.querySelectorAll("g.bar > g")[i]?.querySelector("rect")?.getBoundingClientRect();
    const box = sc.getBoundingClientRect();
    sc.scrollLeft += bar.left - box.left - 300;
    return null;
  }, n);
}

console.log("\n== Gantt: zoom giữ ngày dưới con trỏ ==");
// The bar that starts latest, so the date has room to its left and the scroll is never clamped at 0.
const N = await page.evaluate(() => {
  let best = 0;
  let bestLeft = -Infinity;
  document.querySelectorAll("g.bar > g").forEach((g, i) => {
    const l = g.querySelector("rect").getBoundingClientRect().left;
    if (l > bestLeft) {
      bestLeft = l;
      best = i;
    }
  });
  return best;
});
// While the axis is wider than the chart pane, the date under the pointer cannot move; once it is
// narrower the browser pins the scroll at 0 and nothing can hold it, so each run stops there.
for (const [label, from, ticks, delta] of [
  ["phóng to qua ngưỡng tuần → ngày", "Tuần", 14, -120],
  ["thu nhỏ qua ngưỡng ngày → tuần", "Ngày", 12, 120],
]) {
  await step(label, async () => {
    await page.locator(".gantt-toolbar button", { hasText: from }).first().click();
    await page.waitForTimeout(500);
    await placeBar(N);
    await page.waitForTimeout(300);
    const start = await probe(N);
    const y = (await page.locator(".gantt-body").boundingBox()).y + 200;
    const px = start.left;
    await page.mouse.move(px, y);
    await page.keyboard.down("Control");
    let worst = 0;
    let steps = 0;
    for (let i = 0; i < ticks; i++) {
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(90);
      const state = await page.evaluate(() => {
        const sc = document.querySelector("._CZjuD");
        return { narrower: sc.scrollWidth <= sc.clientWidth + 1 };
      });
      if (state.narrower) break;
      const now = await probe(N);
      if (!now) continue; // the library redraws its bars a beat after the columns change
      worst = Math.max(worst, Math.abs(now.left - px));
      steps++;
    }
    await page.keyboard.up("Control");
    assert.ok(steps >= 3, `chỉ đo được ${steps} bước`);
    assert.ok(worst <= 12, `thanh trôi tối đa ${worst.toFixed(0)}px khỏi con trỏ trong lúc zoom`);
  });
}

await step("nút Ngày / Tuần / Tháng giữ ngày ở giữa khung nhìn", async () => {
  await page.locator(".gantt-toolbar button", { hasText: "Tuần" }).first().click();
  await page.waitForTimeout(400);
  await placeBar(N);
  // Bring the bar's start to the middle of the chart pane, which is what the buttons keep.
  await page.evaluate((i) => {
    const sc = document.querySelector("._CZjuD");
    const bar = document.querySelectorAll("g.bar > g")[i]?.querySelector("rect")?.getBoundingClientRect();
    const box = sc.getBoundingClientRect();
    sc.scrollLeft += bar.left - (box.left + sc.clientWidth / 2);
  }, N);
  await page.waitForTimeout(300);
  const mid = await page.evaluate(() => {
    const sc = document.querySelector("._CZjuD");
    const b = sc.getBoundingClientRect();
    return b.left + sc.clientWidth / 2;
  });
  for (const name of ["Ngày", "Tuần"]) {
    await page.locator(".gantt-toolbar button", { hasText: name }).first().click();
    await page.waitForTimeout(500);
    const b = await probe(N);
    assert.ok(Math.abs(b.left - mid) <= 15, `${name}: thanh ở ${b.left.toFixed(0)}px, giữa khung là ${mid.toFixed(0)}px`);
  }
  // Tháng: the axis of a short project is narrower than the pane, so it cannot be centred; the bar must
  // still be on screen rather than thrown off the chart.
  await page.locator(".gantt-toolbar button", { hasText: "Tháng" }).first().click();
  await page.waitForTimeout(500);
  const m = await probe(N);
  const box = await page.evaluate(() => {
    const r = document.querySelector("._CZjuD").getBoundingClientRect();
    return { left: r.left, right: r.right };
  });
  assert.ok(m && m.left >= box.left && m.left <= box.right, "ở chế độ Tháng thanh phải còn nằm trong khung biểu đồ");
});

console.log(failed ? `\n${failed} lỗi` : "\nđạt hết");
await browser.close();
process.exit(failed ? 1 : 0);
