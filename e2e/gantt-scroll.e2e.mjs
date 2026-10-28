// A big project is drawn a window of rows at a time (client/src/ganttWindow.ts) and scrolled
// with the page's own scrollbar, because gantt-task-react draws every row it is given and a
// few thousand of them made each scroll, click and drag stutter. This checks what that must
// not break: rows and bars stay on the same line wherever you scroll, the last row is
// reachable, clicks land on the right task, sideways scrolling is steady, and frames stay short.
// Exact speed is machine-dependent (perf-scroll.mjs measures it); the frame-time check fails
// only on the order-of-magnitude regression.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = process.env.E2E_APP ?? "http://localhost:5173/";
const ROWS = 1500;
const ROW_H = 42;
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
await fetch(API + "/api/__tasks/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ n: ROWS }) });
await page.goto(APP);
await page.waitForFunction(() => document.querySelectorAll(".wbs-row").length >= 60, null, { timeout: 60000 });
await page.waitForTimeout(1000);

/** Where the rows and bars are now: how many exist, and how far each row's line is from its bar's. */
const snap = () =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll(".wbs-row")];
    const bars = [...document.querySelectorAll("g.bar > g")];
    const sc = document.querySelector(".gantt-vscroll");
    const body = document.querySelector(".gantt-body").getBoundingClientRect();
    let maxDy = 0;
    let aligned = 0;
    rows.forEach((r, i) => {
      const rr = r.getBoundingClientRect();
      if (rr.bottom < body.top + 60 || rr.top > body.bottom - 30) return; // only what is on screen
      const rect = bars[i]?.querySelector("g[tabindex] rect");
      if (!rect) return;
      const br = rect.getBoundingClientRect();
      maxDy = Math.max(maxDy, Math.abs(br.top + br.height / 2 - (rr.top + rr.height / 2)));
      aligned++;
    });
    const onScreen = rows.filter((r) => {
      const rr = r.getBoundingClientRect();
      return rr.bottom > body.top + 60 && rr.top < body.bottom - 30;
    });
    return {
      rows: rows.length,
      bars: bars.length,
      aligned,
      maxDy,
      scrollTop: sc?.scrollTop ?? -1,
      scrollMax: sc ? sc.scrollHeight - sc.clientHeight : -1,
      firstKey: onScreen[0]?.querySelector(".wbs-col-key")?.textContent ?? null,
      lastBottom: rows.length ? Math.max(...rows.map((r) => r.getBoundingClientRect().bottom)) : 0,
      bodyBottom: body.bottom,
    };
  });
const setScroll = async (top) => {
  await page.evaluate((t) => (document.querySelector(".gantt-vscroll").scrollTop = t), top);
  await page.waitForTimeout(700);
};
/** The element the chart scrolls sideways in: the widest scrollable ancestor of the bars. */
const chartScrollLeft = () =>
  page.evaluate(() => {
    const svg = document.querySelector("g.bar")?.ownerSVGElement;
    for (let el = svg?.parentElement; el; el = el.parentElement) if (el.scrollWidth > el.clientWidth + 5) return el.scrollLeft;
    return -1;
  });

console.log(`\n== Dự án lớn (${ROWS} dòng): chỉ dựng một cửa sổ ==`);
await step("DOM chỉ có vài chục dòng, không phải cả danh sách", async () => {
  const s = await snap();
  assert(s.rows >= 60 && s.rows < 250, `có ${s.rows} dòng trong DOM`);
  assert(s.bars <= s.rows + 2, `có ${s.bars} thanh cho ${s.rows} dòng`);
  assert(s.scrollMax > ROWS * ROW_H * 0.9, "thanh cuộn phải dài bằng cả danh sách: " + s.scrollMax);
});
await step("dòng và thanh nằm đúng một hàng ở đầu danh sách", async () => {
  const s = await snap();
  assert(s.aligned > 10, "ít dòng để so: " + s.aligned);
  assert(s.maxDy < 1.5, `lệch ${s.maxDy.toFixed(1)}px`);
});
await step("con lăn cuộn dọc đi tiếp, vẫn thẳng hàng sau mỗi đoạn", async () => {
  const box = await page.locator(".gantt-body").boundingBox();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
  let last = 0;
  for (let leg = 0; leg < 6; leg++) {
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 250);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(400);
    const s = await snap();
    assert(s.scrollTop > last, `không đi tiếp ở đoạn ${leg}: ${last} → ${s.scrollTop}`);
    assert(s.maxDy < 1.5, `đoạn ${leg}: lệch ${s.maxDy.toFixed(1)}px (scrollTop ${s.scrollTop})`);
    last = s.scrollTop;
  }
});
await step("nhảy thẳng tới giữa và tới cuối danh sách đều thẳng hàng", async () => {
  for (const top of [ROW_H * 700 + 17, ROW_H * 1100 + 5, 1e9, 0, ROW_H * 333]) {
    await setScroll(top);
    const s = await snap();
    assert(s.aligned > 10, `scrollTop ${s.scrollTop}: chỉ ${s.aligned} dòng thấy được`);
    assert(s.maxDy < 1.5, `scrollTop ${s.scrollTop}: lệch ${s.maxDy.toFixed(1)}px`);
  }
});
await step("kéo tới cuối thì dòng cuối nằm sát đáy, không để trống", async () => {
  await setScroll(1e9);
  const s = await snap();
  assert(s.lastBottom <= s.bodyBottom + 1, "dòng tràn ra dưới");
  assert(s.bodyBottom - s.lastBottom < ROW_H + 30, `trống ${Math.round(s.bodyBottom - s.lastBottom)}px dưới dòng cuối`);
});
await step("nhấp đúp một dòng ở giữa danh sách mở đúng việc đó", async () => {
  await setScroll(ROW_H * 600 + 9);
  const key = (await snap()).firstKey;
  assert(key, "không đọc được mã dòng");
  await page.locator(".wbs-row", { hasText: key }).first().locator(".wbs-col-name").dblclick();
  await page.waitForSelector(".modal .modal-id");
  assert((await page.textContent(".modal .modal-id")).includes(key.trim()));
  await page.keyboard.press("Escape");
  await page.waitForSelector(".modal", { state: "detached" });
});
await step("chọn một dòng rồi cuộn đi: lần sau quay lại dòng vẫn đang được chọn", async () => {
  await setScroll(ROW_H * 400);
  const key = (await snap()).firstKey;
  await page.locator(".wbs-row", { hasText: key }).first().click();
  await page.waitForSelector(".wbs-row-selected");
  await setScroll(ROW_H * 1000);
  assert.equal(await page.locator(".wbs-row-selected").count(), 0);
  await setScroll(ROW_H * 400);
  assert.equal(await page.locator(".wbs-row-selected").count(), 1);
});

await step("mũi tên phụ thuộc vẫn được vẽ cho các dòng đang có trong cửa sổ", async () => {
  await setScroll(ROW_H * 500);
  await page.waitForFunction(() => document.querySelectorAll(".dep-arrows path").length > 0);
});
console.log("\n== Cuộn ngang ==");
await step("mỗi cú cuộn đi tiếp về phía trước: không lùi lại, không mất bước", async () => {
  await setScroll(0);
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
  for (let i = 1; i < seen.length; i++) assert(seen[i] >= seen[i - 1], `lùi lại ở bước ${i}: ${seen[i - 1]} → ${seen[i]}`);
  const moved = seen.at(-1) - start;
  assert(moved >= 40 * 80 * 0.95, `chỉ đi được ${moved}px trong 40 bước 80px — mất bước`);
});
await step("trục ngày không dịch khi cửa sổ dòng đổi (thanh vẫn đúng ngày)", async () => {
  // Same task, same bar position at the same horizontal scroll, before and after the window moved.
  await setScroll(ROW_H * 10);
  const before = await page.evaluate(() => {
    const row = document.querySelector(".wbs-row .wbs-col-key")?.textContent;
    const rect = document.querySelector("g.bar > g g[tabindex] rect")?.getBoundingClientRect();
    return { row, x: rect?.left, w: rect?.width };
  });
  await setScroll(ROW_H * 900);
  await setScroll(ROW_H * 10);
  const after = await page.evaluate(() => {
    const row = document.querySelector(".wbs-row .wbs-col-key")?.textContent;
    const rect = document.querySelector("g.bar > g g[tabindex] rect")?.getBoundingClientRect();
    return { row, x: rect?.left, w: rect?.width };
  });
  assert.equal(after.row, before.row);
  assert(Math.abs(after.x - before.x) < 1 && Math.abs(after.w - before.w) < 1, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
});

await step("kéo một thanh ở giữa danh sách: gửi đúng việc đó với ngày mới", async () => {
  await setScroll(ROW_H * 800 + 11);
  await fetch(API + "/api/__reset", { method: "POST" });
  // Rows this far down start months after the chart's first column: bring their bars into view.
  await page.evaluate(() => {
    const body = document.querySelector(".gantt-body").getBoundingClientRect();
    const first = [...document.querySelectorAll(".wbs-row")].findIndex((r) => r.getBoundingClientRect().top > body.top + 80);
    const bar = document.querySelectorAll("g.bar > g")[first + 3]?.querySelector("g[tabindex] rect");
    const svg = document.querySelector("g.bar")?.ownerSVGElement;
    for (let el = svg?.parentElement; el && bar; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 5) {
        el.scrollLeft += bar.getBoundingClientRect().left - 1000;
        break;
      }
    }
  });
  await page.waitForTimeout(300);
  // A row well inside the viewport, not one half under the header or the bottom edge.
  const target = await page.evaluate(() => {
    const body = document.querySelector(".gantt-body").getBoundingClientRect();
    const rows = [...document.querySelectorAll(".wbs-row")];
    const bars = [...document.querySelectorAll("g.bar > g")];
    for (let i = 0; i < rows.length; i++) {
      const rr = rows[i].getBoundingClientRect();
      if (rr.top < body.top + 80 || rr.bottom > body.bottom - 40 || rows[i].textContent.includes("Epic")) continue;
      const rect = bars[i]?.querySelector("g[tabindex] rect")?.getBoundingClientRect();
      if (rect && rect.left > body.left + 200 && rect.right < body.right - 150) {
        return { key: rows[i].querySelector(".wbs-col-key").textContent.trim(), x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    return null;
  });
  assert(target, "không có thanh nào nhìn thấy được để kéo");
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 40, target.y, { steps: 5 });
  await page.mouse.move(target.x + 90, target.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "PATCH"), null, { timeout: 8000 });
  const patch = (await (await fetch(API + "/api/__log")).json()).log.find((l) => l.m === "PATCH");
  assert.equal(patch.p, "/api/tasks/" + target.key, "kéo nhầm việc: " + patch.p + " ≠ " + target.key);
  assert(patch.b.startDate, "không có ngày bắt đầu mới");
});


console.log("\n== Mượt ==");
await step("cuộn ngang và dọc đều mượt: khung hình p95 dưới 100ms", async () => {
  // The refresh after the drag above redraws a 1500-task list; measure scrolling, not that.
  await page.waitForTimeout(2500);
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
  for (let i = 0; i < 80; i++) {
    await page.mouse.wheel(i % 4 === 3 ? 80 : 0, i % 4 === 3 ? 0 : 150);
    await page.waitForTimeout(16);
  }
  const frames = await page.evaluate(() => {
    cancelAnimationFrame(window.__raf);
    return window.__frames.slice(2);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  assert(frames.length > 30, "quá ít khung hình để đo: " + frames.length);
  assert(p95 < 100, `khung hình p95 = ${p95.toFixed(0)}ms (tệ nhất ${sorted.at(-1).toFixed(0)}ms)`);
});
await step("Ctrl + cuộn chỉ phóng to trục thời gian: hàng không trượt, không mất hàng, vẫn thẳng hàng với thanh", async () => {
  // Somewhere in the middle, so a vertical scroll caused by the zoom would have somewhere to go.
  await page.evaluate(() => (document.querySelector(".gantt-vscroll").scrollTop = 20000));
  await page.waitForTimeout(400);
  const before = await snap();
  const body = await page.locator(".gantt-body").boundingBox();
  await page.mouse.move(body.x + body.width * 0.7, body.y + body.height * 0.5);
  await page.keyboard.down("Control");
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, i < 6 ? -120 : 120); // in, then back out
    await page.waitForTimeout(30);
  }
  await page.keyboard.up("Control");
  await page.waitForTimeout(400);
  const after = await snap();
  assert.equal(after.scrollTop, before.scrollTop, `cuộn dọc đổi ${before.scrollTop} → ${after.scrollTop}`);
  assert.equal(after.firstKey, before.firstKey, "dòng đầu tiên trên màn hình đã đổi sau khi zoom");
  assert.ok(after.maxDy < 3, `dòng và thanh lệch ${after.maxDy}px sau khi zoom`);
  assert.ok(after.rows > 20, `chỉ còn ${after.rows} dòng`);
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
