// Scrolling on past the last row (or up past the first) must stay where it is. gantt-task-react
// still handled a wheel step when its vertical scroller was already at the end and clamped it
// itself with the wrong number, so the whole list jumped back to the top. This is the plain chart
// (a project under WINDOW_THRESHOLD rows, the one most projects are); the windowed chart scrolls
// natively and is covered by gantt-scroll.e2e.mjs.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = process.env.E2E_APP ?? "http://localhost:5173/";
const ROWS = 180;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.setDefaultTimeout(15000);
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
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
await fetch(API + "/api/__tasks/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ n: ROWS }) });
await page.goto(APP);
await page.waitForFunction(() => document.querySelectorAll(".wbs-row").length >= 30);
await page.waitForTimeout(2500);
assert.equal(await page.evaluate(() => !!document.querySelector(".gantt-vscroll")), false, "this suite is for the plain (not windowed) chart");

const top = () => page.evaluate(() => Math.round(document.querySelector("._1eT-t").scrollTop));
/** Wheel `steps` times by `dy`, sampling the scroller every frame; returns how often it jumped far back. */
async function wheelAndWatch(dy, steps) {
  await page.evaluate(() => {
    window.__f = [];
    const tick = () => {
      window.__f.push(Math.round(document.querySelector("._1eT-t")?.scrollTop ?? -1));
      requestAnimationFrame(tick);
    };
    tick();
  });
  const box = await page.locator(".gantt-body").boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(400);
  const f = await page.evaluate(() => window.__f);
  let jumps = 0;
  for (let i = 1; i < f.length; i++) if (f[i] < f[i - 1] - 300) jumps++;
  return { jumps, max: Math.max(...f) };
}

await step("cuộn quá dòng cuối bằng nhiều nấc nhỏ: ở lại cuối danh sách, không nhảy về đầu", async () => {
  const r = await wheelAndWatch(40, 300);
  assert.ok(r.max > 3000, "chưa cuộn tới cuối (max " + r.max + ")");
  assert.equal(r.jumps, 0, `nhảy ngược lên ${r.jumps} lần`);
  const t = await top();
  assert.ok(t >= r.max - 2, `kết thúc ở ${t}, đáy là ${r.max}`);
});

await step("cuộn lên quá dòng đầu: ở lại đầu danh sách", async () => {
  const r = await wheelAndWatch(-40, 300);
  assert.equal(r.jumps, 0);
  assert.equal(await top(), 0);
});

await step("một nấc rất lớn vượt đáy rồi tiếp tục cuộn: vẫn ở cuối", async () => {
  const r = await wheelAndWatch(900, 14);
  assert.equal(r.jumps, 0, `nhảy ngược lên ${r.jumps} lần`);
  const t = await top();
  assert.ok(t > r.max - 5, `kết thúc ở ${t}, đáy là ${r.max}`);
});

await step("sau khi chạm đáy vẫn cuộn ngược lên được, từng bước", async () => {
  const before = await top();
  const box = await page.locator(".gantt-body").boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(400);
  const after = await top();
  assert.ok(Math.abs(before - after - 200) < 5, `${before} -> ${after}`);
});

await step("trackpad quán tính: nấc tới đáy rồi nấc deltaY = -0, 0, 1, 3 không làm danh sách nhảy về đầu", async () => {
  await page.evaluate(() => (document.querySelector("._1eT-t").scrollTop = 0));
  await page.waitForTimeout(600);
  const box = await page.locator(".gantt-body").boundingBox();
  const point = [box.x + box.width * 0.6, box.y + box.height / 2];
  await page.mouse.move(...point);
  const max = await page.evaluate(() => { const s = document.querySelector("._1eT-t"); return Math.round(s.scrollHeight - s.clientHeight); });
  while ((await top()) < max - 110) {
    await page.mouse.wheel(0, 40);
    await page.waitForTimeout(25);
  }
  // The sequence a real trackpad logged on ADT: a step that reaches the end, then a step of -0.
  const seen = await page.evaluate(async ([x, y]) => {
    const t = () => Math.round(document.querySelector("._1eT-t").scrollTop);
    const res = [];
    for (const d of [60, 102, -0, -0, 0, 1, 3, -0]) {
      (document.elementFromPoint(x, y) || document.body).dispatchEvent(new WheelEvent("wheel", { deltaY: d, bubbles: true, cancelable: true, composed: true }));
      await new Promise((r) => setTimeout(r, 17));
      res.push(t());
    }
    return res;
  }, point);
  assert.ok(seen.every((t) => t >= max - 25), "đã rời đáy: " + JSON.stringify(seen) + " (đáy " + max + ")");
});

await step("không có lỗi trình duyệt", async () => assert.deepEqual(problems, []));

await browser.close();
console.log(failed ? `\n${failed} lỗi` : "\ntất cả đạt");
process.exit(failed ? 1 : 0);
