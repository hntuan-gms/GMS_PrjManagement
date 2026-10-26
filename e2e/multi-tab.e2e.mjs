// Two tabs of one browser on two projects: neither disturbs the other. The session cookie holds one
// "current project" for the whole browser, so a tab that follows it moves when another tab changes it;
// each tab now names its own project on every request. Client against the stand-in API.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = process.env.E2E_APP ?? "http://localhost:5173/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
// One context = one cookie jar, like two tabs of one browser.
const context = await browser.newContext({ viewport: { width: 1400, height: 800 } });
const problems = [];
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
const open = async () => {
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  await page.goto(APP);
  return page;
};
const seen = async () => (await (await fetch(API + "/api/__tasks-seen")).json());
const badge = (page) => page.locator(".proj-key").first();

await fetch(API + "/api/__restore", { method: "POST" });

console.log("\n== Hai tab, hai dự án ==");
const a = await open();
await a.waitForSelector(".wbs-row");
let b;
await step("tab A mở dự án mặc định (DEMO) và ghim nó cho riêng tab", async () => {
  assert.equal((await badge(a).textContent()).trim(), "DEMO");
  assert.equal(await a.evaluate(() => sessionStorage.getItem("gms.tab.project")), "DEMO");
});
await step("tab B đổi sang dự án khác: B thấy dự án đó", async () => {
  b = await open();
  await b.waitForSelector(".wbs-row");
  await b.locator(".proj-key").first().click();
  await b.getByText("Đổi dự án…").click();
  await b.locator(".project-row", { hasText: "OTHER" }).click();
  await b.waitForFunction(() => document.querySelector(".proj-key")?.textContent?.trim() === "OTHER");
  await b.locator(".wbs-row", { hasText: "OTHER-1" }).waitFor();
  assert.equal((await seen()).sessionProject, "OTHER", "cookie mặc định phải là dự án chọn gần nhất");
});
await step("tab A vẫn ở DEMO: tải lại dữ liệu vẫn xin dự án DEMO và vẫn hiện việc của DEMO", async () => {
  const [req] = await Promise.all([
    a.waitForRequest((r) => /\/api\/sync$/.test(r.url())),
    a.getByRole("button", { name: /Đồng bộ từ Jira/ }).click(),
  ]);
  assert.equal(req.headers()["x-project-key"], "DEMO", "yêu cầu của tab A không nói rõ dự án của nó");
  await a.waitForFunction(() => !document.body.innerText.includes("Đang đồng bộ"));
  assert.equal((await badge(a).textContent()).trim(), "DEMO");
  assert.ok((await a.locator(".wbs-row", { hasText: "DEMO-5" }).count()) > 0, "tab A mất việc của DEMO");
  assert.equal(await a.locator(".wbs-row", { hasText: "OTHER-1" }).count(), 0, "tab A bị lẫn việc của dự án khác");
});
await step("tải lại tab A: vẫn DEMO (đã ghim), dù mặc định của phiên là dự án khác", async () => {
  await a.reload();
  await a.waitForSelector(".wbs-row");
  assert.equal((await badge(a).textContent()).trim(), "DEMO");
  assert.ok((await a.locator(".wbs-row", { hasText: "DEMO-5" }).count()) > 0);
});
await step("tab B không bị kéo ngược: vẫn OTHER sau khi A làm việc", async () => {
  assert.equal((await badge(b).textContent()).trim(), "OTHER");
  const [req] = await Promise.all([
    b.waitForRequest((r) => /\/api\/sync$/.test(r.url())),
    b.getByRole("button", { name: /Đồng bộ từ Jira/ }).click(),
  ]);
  assert.equal(req.headers()["x-project-key"], "OTHER");
  await b.waitForFunction(() => !document.body.innerText.includes("Đang đồng bộ"));
  assert.ok((await b.locator(".wbs-row", { hasText: "OTHER-1" }).count()) > 0);
});
await step("tab mới hoàn toàn (chưa có gì) lấy dự án chọn gần nhất làm mặc định", async () => {
  const c = await open();
  await c.waitForSelector(".wbs-row");
  assert.equal((await badge(c).textContent()).trim(), "OTHER");
  await c.close();
});

assert.equal(problems.length, 0, "lỗi trong trình duyệt: " + problems.join("; "));
await fetch(API + "/api/__restore", { method: "POST" });
await browser.close();
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
process.exit(failed ? 1 : 0);
