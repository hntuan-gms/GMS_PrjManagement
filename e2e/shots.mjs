// Screenshots of every screen, light and dark, against the stand-in API — for comparing a UI change
// before and after (plan 2026-11-06 §11, 0.1). Not a test: run.mjs only runs *.e2e.mjs.
//
//   E2E_APP=http://localhost:5173/ E2E_API=http://localhost:4000 node shots.mjs [outDir]
//
// Start the stand-in API and the client first (see run.mjs for the two commands).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const APP = (process.env.E2E_APP ?? "http://localhost:5173/").replace(/\?.*$/, "");
const OUT = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "shots", "ui"));
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const scheme of ["light", "dark"]) {
  for (const width of [1500, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    const shot = async (name) => {
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(OUT, `${scheme}-${width}-${name}.png`) });
    };
    await page.goto(APP + "?view=today");
    await page.waitForSelector(".today-view");
    await shot("01-hom-nay");
    await page.goto(APP + "?view=gantt");
    await page.waitForSelector(".wbs-row");
    await shot("02-ke-hoach");
    await page.keyboard.press("Control+k");
    await shot("03-o-lenh");
    await page.keyboard.press("Escape");
    await page.locator(".wbs-row").nth(2).locator(".wbs-col-name").dblclick();
    await page.waitForSelector(".peek-panel");
    await shot("04-chi-tiet");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".peek-panel", { state: "detached" });
    for (const [key, sel, name] of [
      ["2", ".bd-card", "05-bang"],
      ["3", ".rv-grid", "06-nhan-luc"],
      ["4", ".pulse", "07-nhip"],
    ]) {
      await page.keyboard.press(key);
      await page.waitForSelector(sel).catch(() => {});
      await shot(name);
    }
    await page.locator("[data-view=timesheet]").click();
    await page.waitForSelector(".ts-grid");
    await shot("08-gio-lam");
    await ctx.close();
  }
}
await browser.close();
console.log("Ảnh ở", OUT);
