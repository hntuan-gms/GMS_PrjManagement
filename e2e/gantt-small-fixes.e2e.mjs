// Two small Gantt behaviours fixed in phase 2 / stage 0.
import { chromium } from "playwright-core";
import fs from "node:fs";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
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

await page.goto("http://localhost:5173/");
await page.waitForSelector(".wbs-row");

console.log("\n== Gantt: bộ lọc + CSV ==");
await step("CSV chỉ gồm hàng khớp bộ lọc, không kèm dòng cha không khớp", async () => {
  await page.fill(".gantt-search input", "Dựng API");
  await page.waitForFunction(() => document.querySelector(".tf-count")?.textContent.includes("1/9"));
  // The table still shows the Epic above the hit, for indentation...
  const rows = await page.$$eval(".wbs-row", (r) => r.map((x) => x.textContent));
  if (!rows.some((t) => t.includes("DEMO-2"))) throw new Error("bảng phải giữ dòng cha để thụt lề");
  // ...but the sheet lists only what the filter found.
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator(".gantt-toolbar button", { hasText: "Xuất CSV" }).click()]);
  const lines = fs.readFileSync(await dl.path(), "utf8").split(/\r?\n/).filter(Boolean);
  const ids = lines.slice(1).map((l) => l.split(",")[0]);
  if (JSON.stringify(ids) !== JSON.stringify(["DEMO-6"])) throw new Error("CSV có: " + ids.join(", "));
});

console.log("\n== Gantt: nút Hôm nay ==");
await step("hôm nay nằm ngoài vùng biểu đồ → báo rõ thay vì im lặng", async () => {
  // Only the "Giai đoạn 2" Epic, which starts two days from now.
  await page.fill(".gantt-search input", "Giai đoạn 2");
  await page.waitForFunction(() => document.querySelector(".tf-count")?.textContent.includes("1/9"));
  await page.locator(".gantt-toolbar button", { hasText: "Hôm nay" }).click();
  await page.waitForSelector(".gantt-today-note");
  const note = await page.textContent(".gantt-today-note");
  if (!note.includes("Hôm nay nằm trước")) throw new Error(note);
});
await step("hôm nay nằm trong biểu đồ → không có ghi chú", async () => {
  await page.locator(".tf-clear").click();
  await page.waitForFunction(() => document.querySelectorAll(".wbs-row").length >= 8);
  await page.locator(".gantt-toolbar button", { hasText: "Hôm nay" }).click();
  await page.waitForTimeout(300);
  if (await page.locator(".gantt-today-note").count()) throw new Error("không nên có ghi chú");
});

console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
await browser.close();
process.exit(failed ? 1 : 0);
