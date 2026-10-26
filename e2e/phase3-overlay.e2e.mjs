// G3#12 CSV with overlay data, G3#13 baseline strips on the Gantt, G3#8 saved filters.
import { chromium } from "playwright-core";
import fs from "node:fs";
import assert from "node:assert/strict";
import { displaySwitch, ioAction, openDisplay } from "./toolbar.mjs";

const API = process.env.E2E_API ?? "http://localhost:4000";
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
    console.log("  FAIL", name, "\n       ", String(e.message).split("\n").slice(0, 4).join(" "));
  }
}
const lastPatch = async (id) => {
  const { log } = await (await fetch(API + "/api/__log")).json();
  return log.filter((l) => l.m === "PATCH" && l.p === `/api/tasks/${id}`).at(-1)?.b;
};
const task = async (id) => (await (await fetch(API + "/api/tasks")).json()).find((t) => t.id === id);
const strip = (id) => page.locator(`.baseline-bar[data-task-id="${id}"]`);
const stripTitle = (id) => strip(id).evaluate((el) => el.querySelector("title").textContent);
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const selectRow = async (id) => {
  await page.locator(".wbs-row", { hasText: id }).first().click();
  await page.waitForSelector(".selection-bar");
};
const baselineSelect = '.selection-bar select[aria-label^="Lưu hoặc xoá baseline"]';

// Earlier scripts move dates around; this one asserts against the seed.
await fetch(API + "/api/__reset", { method: "POST" });
await fetch(API + "/api/__tasks/reset", { method: "POST" });
await page.goto(process.env.E2E_APP ?? "http://localhost:5173/");
await page.waitForSelector(".wbs-row");

console.log("\n== G3#13 Baseline trên Gantt ==");
await step("Baseline bật sẵn trong 'Hiển thị', toolbar vẫn một dòng ở 1500px", async () => {
  await openDisplay(page);
  assert.ok(await displaySwitch(page, "Baseline").isChecked());
  await page.keyboard.press("Escape");
  // Items are centred, so their tops differ by a few px; a second row would start
  // below the bottom of the first.
  const { lowestTop, highestBottom, overflow } = await page.$eval(".gantt-toolbar", (bar) => {
    const rects = [...bar.querySelectorAll("button, input")].map((c) => c.getBoundingClientRect()).filter((r) => r.height > 0);
    return {
      lowestTop: Math.max(...rects.map((r) => r.top)),
      highestBottom: Math.min(...rects.map((r) => r.bottom)),
      overflow: bar.scrollWidth - bar.clientWidth,
    };
  });
  assert.ok(lowestTop < highestBottom, `toolbar xuống dòng (top ${lowestTop} ≥ bottom ${highestBottom})`);
  assert.ok(overflow <= 1, "toolbar tràn " + overflow + "px");
});
await step("thanh baseline nằm dưới thanh thực tế, đúng lịch thì ghi 'Đúng baseline'", async () => {
  await strip("DEMO-5").waitFor();
  assert.match(await stripTitle("DEMO-5"), /Đúng baseline/);
  const cls = await strip("DEMO-5").getAttribute("class");
  assert.ok(!cls.includes("is-late"));
});
await step("Xoá baseline (có xác nhận) → PATCH null, thanh biến mất", async () => {
  await selectRow("DEMO-5");
  await page.selectOption(baselineSelect, "clear");
  await page.locator(".dlg button.danger-solid").click();
  await page.waitForFunction(() => !document.querySelector('.baseline-bar[data-task-id="DEMO-5"]'));
  const b = await lastPatch("DEMO-5");
  assert.equal(b.baselineStart, null);
  assert.equal(b.baselineDue, null);
});
await step("Lưu baseline = lịch hiện tại → PATCH đúng ngày, thanh hiện lại", async () => {
  await page.selectOption(baselineSelect, "save");
  await strip("DEMO-5").waitFor();
  const t = await task("DEMO-5");
  const b = await lastPatch("DEMO-5");
  assert.equal(b.baselineStart, t.startDate);
  assert.equal(b.baselineDue, t.dueDate);
});
await step("dời task sau baseline → thanh đỏ, ghi 'Trễ N ngày'", async () => {
  await page.fill(".selection-shift input", "3");
  await page.locator(".selection-shift button").nth(1).click();
  await page.waitForFunction(() => document.querySelector('.baseline-bar[data-task-id="DEMO-5"]')?.classList.contains("is-late"));
  const t = await task("DEMO-5");
  const slip = days(t.baselineDue, t.dueDate);
  assert.ok(slip > 0);
  assert.match(await stripTitle("DEMO-5"), new RegExp(`Trễ ${slip} ngày`));
});
await step("tắt công tắc Baseline → ẩn hết thanh, bật lại → hiện lại", async () => {
  await openDisplay(page);
  await displaySwitch(page, "Baseline").click();
  await page.waitForFunction(() => document.querySelectorAll(".baseline-bar").length === 0);
  await displaySwitch(page, "Baseline").click();
  await strip("DEMO-5").waitFor();
  await page.keyboard.press("Escape");
});

console.log("\n== G3#12 Xuất CSV kèm overlay ==");
await step("CSV luôn có % hoàn thành, phụ thuộc, baseline và độ lệch", async () => {
  await fetch(API + "/api/tasks/DEMO-6", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ predecessors: [{ taskId: "DEMO-5", type: "FS", lagDays: 1 }] }),
  });
  await page.reload();
  await page.waitForSelector(".wbs-row");
  const [dl] = await Promise.all([page.waitForEvent("download"), ioAction(page, "Xuất CSV")]);
  const lines = fs.readFileSync(await dl.path(), "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(",");
  assert.deepEqual(header.slice(0, 2), ["Mã", "Tên công việc"]);
  for (const h of ["Phụ thuộc (việc trước)", "Baseline bắt đầu", "Baseline kết thúc", "Lệch baseline (ngày)"]) {
    assert.ok(header.includes(h), "thiếu cột " + h);
  }
  // % is a default visible column, so it must not appear twice.
  assert.equal(header.filter((h) => h.includes("%")).length, 1);
  const row = (id) => Object.fromEntries(lines.find((l) => l.startsWith(id + ",")).split(",").map((v, i) => [header[i], v]));
  const t5 = await task("DEMO-5");
  assert.equal(row("DEMO-5")["Baseline kết thúc"], t5.baselineDue);
  assert.equal(Number(row("DEMO-5")["Lệch baseline (ngày)"]), days(t5.baselineDue, t5.dueDate));
  assert.equal(row("DEMO-6")["Phụ thuộc (việc trước)"], "DEMO-5 FS+1");
});

// Put the dates and dependencies back for the scripts that run after this one.
await fetch(API + "/api/__tasks/reset", { method: "POST" });
await page.reload();
await page.waitForSelector(".wbs-row");

console.log("\n== G3#8 Bộ lọc đã lưu ==");
const menuBtn = () => page.locator(".gantt-wrap .sf-select > .tf-btn");
await step("chưa chọn điều kiện → không cho lưu; thấy bộ lọc người khác chia sẻ", async () => {
  await menuBtn().click();
  await page.waitForSelector(".sf-menu");
  assert.ok((await page.textContent(".sf-form")).includes("Chọn ít nhất một điều kiện"));
  const shared = await page.$$eval(".sf-item", (r) => r.map((x) => x.textContent));
  assert.ok(shared.some((t) => t.includes("Việc gấp của nhóm") && t.includes("Nguyễn Anh")), shared.join("|"));
  await page.keyboard.press("Escape");
});
await step("lưu 'Của tôi' + chia sẻ → lưu dạng @me, nút ghi tên bộ lọc", async () => {
  await page.locator(".tf-bar .tf-btn", { hasText: "Của tôi" }).click();
  await page.waitForFunction(() => document.querySelector(".tf-count")?.textContent.includes("1/9"));
  await menuBtn().click();
  await page.fill('.sf-form input[type="text"]', "Phần việc riêng");
  await page.check(".sf-share input");
  await page.locator(".sf-form .text-btn", { hasText: "Lưu bộ lọc hiện tại" }).click();
  await page.waitForFunction(() => document.querySelector(".gantt-wrap .sf-select > .tf-btn")?.textContent.includes("Bộ lọc: Phần việc riêng"));
  const { log } = await (await fetch(API + "/api/__log")).json();
  const post = log.filter((l) => l.m === "POST" && l.p === "/api/filters").at(-1).b;
  assert.deepEqual(post.spec.people, ["@me"]);
  assert.equal(post.shared, true);
  assert.equal("text" in post.spec, false);
  await page.keyboard.press("Escape");
});
await step("xoá lọc rồi áp dụng lại từ menu → cùng kết quả", async () => {
  await page.locator(".tf-clear").click();
  await page.waitForFunction(() => !document.querySelector(".tf-count"));
  assert.ok((await menuBtn().textContent()).includes("Bộ lọc đã lưu"));
  await menuBtn().click();
  await page.locator(".sf-apply", { hasText: "Phần việc riêng" }).click();
  await page.waitForFunction(() => document.querySelector(".tf-count")?.textContent.includes("1/9"));
});
await step("áp dụng bộ lọc chia sẻ của người khác (nhãn urgent)", async () => {
  await menuBtn().click();
  await page.locator(".sf-apply", { hasText: "Việc gấp của nhóm" }).click();
  await page.waitForFunction(() => document.querySelector(".gantt-wrap .sf-select > .tf-btn")?.textContent.includes("Việc gấp của nhóm"));
  const rows = await page.$$eval(".wbs-row-match", (r) => r.map((x) => x.textContent));
  assert.ok(rows.length === 1 && rows[0].includes("DEMO-3"), rows.join("|"));
});
await step("bộ lọc của người khác chỉ áp dụng được — không có nút sửa/xoá", async () => {
  await menuBtn().click();
  const item = page.locator(".sf-item", { hasText: "Việc gấp của nhóm" });
  assert.equal(await item.locator(".sf-actions").count(), 0);
  await page.keyboard.press("Escape");
});
await step("tab Nguồn lực có cùng menu và thấy bộ lọc đã lưu", async () => {
  await page.locator(".toolbar-tabs button", { hasText: "Nguồn lực" }).click();
  await page.waitForSelector(".resource-view .sf-select");
  await page.locator(".resource-view .sf-select > .tf-btn").click();
  const names = await page.$$eval(".sf-apply", (r) => r.map((x) => x.textContent));
  assert.ok(names.includes("Phần việc riêng") && names.includes("Việc gấp của nhóm"), names.join("|"));
  await page.keyboard.press("Escape");
});
await step("đổi sang riêng tư rồi xoá bộ lọc của mình", async () => {
  await page.locator(".toolbar-tabs button", { hasText: "Gantt" }).click();
  await page.waitForSelector(".gantt-wrap .sf-select");
  await menuBtn().click();
  const mine = page.locator(".sf-item", { hasText: "Phần việc riêng" });
  await mine.locator(".text-btn", { hasText: "Chia sẻ" }).click();
  await mine.locator(".text-btn", { hasText: "Riêng tư" }).waitFor();
  await mine.locator(".sf-delete").click();
  await page.locator(".dlg button.danger-solid").click();
  await page.waitForFunction(() => ![...document.querySelectorAll(".sf-apply")].some((b) => b.textContent === "Phần việc riêng"));
});

console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
await browser.close();
process.exit(failed ? 1 : 0);
