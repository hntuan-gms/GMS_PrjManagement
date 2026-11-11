// A link to one task: "Sao chép liên kết" in the task panel gives /?project=KEY&task=KEY-n, and opening that
// link lands on the task's detail panel (no Jira), then strips itself from the address so F5 does not replay it.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = (process.env.E2E_APP ?? "http://localhost:5173/").replace(/\?.*$/, "");
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
const panelKey = async () => (await page.locator(".modal-detail .modal-id").textContent()).trim();

await fetch(API + "/api/__restore", { method: "POST" });

console.log("\n== Liên kết tới một việc ==");
await step("mở liên kết thì hiện ngay chi tiết việc đó", async () => {
  await page.goto(APP + "?project=DEMO&task=DEMO-3");
  await page.waitForSelector(".modal-detail .modal-id");
  assert.equal(await panelKey(), "DEMO-3");
});
await step("địa chỉ không còn mang việc đó (F5 không mở lại)", async () => {
  assert.equal(new URL(page.url()).searchParams.get("task"), null);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".modal-detail", { state: "detached" });
  await page.reload();
  await page.waitForSelector(".wbs-row, .today-view");
  assert.equal(await page.locator(".modal-detail").count(), 0);
});
await step("menu ⋯ của việc có 'Sao chép liên kết', không còn 'Sao chép mã'", async () => {
  await page.goto(APP + "?project=DEMO&task=DEMO-5");
  await page.waitForSelector(".modal-detail .modal-id");
  await page.locator("button.td-more").click();
  await page.waitForSelector(".td-more-menu");
  const menu = await page.locator(".td-more-menu").innerText();
  assert.ok(menu.includes("Sao chép liên kết"), menu);
  assert.ok(!menu.includes("Sao chép mã"), menu);
});
await step("bấm 'Sao chép liên kết' đưa đúng đường dẫn vào clipboard", async () => {
  await page.locator(".td-more-menu .menu-item", { hasText: "Sao chép liên kết" }).click();
  await page.waitForSelector(".toast", { hasText: "DEMO-5" });
  const text = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(text, await page.evaluate(() => `${location.origin}/?project=DEMO&task=DEMO-5`));
});
await step("dán liên kết đã sao chép vào tab mới thì mở đúng việc đó", async () => {
  const text = await page.evaluate(() => navigator.clipboard.readText());
  const other = await ctx.newPage();
  await other.goto(text);
  await other.waitForSelector(".modal-detail .modal-id");
  assert.equal((await other.locator(".modal-detail .modal-id").textContent()).trim(), "DEMO-5");
  await other.close();
});
await step("một việc không có trong dự án thì báo, không mở gì", async () => {
  await page.goto(APP + "?project=DEMO&task=DEMO-9999");
  await page.waitForSelector(".toast", { hasText: "DEMO-9999" });
  assert.equal(await page.locator(".modal-detail").count(), 0);
});
await step("liên kết có việc của dự án khác bị bỏ qua, app mở bình thường", async () => {
  await page.goto(APP + "?project=DEMO&task=OTHER-1");
  await page.waitForSelector(".wbs-row, .today-view");
  assert.equal(await page.locator(".modal-detail").count(), 0);
});

assert.equal(problems.length, 0, "lỗi trong trình duyệt: " + problems.join("; "));
await fetch(API + "/api/__restore", { method: "POST" });
await browser.close();
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
process.exit(failed ? 1 : 0);
