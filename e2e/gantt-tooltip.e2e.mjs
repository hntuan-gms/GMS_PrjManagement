// The hover card of a Gantt bar must open next to the bar it describes. gantt-task-react places it from
// `index × rowHeight − scrollY + headerHeight`, so anything that makes its idea of a row differ from the row
// we draw (a different row height, a scrolled pane, a selection bar) throws it rows away from the bar.
import { chromium } from "playwright-core";

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

await page.goto(process.env.E2E_APP ?? "http://localhost:5173/?view=gantt");
await page.waitForSelector(".wbs-row");

/** Hover bar `i`; how far (px) the hover card's top is from that bar's top, and whether they overlap sideways. */
async function probe(i) {
  const rect = await page.evaluate((n) => {
    // One `g.bar` holds every task's group; the first rect of each is the bar itself (the others are drag handles).
    const bars = [...document.querySelectorAll("g.bar > g")];
    const r = bars[n]?.querySelector("rect")?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  }, i);
  if (!rect) return null;
  await page.mouse.move(rect.x + rect.w / 2, rect.y + rect.h / 2);
  try {
    await page.waitForSelector(".gantt-tip", { timeout: 1500 });
  } catch {
    return { i, noTip: true };
  }
  await page.waitForTimeout(80);
  const tip = await page.evaluate(() => {
    const r = document.querySelector(".gantt-tip")?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  });
  await page.mouse.move(5, 5);
  const pointer = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  // How far the card's nearest edge is from the pointer (0 = the pointer is inside it).
  const gapX = Math.max(tip.x - pointer.x, pointer.x - (tip.x + tip.w), 0);
  const gapY = Math.max(tip.y - pointer.y, pointer.y - (tip.y + tip.h), 0);
  return { i, bar: rect, tip, dy: Math.round(tip.y - rect.y), gap: Math.round(Math.max(gapX, gapY)) };
}

async function checkAll(label, count = 6) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const p = await probe(i);
    if (!p || p.noTip) console.log(`   #${i}: ${p ? "không có thẻ" : "không thấy thanh"}`);
    else out.push(p);
  }
  console.log(`   ${label}:`, out.map((p) => `#${p.i} cách ${p.gap}px`).join("  "));
  if (out.length === 0) throw new Error("không đo được thanh nào (đều ngoài màn hình hoặc không ra thẻ)");
  // The card opens a pointer's gap away (14px) from where the person is pointing, whatever the library thinks.
  const bad = out.filter((p) => p.gap > 24);
  if (bad.length) throw new Error(`thẻ cách con trỏ quá xa: ${bad.map((p) => `#${p.i} ${p.gap}px`).join(", ")}`);
}

console.log("\n== Gantt: thẻ chú thích nằm cạnh thanh ==");
await step("dự án nhỏ, chưa chọn gì", async () => {
  await checkAll("ban đầu");
});
await step("sau khi chọn một dòng (thanh thao tác hiện ra)", async () => {
  await page.locator(".wbs-row").nth(2).locator(".wbs-col-name").click();
  await page.waitForTimeout(200);
  await checkAll("đã chọn");
});
await step("sau khi chọn nhiều dòng", async () => {
  await page.locator(".wbs-row").nth(4).click({ modifiers: ["Shift"] });
  await page.waitForTimeout(200);
  await checkAll("chọn nhiều");
});

for (const density of ["compact", "comfortable", "default"]) {
  await step(`mật độ ${density}`, async () => {
    await page.evaluate((d) => localStorage.setItem("gms.density", d), density);
    await page.reload();
    await page.waitForSelector(".wbs-row");
    await page.waitForTimeout(300);
    await checkAll(density);
  });
}

await step("sau khi cuộn ngang biểu đồ", async () => {
  const box = await page.locator(".gantt-body").boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.mouse.wheel(260, 0);
  await page.waitForTimeout(300);
  await checkAll("cuộn ngang", 8);
});
// The zoom buttons read Days / Weeks / Months.
const ZOOM_BUTTON = { Ngày: "Days", Tháng: "Months", Tuần: "Weeks" };
for (const mode of ["Ngày", "Tháng", "Tuần"]) {
  await step(`zoom ${mode}`, async () => {
    await page.locator(".gantt-toolbar button", { hasText: new RegExp(`^${ZOOM_BUTTON[mode]}$`) }).click();
    await page.waitForTimeout(400);
    await checkAll(mode, 8);
  });
}

console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
await browser.close();
process.exit(failed ? 1 : 0);
