// A real double-click on a WBS *row* must open the edit modal.
//
// phase1.e2e.mjs opens the modal with dispatchEvent("dblclick"), which skips the
// first click's side effect (selection → re-render) and so could never see this
// bug: the table component was re-created on every render, so the row under the
// pointer was replaced between the two clicks and the browser never saw a dblclick.
import { chromium } from "playwright-core";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
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

await fetch((process.env.E2E_API ?? "http://localhost:4000") + "/api/__restore", { method: "POST" });
await page.goto(process.env.E2E_APP ?? "http://localhost:5173/");
await page.waitForSelector(".wbs-row");

console.log("\n== Gantt: nhấp đúp ==");
await step("chọn một hàng KHÔNG làm bảng dịch chỗ (nếu dịch, cú nhấp thứ hai rơi vào hàng khác)", async () => {
  const top = () => page.locator(".wbs-row", { hasText: "DEMO-5" }).evaluate((el) => el.getBoundingClientRect().top);
  const before = await top();
  await page.locator(".wbs-row", { hasText: "DEMO-5" }).locator(".wbs-col-name").click();
  await page.waitForSelector(".selection-bar");
  const after = await top();
  if (before !== after) throw new Error(`hàng dịch từ ${before}px sang ${after}px`);
  await page.locator(".selection-bar button", { hasText: "Bỏ chọn" }).click();
  await page.waitForSelector(".selection-bar", { state: "detached" });
  if ((await top()) !== before) throw new Error("bỏ chọn làm hàng dịch chỗ");
});
for (const [label, selector] of [
  ["ô tên", ".wbs-col-name"],
  ["ô trạng thái/cột phụ", ".wbs-col-extra"],
]) {
  await step(`nhấp đúp vào ${label} của hàng DEMO-5 mở modal`, async () => {
    const row = page.locator(".wbs-row", { hasText: "DEMO-5" });
    await row.locator(selector).first().dblclick();
    await page.waitForSelector(".modal .modal-id");
    const id = (await page.textContent(".modal .modal-id")).trim();
    if (id !== "DEMO-5") throw new Error(`modal của ${id}, không phải DEMO-5`);
    await page.click(".modal-close");
    await page.waitForSelector(".modal", { state: "detached" });
  });
}
await step("hàng được chọn sau cú nhấp (chọn vẫn hoạt động)", async () => {
  await page.locator(".wbs-row", { hasText: "DEMO-6" }).locator(".wbs-col-name").click();
  await page.waitForSelector(".wbs-row-selected");
  if (!(await page.locator(".wbs-row-selected", { hasText: "DEMO-6" }).count())) throw new Error("DEMO-6 chưa được chọn");
});

console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
await browser.close();
process.exit(failed ? 1 : 0);
