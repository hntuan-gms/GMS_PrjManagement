// Dragging a bar must move it one way: with the mouse while dragging, then stay where it was dropped. Reported:
// "it goes forward, then back, then forward again". This records the bar's left edge on every frame of a real
// mouse drag, with the save held back 1.5 s the way a Jira round trip is, and fails if the bar ever goes back.
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

const SAVE_MS = 1500;
const patches = [];
await page.route("**/api/tasks/*", async (route) => {
  if (route.request().method() !== "PATCH") return route.continue();
  patches.push(JSON.parse(route.request().postData() ?? "{}"));
  await new Promise((r) => setTimeout(r, SAVE_MS));
  await route.continue();
});

await page.goto(process.env.E2E_APP ?? "http://localhost:5173/?view=gantt");
await page.waitForSelector(".wbs-row");
await page.waitForTimeout(500);

/**
 * Records, every frame, the left edge of task `id`'s bar (the first rect of its group) and its row, with a time
 * stamp. Found by key each frame: rows are ordered by start date, so a drag can move the task to another row.
 */
async function startRecording(id) {
  await page.evaluate((key) => {
    const w = window;
    w.__trace = [];
    w.__stop = false;
    const tick = () => {
      const rows = [...document.querySelectorAll(".wbs-row")];
      const row = rows.findIndex((r) => [...r.querySelectorAll("*")].some((el) => el.childElementCount === 0 && el.textContent?.trim() === key));
      const bars = document.querySelectorAll("g.bar > g");
      const r = row >= 0 ? bars[row]?.querySelector("rect")?.getBoundingClientRect() : null;
      // A bar nobody touches (the last row's): if it moves too, the whole axis moved, not the dragged bar.
      const other = [...rows].findIndex((rr, k) => k !== row && /DEMO-8/.test(rr.textContent ?? ""));
      const o = other >= 0 ? bars[other]?.querySelector("rect")?.getBoundingClientRect() : null;
      if (r) w.__trace.push({ t: Math.round(performance.now()), x: Math.round(r.x * 10) / 10, row, ox: o ? Math.round(o.x * 10) / 10 : null });
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, id);
}
const stopRecording = () => page.evaluate(() => ((window.__stop = true), window.__trace));
const mark = () => page.evaluate(() => Math.round(performance.now()));

/** Positions the bar settled on, in order, each with how many frames it stayed there. */
function plateaus(trace) {
  const out = [];
  for (const p of trace) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.6) last.frames++;
    else out.push({ x: p.x, t: p.t, frames: 1 });
  }
  return out;
}

async function dragBar(index, days, label) {
  // A zoom keeps the date in the middle of the pane, which can leave this bar under the table: bring it to the
  // first third of the chart so the mouse lands on it.
  await page.evaluate((i) => {
    const sc = document.querySelector("._CZjuD");
    const r = document.querySelectorAll("g.bar > g")[i]?.querySelector("rect")?.getBoundingClientRect();
    if (!sc || !r) return;
    const box = sc.getBoundingClientRect();
    sc.scrollLeft += r.x - (box.left + box.width / 3);
  }, index);
  await page.waitForTimeout(300);
  const before = await page.evaluate((i) => {
    const g = document.querySelectorAll("g.bar > g")[i];
    const r = g?.querySelector("rect")?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  }, index);
  if (!before) throw new Error(`không thấy thanh #${index}`);
  // The scale, read off the axis: the distance between two column labels over the days in one column.
  const colW = await page.evaluate(() => {
    const xs = [...document.querySelectorAll("text._9w8d5")].map((t) => t.getBoundingClientRect().x).sort((a, b) => a - b);
    for (let k = 1; k < xs.length; k++) if (xs[k] - xs[k - 1] > 4) return xs[k] - xs[k - 1];
    return null;
  });
  if (!colW) throw new Error("không đọc được độ rộng cột");
  const pxPerDay = colW / (label.startsWith("Ngày") ? 1 : 7);
  const dx = pxPerDay * days;
  patches.length = 0;
  const id = await page.evaluate((i) => document.querySelectorAll(".wbs-row")[i]?.textContent?.match(/[A-Z]+-\d+/)?.[0] ?? null, index);
  if (!id) throw new Error(`không đọc được mã việc ở hàng #${index}`);
  await startRecording(id);
  const sx = before.x + before.w / 2;
  const sy = before.y + before.h / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  const steps = 12;
  for (let k = 1; k <= steps; k++) {
    await page.mouse.move(sx + (dx * k) / steps, sy);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(120);
  const upAt = await mark();
  await page.mouse.up();
  await page.waitForTimeout(SAVE_MS + 1500);
  const trace = await stopRecording();
  const during = trace.filter((p) => p.t < upAt);
  const after = trace.filter((p) => p.t >= upAt);
  const dir = Math.sign(dx);
  const dropX = during[during.length - 1]?.x;
  const finalX = after[after.length - 1]?.x;
  const pl = plateaus(after);
  const rowsSeen = [...new Set(trace.map((p) => p.row))];
  console.log(`   ${label} ${id}: từ ${Math.round(before.x)} → thả ở ${dropX} → cuối ${finalX} (kỳ vọng ≈ ${Math.round(before.x + dx)}); hàng ${rowsSeen.join("→")}; PATCH ${JSON.stringify(patches)}`);
  console.log(`   sau khi thả: ${pl.map((p) => `${p.x}@+${p.t - upAt}ms×${p.frames}`).join("  ")}`);
  const ox = [...new Set(trace.map((p) => p.ox))];
  console.log(`   thanh DEMO-8 (không kéo): ${ox.join(" → ")}`);
  // Nothing else on the chart moves: a bar nobody touched staying put is what rules out the axis sliding.
  const oxs = trace.map((p) => p.ox).filter((v) => v !== null);
  if (oxs.length && Math.max(...oxs) - Math.min(...oxs) > 2) {
    throw new Error(`cả biểu đồ trượt ngang: thanh không kéo đi từ ${oxs[0]} tới ${oxs[oxs.length - 1]}`);
  }
  // And the dropped bar ends where it was dropped (the library snaps to whole days: half a day either way).
  if (Math.abs(finalX - (before.x + dx)) > pxPerDay / 2 + 2) {
    throw new Error(`thanh không nằm ở chỗ thả: cuối ${finalX}, kỳ vọng ≈ ${Math.round(before.x + dx)}`);
  }
  // Going back: any frame, after the drop, that is further back than where the bar ends up.
  const back = after.filter((p) => (finalX - p.x) * dir > 2);
  if (back.length) {
    throw new Error(
      `thanh lùi lại sau khi thả: ${back.length} khung, xa nhất ${Math.round(Math.max(...back.map((p) => (finalX - p.x) * dir)))}px (từ +${back[0].t - upAt}ms đến +${back[back.length - 1].t - upAt}ms)`
    );
  }
  const backDuring = [];
  for (let k = 1; k < during.length; k++) if ((during[k - 1].x - during[k].x) * dir > 2) backDuring.push(during[k]);
  if (backDuring.length) throw new Error(`thanh giật lùi trong lúc kéo: ${backDuring.length} khung`);
  return { before, dropX, finalX };
}

/** A row whose bar can be dragged: not an Epic with children (its bar is its children's span). */
async function draggableRow() {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll(".wbs-row")];
    return rows.findIndex((r) => !/epic/i.test(r.textContent ?? "") && !r.querySelector(".wbs-toggle"));
  });
}

console.log("\n== Gantt: kéo thanh không giật lùi ==");
// The zoom buttons read Days / Weeks / Months.
const ZOOM_BUTTON = { Tuần: "Weeks", Ngày: "Days" };
for (const mode of ["Tuần", "Ngày"]) {
  await step(`zoom ${mode}: kéo tới 3 ngày`, async () => {
    await page.locator(".gantt-toolbar button", { hasText: new RegExp(`^${ZOOM_BUTTON[mode]}$`) }).click();
    await page.waitForTimeout(400);
    const i = await draggableRow();
    await dragBar(i, 3, `${mode} +3`);
  });
  await step(`zoom ${mode}: kéo lùi 2 ngày`, async () => {
    const i = await draggableRow();
    await dragBar(i, -2, `${mode} −2`);
  });
}

console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
await browser.close();
process.exit(failed ? 1 : 0);
