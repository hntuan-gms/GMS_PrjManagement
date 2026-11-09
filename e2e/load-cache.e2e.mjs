// Opening a project: the saved copy shows at once while the fresh one loads, and the
// list carries no descriptions (the edit modal fetches the one it needs).
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = process.env.E2E_APP ?? "http://localhost:5173/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.setDefaultTimeout(8000);
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
const log = async () => (await (await fetch(API + "/api/__log")).json()).log;
const setDelay = (ms) => fetch(API + "/api/__delay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ms }) });
// The header's sync indicator ("Sync" and an icon): its state is the class (is-ok, is-reading) and the aria-label ("Khớp Jira" / "Đang đọc Jira…").
const syncButton = () => page.locator(".sync-indicator");

await fetch(API + "/api/__restore", { method: "POST" });

console.log("\n== Mở dự án: hiện bản lưu trước, làm mới sau ==");
await step("lần đầu (chưa có bản lưu) phải chờ dữ liệu, rồi lưu lại cho lần sau", async () => {
  await page.goto(APP);
  await page.waitForSelector(".wbs-row");
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("gms.tasksCache.")));
  assert.equal(keys.length, 1, keys.join());
  assert(keys[0].includes(".me."), "bản lưu phải gắn với tài khoản: " + keys[0]);
});
await step("mở lại khi máy chủ chậm 2,5 giây: bảng hiện ngay từ bản lưu, chỉ báo ghi 'Đang đọc Jira'", async () => {
  await setDelay(2500);
  const started = Date.now();
  await page.reload();
  await page.waitForSelector(".wbs-row", { timeout: 1500 });
  assert(Date.now() - started < 2000, "bảng hiện sau " + (Date.now() - started) + "ms, chưa nhanh hơn máy chủ");
  assert((await page.locator(".center-message").count()) === 0, "không được hiện 'Đang tải dữ liệu...'");
  assert((await syncButton().getAttribute("aria-label")).includes("Đang đọc"));
});
await step("khi bản mới về thì nút trở lại bình thường", async () => {
  await page.waitForFunction(() => document.querySelector(".sync-indicator")?.classList.contains("is-ok"), null, { timeout: 6000 });
  await setDelay(0);
});
await step("chưa có bản lưu và máy chủ chậm: vẫn thấy header, nút đồng bộ xoay, một vòng xoay thay cho trang trống", async () => {
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("gms.tasksCache.")).forEach((k) => localStorage.removeItem(k)));
  await setDelay(2500);
  await page.reload();
  await page.waitForSelector(".spinner", { timeout: 3000 });
  await page.waitForSelector(".toolbar", { timeout: 1500 });
  assert((await page.locator(".wbs-row").count()) === 0, "chưa có dữ liệu mà đã có hàng");
  assert((await syncButton().getAttribute("aria-label")).includes("Đang đọc"), "chỉ báo không báo đang tải");
  assert((await page.locator(".sync-indicator.is-reading").count()) > 0, "chỉ báo đồng bộ không ở trạng thái đang đọc");
  await page.waitForSelector(".wbs-row", { timeout: 8000 });
  await setDelay(0);
});
await step("danh sách việc không kèm mô tả", async () => {
  const list = await (await fetch(API + "/api/tasks")).json();
  assert(list.length > 0 && list.every((t) => !("description" in t)), "danh sách vẫn mang description");
});

console.log("\n== Mô tả lấy khi mở việc ==");
await step("mở việc có mô tả: mô tả hiện sau khi tải; sửa chỗ khác thì chỉ gửi chỗ đó, mô tả không bị ghi lại", async () => {
  await fetch(API + "/api/tasks/DEMO-5", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ description: "Mô tả có sẵn" }) });
  await page.reload();
  await page.waitForSelector(".wbs-row");
  await fetch(API + "/api/__reset", { method: "POST" });
  await page.locator(".wbs-row", { hasText: "DEMO-5" }).locator(".wbs-col-name").dblclick();
  await page.waitForFunction(() => document.querySelector(".tdx-desc")?.textContent.includes("Mô tả có sẵn"));
  assert.equal(await page.locator(".tdx-desc-edit").count(), 0, "mô tả là chữ, chưa phải ô nhập");
  await page.locator(".td-title").fill("Thiết kế cơ sở dữ liệu (sửa)");
  await page.locator(".td-title").press("Enter");
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "PATCH"));
  const patch = (await log()).find((l) => l.m === "PATCH");
  assert.deepEqual(Object.keys(patch.b), ["summary"], "chỉ gửi trường vừa sửa");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".modal", { state: "detached" });
});

console.log("\n== Dự án quá lớn cho localStorage: bản lưu nằm trong IndexedDB ==");
const idbCount = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("gms-cache", 1);
        open.onerror = () => resolve(0);
        open.onsuccess = () => {
          const q = open.result.transaction("entries").objectStore("entries").count();
          q.onsuccess = () => resolve(q.result);
          q.onerror = () => resolve(0);
        };
      })
  );
await step("quá giới hạn: không có trong localStorage, có trong IndexedDB", async () => {
  // A test seam: a tiny limit makes the demo project count as "too big".
  await page.addInitScript(() => {
    globalThis.__GMS_TASKS_CACHE_MAX__ = 1000;
  });
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("gms.tasksCache.")).forEach((k) => localStorage.removeItem(k)));
  await page.reload();
  await page.waitForSelector(".wbs-row");
  for (let i = 0; i < 40 && (await idbCount()) === 0; i++) await page.waitForTimeout(100);
  const ls = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("gms.tasksCache.")));
  assert.equal(ls.length, 0, "bản lưu lớn vẫn nằm trong localStorage: " + ls.join());
  assert.equal(await idbCount(), 1);
});
await step("mở lại khi máy chủ chậm: bảng hiện ngay từ IndexedDB và nút xoay", async () => {
  await setDelay(2500);
  const started = Date.now();
  await page.reload();
  await page.waitForSelector(".wbs-row", { timeout: 2000 });
  assert(Date.now() - started < 2300, "bảng hiện sau " + (Date.now() - started) + "ms, chưa nhanh hơn máy chủ");
  assert((await syncButton().getAttribute("aria-label")).includes("Đang đọc"), "chỉ báo không báo đang cập nhật");
  assert((await page.locator(".sync-indicator.is-reading").count()) > 0, "chỉ báo đồng bộ không ở trạng thái đang đọc");
  await page.waitForFunction(() => document.querySelector(".sync-indicator")?.classList.contains("is-ok"), null, { timeout: 6000 });
  await setDelay(0);
});

console.log(problems.length ? "\nLỗi trình duyệt:\n" + problems.join("\n") : "\nLỗi console/pageerror: không có");
await browser.close();
if (failed || problems.length) {
  console.log(`\n${failed} lỗi`);
  process.exit(1);
}
console.log("\nđạt hết");
