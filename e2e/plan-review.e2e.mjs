// The AI plan's review window: a row's start can be set (and moves what depends on it), and a plan
// that was discarded opens read-only instead of offering edits the server refuses.
// Contract for client/src/components/PlanReviewModal.tsx and routes/ai.ts (MEIKOS26, 2026-11-10:
// monthly windows all drawn on day 1, and five 400s typing into a discarded plan).
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = process.env.E2E_APP ?? "http://localhost:5173/?view=gantt";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
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
    console.log("  FAIL", name, "\n       ", String(e.message).split("\n").slice(0, 8).join("\n        "));
    if (process.env.E2E_SHOT) await page.screenshot({ path: `${process.env.E2E_SHOT}/plan-review-fail-${failed}.png` }).catch(() => {});
  }
}

const pad = (n) => String(n).padStart(2, "0");
const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plusDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localIso(d);
};
const dmy = (iso) => iso.split("-").reverse().join("/");
const TODAY = localIso(new Date());
const planPatches = async () =>
  (await (await fetch(API + "/api/__log")).json()).log.filter((l) => l.m === "PATCH" && l.p.startsWith("/api/ai/plans/"));

const modal = page.locator(".ai-modal");
const rowOf = (summary) => modal.locator(".ai-table tbody tr", { has: page.locator(`input[value='${summary}']`) });
const startOf = async (summary) => rowOf(summary).locator("td").nth(4).locator("input[type=text]").inputValue();

async function openPlan() {
  await page.locator(".chat-plan-card").last().click();
  await page.waitForSelector(".ai-modal .ai-table tbody tr");
}

await page.goto(APP);
await page.waitForSelector(".toolbar");
await page.keyboard.press("Control+j");
await page.waitForSelector(".chat-dock .chat-composer textarea");
await page.fill(".chat-composer textarea", "Lập kế hoạch dự án Website bán hàng cho Công ty ABC.");
await page.keyboard.press("Enter");
await page.waitForSelector(".chat-plan-card");
await page.waitForFunction(() => !document.querySelector(".chat-send.is-stop"));

await step("Đặt ngày bắt đầu cho một dòng: dòng đó và việc phụ thuộc nó dời theo", async () => {
  await openPlan();
  const first = "Họp khởi động với khách hàng"; // 2 ngày, không phụ thuộc
  const next = "Khảo sát quy trình bán hàng hiện tại"; // FS sau dòng trên
  assert.equal(await startOf(first), dmy(TODAY));
  const target = plusDays(TODAY, 7);
  const box = rowOf(first).locator(".ai-start-field input[type=text]");
  await box.fill(dmy(target));
  await box.press("Enter");
  await page.waitForFunction(
    ([s, v]) =>
      [...document.querySelectorAll(".ai-modal .ai-table tbody tr")].some(
        (tr) => tr.querySelector(`input[value='${s}']`) && tr.querySelectorAll("td")[4].querySelector("input[type=text]")?.value === v
      ),
    [first, dmy(target)]
  );
  assert.equal(await startOf(next), dmy(plusDays(target, 2)));
  const sent = (await planPatches()).at(-1);
  assert.deepEqual(sent.b, { notBefore: target }, "chỉ gửi ngày bắt đầu");
});

await step("Kế hoạch đã huỷ mở ra ở dạng chỉ đọc, không gửi sửa đổi nào", async () => {
  await modal.locator(".modal-footer button.danger").click();
  await page.locator(".dlg button.danger-solid").click();
  await page.waitForSelector(".ai-modal", { state: "detached" });
  const before = (await planPatches()).length;

  await openPlan();
  await modal.locator(".notice", { hasText: "đã huỷ" }).waitFor();
  assert.equal(await modal.locator(".ai-table input:not([disabled]), .ai-table select:not([disabled])").count(), 0, "không còn ô sửa");
  assert.equal(await modal.locator(".ai-table button").count(), 0, "không còn nút bỏ dòng");
  assert.equal(await modal.locator(".modal-footer .primary, .modal-footer .danger").count(), 0, "không còn Duyệt/Huỷ");
  await modal.locator(".modal-footer button", { hasText: "Đóng" }).click();
  await page.waitForSelector(".ai-modal", { state: "detached" });
  assert.equal((await planPatches()).length, before);
});

await step("Không có lỗi trang", async () => {
  assert.deepEqual(problems, []);
});

await browser.close();
if (failed) {
  console.log(`plan-review: ${failed} failed`);
  process.exit(1);
}
