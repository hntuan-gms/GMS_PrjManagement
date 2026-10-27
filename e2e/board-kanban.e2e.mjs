// The Bảng tab's Kanban refinements: switching Scrum -> Kanban from the Backlog (it used to leave
// a blank page until F5), the board switcher, filters without a Trạng thái facet, folding empty
// columns, adding a card from any column, and compact cards.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
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
const tab = (name) => page.locator(".toolbar-tabs button", { hasText: name }).click();
const log = async () => (await (await fetch(API + "/api/__log")).json()).log;
const head = (name) => page.locator(".bd-colhead", { hasText: name }).first();

await page.goto(process.env.E2E_APP ?? "http://localhost:5173/");
await page.waitForSelector(".wbs-row");

console.log("\n== Đổi board ==");
await step("từ Backlog của board Scrum đổi sang Kanban: bảng hiện ra, không trắng trơn", async () => {
  await tab("Bảng");
  await page.waitForSelector(".bd-card");
  await page.locator(".bd-seg button", { hasText: "Backlog" }).click();
  await page.waitForSelector(".bl-row");
  await page.locator(".bd-switcher").click();
  assert.equal(await page.locator(".bd-switch-item").count(), 2, "phải liệt kê cả hai board");
  await page.locator(".bd-switch-item", { hasText: "Kanban" }).click();
  await page.waitForSelector(".bd-board .bd-card");
  assert.ok((await page.textContent(".bd-switcher")).includes("Bảng Kanban DEMO"));
  assert.equal(await page.locator(".bd-seg").count(), 0, "board Kanban không có Sprint/Backlog");
});
await step("không còn nút ⟳ riêng; có 'Mở trên Jira'", async () => {
  const right = await page.textContent(".bd-top-right");
  assert.ok(!right.includes("⟳"), right);
  assert.equal(await page.locator(".bd-top-right button").count(), 0);
  assert.ok(right.includes("Mở trên Jira"));
});
await step("đổi lại Scrum rồi về Kanban vẫn hiện (không kẹt ở trạng thái cũ)", async () => {
  await page.locator(".bd-switcher").click();
  await page.locator(".bd-switch-item", { hasText: "Scrum" }).click();
  await page.waitForSelector(".bd-seg");
  await page.locator(".bd-seg button", { hasText: "Backlog" }).click();
  await page.waitForSelector(".bl-row");
  await page.locator(".bd-switcher").click();
  await page.locator(".bd-switch-item", { hasText: "Kanban" }).click();
  await page.waitForSelector(".bd-board .bd-card");
});

console.log("\n== Bộ lọc ==");
await step("không có facet Trạng thái trên board; có Loại/Epic/Nhãn/Ưu tiên", async () => {
  await page.locator(".bd-filters .tf-add").click();
  const names = await page.$$eval(".bd-filters .tf-facet-name", (b) => b.map((x) => x.textContent.trim()));
  assert.deepEqual(names, ["Loại", "Epic", "Nhãn", "Ưu tiên"]);
  await page.keyboard.press("Escape");
});
await step("chọn một giá trị → chip, đếm thẻ, gỡ chip thì hết lọc", async () => {
  await page.locator(".bd-filters .tf-add").click();
  await page.locator(".tf-facet-head", { hasText: "Loại" }).click();
  await page.locator(".tf-facet-body label").first().click();
  await page.keyboard.press("Escape");
  await page.waitForSelector(".bd-filters .tf-chip");
  assert.ok((await page.textContent(".bd-filters .tf-active")).includes("thẻ"));
  await page.locator(".bd-filters .tf-chip-x").first().click();
  await page.waitForFunction(() => !document.querySelector(".bd-filters .tf-active"));
});

console.log("\n== Cột trống ==");
await step("thu gọn cột Backlog (trống) thành dải hẹp, cột khác rộng ra", async () => {
  const before = (await page.locator(".bd-colhead", { hasText: "In Progress" }).boundingBox()).width;
  await head("Backlog").hover();
  await page.getByRole("button", { name: "Thu gọn cột Backlog" }).click();
  await page.waitForSelector(".bd-col.is-folded");
  const w = (await page.locator(".bd-colhead.is-folded").first().boundingBox()).width;
  assert.ok(w >= 38 && w <= 44, "dải thu gọn rộng " + w);
  const after = (await page.locator(".bd-colhead", { hasText: "In Progress" }).boundingBox()).width;
  assert.ok(after >= before, `cột còn lại không rộng ra: ${before} -> ${after}`);
});
await step("cột thu gọn còn sau khi tải lại trang", async () => {
  await page.reload();
  await page.waitForSelector(".wbs-row");
  await tab("Bảng");
  await page.waitForSelector(".bd-col.is-folded");
});
await step("cột có thẻ không có nút thu gọn", async () => {
  assert.equal(await head("In Progress").getByRole("button", { name: /Thu gọn/ }).count(), 0);
});
await step("mở rộng lại bằng nút trên dải", async () => {
  await page.getByRole("button", { name: "Mở rộng cột Backlog" }).first().click();
  await page.waitForFunction(() => !document.querySelector(".bd-col.is-folded"));
});

console.log("\n== Tạo việc ở mọi cột ==");
await step("có '+ Tạo việc' ở mọi cột (hiện khi rê chuột)", async () => {
  assert.equal(await page.locator(".bd-col .bd-add").count(), 5);
  const col = page.locator(".bd-col").nth(2);
  assert.equal(await col.locator(".bd-add").evaluate((e) => getComputedStyle(e).opacity), "0");
  await col.hover();
  await page.waitForFunction(() => getComputedStyle(document.querySelectorAll(".bd-col")[2].querySelector(".bd-add")).opacity === "1");
});
await step("tạo ở cột In Progress → tạo việc rồi chuyển sang cột đó", async () => {
  await page.locator(".bd-col").nth(2).locator(".bd-add").click();
  const area = page.locator(".bd-quick textarea");
  await area.fill("Việc tạo từ cột giữa");
  await fetch(API + "/api/__reset", { method: "POST" });
  await area.press("Enter");
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.p.endsWith("/move")));
  const entries = await log();
  assert.ok(entries.some((l) => l.m === "POST" && l.p === "/api/tasks"));
  const move = entries.find((l) => l.p.endsWith("/move"));
  assert.deepEqual(move.b.toStatusIds, ["2"]);
});

console.log("\n== Thẻ gọn ==");
await step("thẻ dùng icon loại và icon ưu tiên (SVG), không còn ô/ký tự thô", async () => {
  const cards = await page.locator(".bd-card").count();
  assert.equal(await page.locator(".bd-card .bd-card-foot .issue-icon").count(), cards);
  assert.ok((await page.locator(".bd-card .bd-prio svg").count()) > 0, "thiếu icon ưu tiên");
  const prio = await page.locator(".bd-card .bd-prio").first().getAttribute("title");
  assert.ok(prio.startsWith("Ưu tiên: "));
  const text = await page.locator(".bd-card").first().textContent();
  assert.ok(!/[▲▼■]/.test(text), text);
});
await step("mỗi thẻ cao tối đa ~100px (tiêu đề 2 dòng + 1 hàng phụ + chân)", async () => {
  const heights = await page.$$eval(".bd-card", (c) => c.map((x) => x.getBoundingClientRect().height));
  assert.ok(Math.max(...heights) <= 104, "thẻ cao nhất " + Math.max(...heights));
});

console.log("\n== Dự án chỉ có Kanban ==");
await step("không có banner xanh; có ⓘ giải thích và nút tạo board Scrum", async () => {
  await page.route("**/api/board*", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.boards = body.boards.filter((b) => b.type === "kanban");
    await route.fulfill({ response: res, json: body });
  });
  await page.reload();
  await page.waitForSelector(".wbs-row");
  await tab("Bảng");
  await page.waitForSelector(".bd-board .bd-card");
  assert.equal(await page.locator(".bd-fallback").count(), 0, "banner chiếm chiều cao");
  await page.getByRole("button", { name: "Vì sao board này không có Sprint?" }).click();
  const text = await page.textContent(".bd-info-body");
  assert.ok(text.includes("không có Sprint") && text.includes("Tạo board Scrum"));
  await page.keyboard.press("Escape");
});

await fetch(API + "/api/__restore", { method: "POST" });
assert.equal(problems.length, 0, "lỗi trong trình duyệt: " + problems.join("; "));
await browser.close();
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
process.exit(failed ? 1 : 0);
