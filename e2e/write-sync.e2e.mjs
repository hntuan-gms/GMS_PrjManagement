// Jira follows the screen: dồn dập kéo và hoàn tác chỉ ghi phần chênh, và đóng trang giữa chừng không mất gì.
// Chạy trên stand-in API với độ trễ ghi giả lập (một lần lưu Jira thật mất vài giây). Cách Jira thật phản ứng
// với các thao tác này là việc của danh mục kiểm tra tay.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = process.env.E2E_APP ?? "http://localhost:5173/?view=gantt";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
let page = await ctx.newPage();
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
const log = async () => (await (await fetch(API + "/api/__log")).json()).log;
const reset = () => fetch(API + "/api/__reset", { method: "POST" });
const delay = (ms) => fetch(API + "/api/__writedelay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ms }) });
const taskOf = async (id) => (await (await fetch(API + "/api/tasks")).json()).find((t) => t.id === id);
const patchesFor = async (id) => (await log()).filter((l) => l.m === "PATCH" && l.p === `/api/tasks/${id}`);
const batches = async () => (await log()).filter((l) => l.m === "POST" && l.p === "/api/tasks/schedule-batch");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open() {
  await page.goto(APP);
  await page.waitForSelector(".wbs-row");
}
async function dragBar(key, dx) {
  const rows = await page.$$eval(".wbs-row", (r) => r.map((x) => x.textContent));
  const i = rows.findIndex((t) => t.includes(key));
  const box = await page.locator("g.bar > g").nth(i).locator("g[tabindex] rect").first().boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx / 2, y, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 4 });
  await page.mouse.up();
}
const barLeft = async (key) => {
  const rows = await page.$$eval(".wbs-row", (r) => r.map((x) => x.textContent));
  const i = rows.findIndex((t) => t.includes(key));
  return Math.round((await page.locator("g.bar > g").nth(i).locator("g[tabindex] rect").first().boundingBox()).x);
};
async function waitUntil(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
}

console.log("\n== Jira đi theo màn hình ==");

await step("kéo 4 lần rồi hoàn tác hết trước khi lưu xong: Jira chỉ nhận phần chênh và về đúng ngày cũ", async () => {
  await reset();
  await delay(3000);
  await open();
  const original = (await taskOf("DEMO-7")).startDate;
  const left0 = await barLeft("DEMO-7");
  for (const dx of [60, 120, -60, 180]) {
    await dragBar("DEMO-7", dx);
    await page.waitForTimeout(150);
  }
  await page.locator(".gantt-toolbar").click({ position: { x: 4, y: 4 } });
  for (let k = 0; k < 4; k++) {
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(60);
  }
  // The screen is back at once, without waiting for any save.
  assert.equal(await barLeft("DEMO-7"), left0, "màn hình phải về chỗ cũ ngay");
  // Quiet once the writes have gone: at most the one that was already out, then the one that undoes it.
  // Two writes in all: the one that was already out, then the one that takes it back. Wait for both to land.
  await waitUntil(async () => (await taskOf("DEMO-7")).startDate === original && (await patchesFor("DEMO-7")).length >= 2, 20000);
  await sleep(4000);
  const n = (await patchesFor("DEMO-7")).length;
  if ((await taskOf("DEMO-7")).startDate !== original) {
    console.log("   goc", original, "hien", (await taskOf("DEMO-7")).startDate);
    console.log("   PATCH:", (await patchesFor("DEMO-7")).map((l) => JSON.stringify(l.b)).join(" ; "));
    const evs = (await (await fetch(API + "/api/__clientlog")).json()).events;
    console.log("   su kien:", evs.map((e) => e.e + (e.d && (e.d.to || e.d.from) ? `(${e.d.from ?? ""}>${e.d.to ?? ""})` : "")).join(" "));
  }
  assert((await taskOf("DEMO-7")).startDate === original, "Jira phải về ngày cũ");
  assert(n <= 3, `4 lần kéo + 4 lần hoàn tác chỉ được ghi tối đa 3 lần (trước đây 8), đã ghi ${n}`);
  assert.equal(await barLeft("DEMO-7"), left0, "màn hình vẫn ở chỗ cũ sau khi Jira xong");
});

await step("kéo hai việc rồi đóng trang khi chưa lưu xong: phần còn lại được gửi theo lô và Jira có đủ", async () => {
  await reset();
  await delay(2500);
  await page.close();
  page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  await open();
  const a0 = (await taskOf("DEMO-7")).startDate;
  const b0 = (await taskOf("DEMO-6")).startDate;
  await dragBar("DEMO-7", 90);
  await page.waitForTimeout(150);
  await dragBar("DEMO-6", 90);
  await page.waitForTimeout(300);
  // Closing here: the first write is still out and the second has not been sent.
  assert.equal((await patchesFor("DEMO-6")).length, 0, "việc thứ hai chưa được gửi lúc đóng trang");
  await page.goto("about:blank");
  const got = await waitUntil(async () => (await taskOf("DEMO-6")).startDate !== b0 && (await taskOf("DEMO-7")).startDate !== a0, 12000);
  if (!got) {
    const lg = (await log()).filter((l) => l.m !== "GET").map((l) => `${l.m} ${l.p} ${JSON.stringify(l.b).slice(0, 120)}`);
    const ev = (await (await fetch(API + "/api/__clientlog")).json()).events.map((e) => e.e);
    console.log("   DEMO-7", a0, "->", (await taskOf("DEMO-7")).startDate, "| DEMO-6", b0, "->", (await taskOf("DEMO-6")).startDate);
    console.log("   ghi:", lg.join(" ; "));
    console.log("   su kien:", ev.join(","));
  }
  assert(got, "đóng trang rồi mà Jira không nhận đủ thay đổi");
  const b = await batches();
  assert(b.length >= 1, "phải có một lô gửi lúc đóng trang");
  if (!b[0].b.ops.some((o) => o.id === "DEMO-6")) console.log("   lô:", b.map((x) => JSON.stringify(x.b.ops)).join(" ; "), "| PATCH:", (await log()).filter((l) => l.m === "PATCH").map((l) => l.p).join(","));
  assert(b[0].b.ops.some((o) => o.id === "DEMO-6"), "lô phải chứa việc chưa được gửi");
});

await step("lô gửi lúc đóng trang chỉ chứa ngày, số ngày và %: không có trường nào khác", async () => {
  const b = await batches();
  for (const op of b.flatMap((x) => x.b.ops)) {
    assert.deepEqual(Object.keys(op.patch).filter((k) => !["startDate", "durationDays", "percentComplete"].includes(k)), []);
  }
});

await delay(0);
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
await browser.close();
process.exit(failed ? 1 : 0);
