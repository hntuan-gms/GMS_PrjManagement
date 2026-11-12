// The tab reports what it did (drag, Ctrl+Z, writes, applying answers) so a later look at the server's log
// can say what the screen was doing when Jira ended up somewhere unexpected. Against the stand-in API.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = process.env.E2E_APP ?? "http://localhost:5173/?view=gantt";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
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
const events = async () => (await (await fetch(API + "/api/__clientlog")).json()).events;

await fetch(API + "/api/__reset", { method: "POST" });
await fetch(API + "/api/__clientlog?clear=1");
await fetch(API + "/api/__writedelay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ms: 700 }) });
await page.goto(APP);
await page.waitForSelector(".wbs-row");

async function dragBar(key, dx) {
  const rows = await page.$$eval(".wbs-row", (r) => r.map((x) => x.textContent));
  const i = rows.findIndex((t) => t.includes(key));
  const box = await page.locator("g.bar > g").nth(i).locator("g[tabindex] rect").first().boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx / 2, y, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 5 });
  await page.mouse.up();
}

console.log("\n== Nhật ký thao tác phía màn hình ==");
await step("kéo rồi Ctrl+Z: đủ các sự kiện, đúng thứ tự, cùng một tab", async () => {
  await dragBar("DEMO-7", 90);
  await page.waitForFunction(() => !document.querySelector(".gantt-toolbar button[title^='Hoàn tác']")?.disabled);
  await page.locator(".gantt-toolbar").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Control+z");
  // The log is sent in batches after ~1.5 s: wait until the second write has been reported.
  for (let k = 0; k < 60 && (await events()).filter((e) => e.e === "write.done").length < 2; k++) await page.waitForTimeout(250);
  const ev = await events();
  const names = ev.map((e) => e.e);
  const at = (name, from = 0) => names.indexOf(name, from);
  const drag = at("drag");
  assert(drag >= 0, "không có sự kiện kéo: " + names.join(","));
  const send1 = at("write.send", drag);
  const done1 = at("write.done", send1);
  const key = at("undo.key");
  const undo = at("undo", key);
  const send2 = at("write.send", undo);
  assert(send1 > drag && done1 > send1, "kéo → gửi → nhận không đúng thứ tự: " + names.join(","));
  assert(key >= 0 && undo > key && send2 > undo, "Ctrl+Z → hoàn tác → gửi không đúng thứ tự: " + names.join(","));
  assert.equal(new Set(ev.map((e) => e.sid)).size, 1, "các sự kiện phải cùng một tab");
  assert.deepEqual(ev.map((e) => e.n), [...ev.map((e) => e.n)].sort((a, b) => a - b), "số thứ tự phải tăng dần");
  const d = ev[drag].d;
  assert.equal(d.id, "DEMO-7");
  assert.match(d.from, /^\d{4}-\d\d-\d\d\/\d+$/);
  assert.match(d.to, /^\d{4}-\d\d-\d\d\/\d+$/);
  assert.equal(ev[send2].d.why, "undo");
  assert(ev.some((e) => e.e === "apply"), "thiếu sự kiện apply");
});
await step("không ghi nội dung công việc (mô tả, bình luận, tên người)", async () => {
  const all = JSON.stringify(await events());
  assert(!/description|comment|assignee|displayName/i.test(all), "nhật ký chứa trường không được phép");
});

await fetch(API + "/api/__writedelay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ms: 0 }) });
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
await browser.close();
process.exit(failed ? 1 : 0);
