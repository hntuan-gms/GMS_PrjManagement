// Phase 2 / stage 2: task detail (components, versions, parent, type, issue links,
// watchers), the new filters (components, versions, sprints, JQL, and saved ones holding them),
// milestones and releases on the timeline, undo, and import. Behaviour of the client
// against the stand-in API — what Jira does with these writes is the checklist's job.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { ioAction, openDisplay, pickFacet } from "./toolbar.mjs";

const API = process.env.E2E_API ?? "http://localhost:4000";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.setDefaultTimeout(8000);
const problems = [];
const dialogs = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
// A refused request logs a line of its own; the 400s here are the point of two steps (a bad link, a bad JQL).
page.on("console", (m) => m.type() === "error" && !m.text().includes("400 (Bad Request)") && problems.push("console: " + m.text()));
// Anything that asks first (a confirm) is answered yes; the prompts are kept for assertions.
page.on("dialog", async (d) => {
  dialogs.push(d.message());
  await d.accept();
});
let failed = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log("  ok  ", name);
  } catch (e) {
    failed++;
    console.log("  FAIL", name, "\n       ", String(e.message).split("\n")[0]);
    // Enough to see what the screen was doing without re-running.
    const shown = await page
      .evaluate(() => (document.querySelector(".import-modal, .modal")?.textContent ?? document.querySelector(".tf-bar")?.textContent ?? "").replace(/\s+/g, " ").slice(0, 400))
      .catch(() => "");
    console.log("        màn hình:", shown);
  }
}
const log = async () => (await (await fetch(API + "/api/__log")).json()).log;
const reset = () => fetch(API + "/api/__reset", { method: "POST" });
// Earlier files in the same run change the stand-in API's data (phase1 creates and assigns tasks); this one counts rows.
const restore = () => fetch(API + "/api/__restore", { method: "POST" });
const rowsText = () => page.$$eval(".wbs-row", (r) => r.map((x) => x.textContent));
const count = () => page.textContent(".tf-count");
const clearFilter = async () => {
  if (await page.locator(".tf-clear").count()) await page.locator(".tf-clear").click();
  await page.waitForFunction(() => document.querySelectorAll(".wbs-row").length >= 8);
};
const pick = (label, value) => pickFacet(page, label, value);
// With the JQL panel open it covers the chips, so its own button is the way; shut, the chip's × is.
const dropJql = async () => {
  const inPanel = page.locator(".tf-jql button", { hasText: "Bỏ JQL" });
  if (await inPanel.count()) await inPanel.click();
  else await page.locator(".tf-chip button[aria-label='Bỏ JQL']").click();
};

await restore();
await page.goto(process.env.E2E_APP ?? "http://localhost:5173/");
await page.waitForSelector(".wbs-row");

console.log("\n== Chi tiết task: thành phần, phiên bản, cấu trúc ==");
await step("modal hiện thành phần, phiên bản, sprint của task", async () => {
  await page.locator(".wbs-row", { hasText: "DEMO-5" }).locator(".wbs-col-name").dblclick();
  await page.waitForSelector(".modal .modal-id");
  const chips = await page.$$eval(".name-picker .label-chip", (c) => c.map((x) => x.textContent.replace("×", "").trim()));
  assert.deepEqual(chips, ["Backend", "1.0"]);
  assert((await page.textContent(".modal")).includes("Sprint 7 (đang chạy)"));
});
await step("Epic không chọn được khi task đang có người phụ trách, kèm lý do", async () => {
  const opt = page.locator('.modal select option[value="Epic"]');
  assert.equal(await opt.evaluate((o) => o.disabled), true);
  assert((await opt.textContent()).includes("đang có người phụ trách"));
});
await step("việc cha chỉ gồm việc hợp lệ: không có chính nó và không có Sub-task", async () => {
  const opts = await page.$$eval(".modal .field:has(> span:text-is('Việc cha')) select option", (o) => o.map((x) => x.value));
  assert(opts.includes("DEMO-1") && opts.includes("DEMO-2"), opts.join());
  assert(!opts.includes("DEMO-5"), "không được tự làm cha của mình");
});
await step("issue link của Jira hiện cạnh phụ thuộc, có chiều đúng và ghi chú không dời lịch", async () => {
  const text = await page.locator(".modal .td-section", { has: page.locator(".td-section-title", { hasText: "Liên kết Jira" }) }).textContent();
  assert(text.includes("is blocked by") && text.includes("DEMO-3"), text);
  assert(text.includes("không dời lịch"));
});
await step("thêm liên kết 'relates to' DEMO-7, rồi gỡ", async () => {
  const box = page.locator(".modal .td-section", { has: page.locator(".td-section-title", { hasText: "Liên kết Jira" }) });
  await box.locator("select").selectOption({ label: "relates to" });
  await box.locator("input").fill("DEMO-7");
  await box.locator("button", { hasText: "+ Liên kết" }).click();
  await page.waitForFunction(() => document.querySelector(".modal")?.textContent.includes("relates to") && document.querySelector(".modal")?.textContent.includes("DEMO-7"));
  const posted = (await log()).find((l) => l.m === "POST" && l.p === "/api/tasks/DEMO-5/issue-links");
  assert.deepEqual(posted.b, { typeName: "Relates", otherKey: "DEMO-7", direction: "outward" });
  await box.locator("li", { hasText: "DEMO-7" }).locator("button", { hasText: "gỡ" }).click();
  await page.waitForFunction(() => !document.querySelector(".modal ul.pred-list")?.textContent.includes("DEMO-7"));
});
await step("một mã không có thì Jira từ chối và lỗi hiện ngay tại chỗ", async () => {
  const box = page.locator(".modal .td-section", { has: page.locator(".td-section-title", { hasText: "Liên kết Jira" }) });
  await box.locator("input").fill("DEMO-999");
  await box.locator("button", { hasText: "+ Liên kết" }).click();
  await box.locator(".field-note.is-error").waitFor();
  assert((await box.textContent()).includes("không tìm thấy"));
  await box.locator("input").fill("");
});
await step("theo dõi / bỏ theo dõi chính mình", async () => {
  const box = page.locator(".modal .field:has(> span:text-is('Người theo dõi'))");
  await box.locator("button").click();
  await box.locator("button.is-on").waitFor();
  assert((await box.textContent()).includes("2 người"));
  const put = (await log()).find((l) => l.m === "PUT" && l.p.endsWith("/watchers"));
  assert.deepEqual(put.b, { watching: true });
});
await step("lưu: chỉ gửi những gì đã đổi (thành phần, việc cha)", async () => {
  await reset();
  await page.locator(".name-picker").first().locator("select").selectOption("UI");
  await page.locator(".modal .field:has(> span:text-is('Việc cha')) select").selectOption("DEMO-1");
  await page.locator(".modal-footer .primary").click();
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "PATCH"));
  const patch = (await log()).find((l) => l.m === "PATCH");
  assert.deepEqual(patch.b.components.sort(), ["Backend", "UI"]);
  assert.equal(patch.b.parentKey, "DEMO-1");
  assert.equal(patch.b.fixVersions, undefined, "phiên bản không đổi thì không gửi");
  assert.equal(patch.b.issueType, undefined);
  await page.waitForSelector(".modal", { state: "detached" });
});
await step("task đã nằm dưới Epic mới trên WBS sau khi lưu", async () => {
  const rows = await rowsText();
  const i5 = rows.findIndex((t) => t.includes("DEMO-5"));
  const i1 = rows.findIndex((t) => t.includes("DEMO-1"));
  const i2 = rows.findIndex((t) => t.includes("DEMO-2"));
  assert(i5 > i1 && i5 < i2, `DEMO-5 ở vị trí ${i5}, DEMO-1 ${i1}, DEMO-2 ${i2}`);
});

console.log("\n== Bộ lọc: thành phần, phiên bản, sprint, cột ==");
await step("lọc theo thành phần / phiên bản / sprint", async () => {
  await pick("Thành phần", "UI");
  await page.waitForFunction(() => document.querySelector(".tf-count")?.textContent.includes("1/9")).catch(async () => { throw new Error("đếm: " + (await count().catch(() => "không có"))); });
  assert((await rowsText()).some((t) => t.includes("DEMO-5")));
  await clearFilter();
  await pick("Phiên bản", "1.0");
  await page.waitForFunction(() => document.querySelector(".tf-count")?.textContent.includes("1/9"));
  await clearFilter();
  await pick("Sprint", "Sprint 7");
  await page.waitForFunction(() => document.querySelector(".tf-count")?.textContent.includes("1/9"));
  await clearFilter();
});
await step("cột Sprint, Thành phần, Phiên bản chọn được và có dữ liệu", async () => {
  await openDisplay(page);
  for (const name of ["Sprint", "Thành phần (components)", "Phiên bản (fix versions)"]) {
    await page.locator(".col-chooser-item", { hasText: name }).locator("input").check();
  }
  const row = (await rowsText()).find((t) => t.includes("DEMO-5"));
  assert(row.includes("Sprint 7") && row.includes("Backend") && row.includes("1.0"), row);
  // Back to the default columns: a wide table leaves the chart too little room for the drags below.
  await page.locator(".view-menu .col-chooser-foot button", { hasText: "Mặc định" }).click();
  await page.keyboard.press("Escape");
});

console.log("\n== Bộ lọc đã lưu và JQL ==");
// The menu itself (sharing, @me, rename, delete) is phase3-overlay's; this stage only adds
// components, versions, sprints and JQL to what a saved filter holds.
const openSavedMenu = async () => {
  if (!(await page.locator(".sf-menu").count())) await page.locator(".gantt-wrap .sf-select > .tf-btn").click();
  await page.locator(".sf-menu").waitFor();
};
async function saveCurrentAs(name) {
  await reset();
  await openSavedMenu();
  await page.fill('.sf-form input[type="text"]', name);
  await page.locator(".sf-form .text-btn", { hasText: "Lưu bộ lọc hiện tại" }).click();
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "POST" && l.p === "/api/filters"));
  return (await log()).find((l) => l.m === "POST" && l.p === "/api/filters");
}
async function deleteSaved(name) {
  await openSavedMenu();
  await page.locator(".sf-item", { hasText: name }).locator(".sf-delete").click();
  await page.locator(".dlg button.danger-solid").click();
  await page.waitForFunction((n) => ![...document.querySelectorAll(".sf-apply")].some((b) => b.textContent === n), name);
  await page.keyboard.press("Escape");
}
await step("lưu bộ lọc có thành phần → gửi đúng, áp lại thì khôi phục", async () => {
  await pick("Thành phần", "UI");
  await page.waitForFunction(() => document.querySelector(".tf-count")?.textContent.includes("1/9"));
  const post = await saveCurrentAs("Giao diện");
  assert.deepEqual(post.b.spec.components, ["UI"]);
  assert.equal(post.b.spec.jql, "");
  await page.keyboard.press("Escape");
  await clearFilter();
  await openSavedMenu();
  await page.locator(".sf-apply", { hasText: "Giao diện" }).click();
  await page.waitForFunction(() => document.querySelector(".tf-count")?.textContent.includes("1/9"));
  await deleteSaved("Giao diện");
  await clearFilter();
});
await step("lưu bộ lọc chỉ có JQL → áp lại thì ô JQL có chữ và Jira được hỏi lại", async () => {
  if (!(await page.locator(".tf-jql").count())) await page.locator(".tf-jql-toggle").click();
  await page.fill(".tf-jql input", "assignee = anh");
  await page.locator(".tf-jql button[type=submit]").click();
  await page.waitForFunction(() => document.querySelector(".tf-count")?.textContent.includes("2/9"));
  const post = await saveCurrentAs("Của Anh (JQL)");
  assert.equal(post.b.spec.jql, "assignee = anh");
  await page.keyboard.press("Escape");
  await dropJql();
  await page.waitForFunction(() => !document.querySelector(".tf-clear"));
  await openSavedMenu();
  await page.locator(".sf-apply", { hasText: "Của Anh (JQL)" }).click();
  await page.waitForFunction(() => document.querySelector(".tf-count")?.textContent.includes("2/9"));
  // The JQL panel stays shut when a saved filter brings its query; the chip shows it, the panel edits it.
  assert((await page.textContent(".tf-chip-open")).includes("assignee = anh"));
  await page.locator(".tf-jql-toggle").click();
  assert.equal(await page.inputValue(".tf-jql input"), "assignee = anh");
  await deleteSaved("Của Anh (JQL)");
  await dropJql();
  await page.waitForFunction(() => !document.querySelector(".tf-clear"));
});
await step("JQL: Jira trả khoá, màn hình lọc đúng và nói trả bao nhiêu", async () => {
  if (!(await page.locator(".tf-jql").count())) await page.locator(".tf-jql-toggle").click();
  await page.fill(".tf-jql input", "assignee = anh");
  await page.locator(".tf-jql button[type=submit]").click();
  await page.waitForFunction(() => document.querySelector(".tf-jql-note")?.textContent.includes("Jira trả 2 việc"));
  await page.waitForFunction(() => document.querySelector(".tf-count")?.textContent.includes("2/9"));
  const rows = await rowsText();
  assert(rows.some((t) => t.includes("DEMO-3")) && !rows.some((t) => t.includes("DEMO-6")));
});
await step("JQL sai: báo lỗi của Jira, KHÔNG làm trống biểu đồ", async () => {
  await page.fill(".tf-jql input", "status =");
  await page.locator(".tf-jql button[type=submit]").click();
  await page.locator(".tf-jql-error").waitFor();
  assert((await page.textContent(".tf-jql-error")).includes("JQL không hợp lệ"));
  await page.waitForFunction(() => document.querySelectorAll(".wbs-row").length >= 8);
});
await step("bỏ JQL gỡ hẳn bộ lọc", async () => {
  await dropJql();
  await page.waitForFunction(() => !document.querySelector(".tf-clear"));
});

console.log("\n== Mốc, phiên bản phát hành ==");
await step("mốc (nhãn milestone) có hình thoi trên biểu đồ và ◆ ở bảng", async () => {
  await page.waitForSelector(".milestone-diamond");
  assert.equal(await page.locator(".milestone-diamond").count(), 1);
  assert((await rowsText()).find((t) => t.includes("DEMO-8")).includes("◆"));
});
await step("phiên bản có ngày phát hành vẽ thành đường dọc, có chú thích", async () => {
  await page.waitForSelector(".release-line");
  const titles = await page.$$eval(".release-line title", (t) => t.map((x) => x.textContent));
  assert(titles.some((t) => t.includes("1.0") && t.includes("phát hành")), titles.join(" | "));
});
console.log("\n== Hoàn tác thao tác kéo ==");
/** Drag the bar of the given row horizontally by dx pixels, with real mouse events. */
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
const patchesFor = async (key) => (await log()).filter((l) => l.m === "PATCH" && l.p === `/api/tasks/${key}`);
await step("chưa kéo gì thì nút Hoàn tác bị khoá", async () => {
  assert.equal(await page.locator(".gantt-toolbar button[aria-label='Hoàn tác']").isDisabled(), true);
});
await step("kéo thanh DEMO-7 → lưu; Hoàn tác trả đúng ngày cũ", async () => {
  await reset();
  const original = (await (await fetch(API + "/api/tasks")).json()).find((t) => t.id === "DEMO-7").startDate;
  await dragBar("DEMO-7", 90);
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "PATCH" && l.p === "/api/tasks/DEMO-7"));
  const moved = (await patchesFor("DEMO-7"))[0].b.startDate;
  assert.notEqual(moved, original, "thanh không dời được");
  const undo = page.locator(".gantt-toolbar button[aria-label='Hoàn tác']");
  await page.waitForFunction(() => !document.querySelector(".gantt-toolbar button[title^='Hoàn tác']")?.disabled);
  assert((await undo.getAttribute("title")).includes("dời DEMO-7"));
  await undo.click();
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.filter((l) => l.m === "PATCH" && l.p === "/api/tasks/DEMO-7").length >= 2);
  const patches = await patchesFor("DEMO-7");
  assert.equal(patches.at(-1).b.startDate, original);
  assert.equal(await undo.isDisabled(), true, "đã hoàn tác hết");
});
await step("Ctrl+Z cũng hoàn tác, nhưng không khi đang gõ trong ô nhập", async () => {
  await reset();
  const original = (await (await fetch(API + "/api/tasks")).json()).find((t) => t.id === "DEMO-6").startDate;
  await dragBar("DEMO-6", 90);
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "PATCH" && l.p === "/api/tasks/DEMO-6"));
  await page.waitForFunction(() => !document.querySelector(".gantt-toolbar button[title^='Hoàn tác']")?.disabled);
  // Typing in the search box: Ctrl+Z belongs to that field.
  await page.locator(".tf-search input").click();
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(400);
  assert.equal((await patchesFor("DEMO-6")).length, 1, "Ctrl+Z trong ô tìm kiếm không được hoàn tác bản kế hoạch");
  await page.locator(".gantt-toolbar").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Control+z");
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.filter((l) => l.m === "PATCH" && l.p === "/api/tasks/DEMO-6").length >= 2);
  assert.equal((await patchesFor("DEMO-6")).at(-1).b.startDate, original);
});

console.log("\n== Nhập từ bảng tính ==");
const SHEET = [
  "Tên\tLoại\tBắt đầu\tSố ngày\tViệc cha",
  "Giai đoạn mới\tEpic\t\t\t",
  "Thiết kế màn hình\tStory\t05/11/2026\t3\t1",
  "Việc hỏng ngày\tTask\tmai kia\t\t1",
  "Con của việc hỏng\tTask\t\t\t3",
  "LỖI do Jira\tTask\t\t\t",
  "Việc cuối\tTask\t2026-11-10\t2\tDEMO-2",
].join("\n");
await step("dán từ Excel: tự nhận cột theo tiêu đề, xem trước và chỉ ra dòng lỗi", async () => {
  await ioAction(page, "Nhập công việc");
  await page.fill(".import-modal textarea", SHEET);
  await page.waitForSelector(".import-preview table");
  const mapped = await page.$$eval(".import-map select", (s) => s.map((x) => x.value));
  assert.deepEqual(mapped, ["summary", "issueType", "startDate", "durationDays", "parent"]);
  const bad = await page.$$eval(".import-preview tr.is-bad", (r) => r.map((x) => x.textContent));
  assert.equal(bad.length, 1);
  assert(bad[0].includes("Việc hỏng ngày") && bad[0].includes("không hiểu"), bad[0]);
  assert((await page.textContent(".import-modal")).includes("6 dòng · 5 sẽ được tạo"));
});
await step("nhập: các dòng hợp lệ được tạo, dòng hỏng và con của nó bị chặn, dòng Jira từ chối được báo đúng số dòng", async () => {
  await reset();
  await page.locator(".import-modal button.primary", { hasText: /^Nhập 5/ }).click();
  await page.waitForSelector(".import-result");
  const text = await page.textContent(".import-result");
  assert(text.includes("Đã tạo 3 công việc"), text);
  assert(/Dòng 3[^]*không hiểu/.test(text), "dòng 3 phải bị chặn vì ngày");
  assert(/Dòng 4[^]*chưa được tạo/.test(text), "con của dòng hỏng phải bị chặn");
  assert(/Dòng 5[^]*Jira từ chối/.test(text), "dòng 5 do Jira từ chối");
  const post = (await log()).find((l) => l.p === "/api/tasks/import");
  // Row 2 points at row 1; what is sent is renumbered around the rows that were held back.
  assert.deepEqual(post.b.rows.map((r) => [r.summary, r.parent ?? null]), [
    ["Giai đoạn mới", null], ["Thiết kế màn hình", "#1"], ["LỖI do Jira", null], ["Việc cuối", "DEMO-2"],
  ]);
});
await step("đóng → bảng WBS có các công việc vừa nhập, việc con nằm dưới việc cha", async () => {
  await page.locator(".import-result .primary").click();
  await page.waitForSelector(".import-modal", { state: "detached" });
  await page.waitForFunction(() => [...document.querySelectorAll(".wbs-row")].some((r) => r.textContent.includes("Thiết kế màn hình")));
  const rows = await rowsText();
  const epic = rows.findIndex((t) => t.includes("Giai đoạn mới"));
  const story = rows.findIndex((t) => t.includes("Thiết kế màn hình"));
  assert(epic >= 0 && story === epic + 1, `Epic ${epic}, Story ${story}`);
});
await step("bảng không có cột Tên thì không cho nhập và nói rõ", async () => {
  await ioAction(page, "Nhập công việc");
  await page.fill(".import-modal textarea", "Cột A\tCột B\nxxx\tyyy");
  await page.waitForSelector(".import-map");
  // Headers nobody recognises: the first column is assumed to be the title. Taking that away leaves nothing to import.
  await page.waitForFunction(() => document.querySelector(".import-map select")?.value === "summary");
  await page.locator(".import-map select").first().selectOption("");
  await page.waitForFunction(() => document.querySelector(".import-modal .modal-error")?.textContent.includes("Tên công việc"));
  assert.equal(await page.locator(".import-modal button.primary").isDisabled(), true);
  await page.locator(".import-modal .modal-close").click();
});

console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
console.log("Lỗi console/pageerror:", problems.length ? problems : "không có");
await browser.close();
process.exit(failed || problems.length ? 1 : 0);
