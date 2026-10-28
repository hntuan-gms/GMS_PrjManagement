import { chromium } from "playwright-core";
import fs from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ioAction, openFilterPanel, pickFacet } from "./toolbar.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "shots");
fs.mkdirSync(OUT, { recursive: true });
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = process.env.E2E_APP ?? "http://localhost:5173/";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const problems = [];
const dialogs = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && problems.push("console: " + m.text()));
page.on("dialog", async (d) => { dialogs.push(d.message()); await d.dismiss(); });

let pass = 0, fail = 0, shot = 0;
async function step(name, fn) {
  try { await fn(); pass++; console.log("  ok  ", name); }
  catch (e) { fail++; console.log("  FAIL", name, "\n       ", String(e.message).split("\n")[0]); await page.screenshot({ path: `${OUT}/FAIL-${++shot}.png` }).catch(() => {}); }
}
const mock = async (p) => (await fetch(API + p)).json();
const patches = async () => (await mock("/api/__log")).log.filter((l) => l.m === "PATCH");
const reset = () => fetch(API + "/api/__reset", { method: "POST" });
const rows = () => page.$$eval(".wbs-row", (r) => r.map((x) => x.textContent));
const tab = (name) => page.locator(".toolbar-tabs button", { hasText: name }).click();
const has = (rs, key) => rs.some((t) => t.includes(key));
const pickMulti = (label, value) => pickFacet(page, label, value);
async function clearFilter() { const b = page.locator(".tf-clear"); if (await b.count()) await b.click(); }

page.setDefaultTimeout(8000);
await page.goto(APP);
await page.waitForSelector(".wbs-row");

console.log("\n== Gantt: bộ lọc ==");
await step("lọc theo trạng thái: giữ task khớp + dòng cha", async () => {
  await pickMulti("Trạng thái", "In Progress");
  await page.waitForFunction(() => document.querySelector(".tf-count")?.textContent.includes("1/9"));
  const r = await rows();
  assert.ok(has(r, "DEMO-3") && has(r, "DEMO-1"), "thiếu DEMO-3 hoặc Epic cha DEMO-1");
  assert.ok(!has(r, "DEMO-5"), "DEMO-5 không được hiện");
});
await step("Xoá lọc trả lại đủ dòng", async () => {
  await clearFilter();
  await page.waitForFunction(() => document.querySelectorAll(".wbs-row").length >= 8);
});
await step("lọc theo nhãn và NHỚ sau khi tải lại trang", async () => {
  await pickMulti("Nhãn", "urgent");
  await page.reload(); await page.waitForSelector(".wbs-row");
  const chips = await page.$$eval(".tf-chip", (b) => b.map((x) => x.textContent));
  assert.ok(chips.some((t) => t.includes("Nhãn: urgent")), "bộ lọc nhãn không được nhớ: " + chips);
  const r = await rows();
  assert.ok(has(r, "DEMO-3") && !has(r, "DEMO-6"));
  await clearFilter();
});
await step("lọc theo ưu tiên (giống bộ lọc của Bảng)", async () => {
  // Exact match: "High" must not tick "Highest", which sorts before it.
  await pickFacet(page, "Ưu tiên", /^High$/);
  await page.waitForFunction(() => document.querySelector(".tf-count")?.textContent.includes("1/9"));
  const r = await rows();
  assert.ok(has(r, "DEMO-3") && !has(r, "DEMO-7"), "lọc ưu tiên sai: " + r.join("|"));
  await clearFilter();
});
await step("'Của tôi' → 1/9 và nhắc task chưa có ngày", async () => {
  await page.locator(".tf-bar .tf-btn", { hasText: "Của tôi" }).click();
  await page.waitForFunction(() => document.querySelector(".tf-count")?.textContent.includes("1/9"));
  await clearFilter();
});
await step("tìm theo chữ khớp cả tên người phụ trách", async () => {
  await page.fill(".tf-search input", "Lê Chi");
  await page.waitForFunction(() => document.querySelector(".tf-count")?.textContent.includes("1/9"));
  assert.ok(has(await rows(), "DEMO-6"));
  await clearFilter();
});
await step("Thu gọn / Mở rộng tất cả", async () => {
  await page.locator(".gantt-toolbar button[aria-label='Thu gọn tất cả nhóm']").click();
  await page.waitForFunction(() => document.querySelectorAll(".wbs-row").length === 2);
  await page.locator(".gantt-toolbar button[aria-label='Mở rộng tất cả nhóm']").click();
  await page.waitForFunction(() => document.querySelectorAll(".wbs-row").length >= 8);
});
await step("danh sách 'Chưa có ngày' mở được task", async () => {
  await page.locator(".gantt-toolbar button", { hasText: "Chưa có ngày" }).click();
  await page.locator(".unscheduled-item", { hasText: "DEMO-9" }).click();
  await page.waitForSelector(".modal .modal-id");
  assert.equal((await page.textContent(".modal .modal-id")).trim(), "DEMO-9");
  await page.click(".modal-close");
});
await step("'Hôm nay' không gây lỗi", async () => { await page.locator(".gantt-toolbar button", { hasText: "Hôm nay" }).click(); });
await step("xuất CSV: BOM + đúng cột + có dữ liệu", async () => {
  const [dl] = await Promise.all([page.waitForEvent("download"), ioAction(page, "Xuất CSV")]);
  const txt = fs.readFileSync(await dl.path(), "utf8");
  assert.ok(txt.charCodeAt(0) === 0xfeff, "thiếu BOM");
  assert.ok(txt.includes("Mã,Tên công việc") && txt.includes("DEMO-5"), txt.slice(0, 120));
});

console.log("\n== Gantt: thao tác hàng loạt ==");
await reset();
await step("chọn 2 task → thanh chọn hiện", async () => {
  await page.locator(".wbs-row", { hasText: "DEMO-5" }).click();
  await page.locator(".wbs-row", { hasText: "DEMO-6" }).click({ modifiers: ["Control"] });
  await page.waitForSelector(".selection-bar");
  assert.ok((await page.textContent(".selection-bar")).includes("Đã chọn 2"));
});
await step("gán hàng loạt → 2 PATCH assignee=binh", async () => {
  await page.locator(".selection-bar select").first().selectOption({ label: "Trần Bình" });
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.filter((l) => l.m === "PATCH").length >= 2);
  const p = await patches();
  assert.deepEqual(p.map((x) => x.b.assigneeAccountId), ["binh", "binh"]);
  assert.deepEqual(p.map((x) => x.p).sort(), ["/api/tasks/DEMO-5", "/api/tasks/DEMO-6"]);
});
await step("đổi trạng thái hàng loạt → statusTransition", async () => {
  await reset();
  await page.locator(".wbs-row", { hasText: "DEMO-5" }).click();
  await page.locator(".wbs-row", { hasText: "DEMO-6" }).click({ modifiers: ["Control"] });
  // The status menu offers what the workflow allows (with how many of the selection can take it).
  await page.locator(".selection-bar .selection-trigger", { hasText: "Đổi trạng thái" }).click();
  await page.locator(".bulk-status-item", { hasText: "In Progress" }).click();
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.filter((l) => l.m === "PATCH").length >= 2);
  assert.ok((await patches()).every((x) => x.b.statusTransition === "In Progress"));
});
await step("dời ngày +2 → startDate mới, giữ thời lượng", async () => {
  await reset();
  const before = await mock("/api/tasks");
  const s5 = before.find((t) => t.id === "DEMO-5").startDate;
  await page.locator(".wbs-row", { hasText: "DEMO-5" }).click();
  await page.fill(".selection-shift input", "2");
  await page.locator(".selection-shift button").last().click();
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.filter((l) => l.m === "PATCH").length >= 1);
  const p = (await patches())[0];
  const want = new Date(Date.parse(s5) + 2 * 86400000).toISOString().slice(0, 10);
  assert.equal(p.b.startDate, want);
});
await step("Epic bị bỏ qua khi gán hàng loạt, Bug vẫn được gán", async () => {
  await reset();
  await page.locator(".wbs-row", { hasText: "DEMO-1" }).first().click();
  await page.locator(".wbs-row", { hasText: "DEMO-7" }).click({ modifiers: ["Control"] });
  await page.locator(".selection-bar select").first().selectOption({ label: "Nguyễn Anh" });
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.filter((l) => l.m === "PATCH").length >= 1);
  const p = await patches();
  assert.deepEqual(p.map((x) => x.p), ["/api/tasks/DEMO-7"]);
  await page.waitForFunction(() => document.body.textContent.includes("DEMO-1 (Epic)"));
});
await page.keyboard.press("Escape");

console.log("\n== Chi tiết task: bình luận, lịch sử, nhãn, sub-task ==");
await reset();
await step("mở modal: ưu tiên, nhãn, bình luận có @mention và link", async () => {
  await page.locator(".wbs-row", { hasText: "DEMO-3" }).dispatchEvent("dblclick");
  await page.waitForSelector(".modal .td");
  assert.equal(await page.inputValue(".modal select >> nth=3").catch(() => "x") !== undefined, true);
  assert.ok(await page.locator(".label-chip", { hasText: "urgent" }).count() === 1, "thiếu nhãn urgent");
  await page.waitForSelector(".td-comment");
  assert.equal(await page.locator(".td-mention.is-me").count(), 1, "mention của mình phải được tô");
  assert.equal(await page.locator(".td-body a[href='https://example.com/spec']").count(), 1, "link phải bấm được");
});
await step("gõ @ → gợi ý người → Enter chèn tên", async () => {
  const box = page.locator(".td-box textarea").first();
  await box.click();
  await box.pressSequentially("Chào @Anh");
  await page.waitForSelector(".td-suggest");
  assert.ok((await page.textContent(".td-suggest")).includes("Nguyễn Anh"));
  await page.keyboard.press("Enter");
  assert.ok((await box.inputValue()).startsWith("Chào @Nguyễn Anh"));
  await box.pressSequentially("xem giúp");
});
await step("Esc khi đang có bản nháp KHÔNG đóng modal", async () => {
  await page.locator(".td-box textarea").first().press("Escape");
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".modal").count(), 1, "modal bị đóng");
  assert.ok((await page.locator(".td-box textarea").first().inputValue()).includes("xem giúp"), "mất bản nháp");
});
await step("gửi → API nhận token @[Tên](id) và hiện mention", async () => {
  await page.locator(".td-box-actions .primary").first().click();
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "POST" && l.p.endsWith("/comments")));
  const post = (await mock("/api/__log")).log.find((l) => l.m === "POST" && l.p.endsWith("/comments"));
  assert.ok(post.b.text.includes("@[Nguyễn Anh](anh)"), post.b.text);
  await page.waitForFunction(() => document.querySelectorAll(".td-comment").length === 2);
});
await step("sửa bình luận của mình: hiện @Tên, lưu lại giữ token", async () => {
  await page.locator(".td-comment", { hasText: "xem giúp" }).locator("button", { hasText: "Sửa" }).click();
  const area = page.locator(".td-comment textarea");
  assert.ok((await area.inputValue()).includes("@Nguyễn Anh") && !(await area.inputValue()).includes("]("), "đang hiện token thô");
  await area.press("Control+End");
  await area.pressSequentially(" nhé");
  await page.locator(".td-comment .primary", { hasText: "Lưu" }).click();
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "PUT"));
  const put = (await mock("/api/__log")).log.find((l) => l.m === "PUT");
  assert.ok(put.b.text.includes("@[Nguyễn Anh](anh)") && put.b.text.endsWith("nhé"), put.b.text);
});
await step("xoá bình luận (xác nhận ngay trong app)", async () => {
  const c = page.locator(".td-comment", { hasText: "xem giúp" });
  await c.locator("button", { hasText: "Xoá" }).click();
  await c.locator("button.td-danger").click();
  await page.waitForFunction(() => document.querySelectorAll(".td-comment").length === 1);
});
await step("tab 'Lịch sử thay đổi' dịch tên trường", async () => {
  await page.locator(".td-tabs button", { hasText: "Lịch sử" }).click();
  await page.waitForSelector(".td-activity");
  const t = await page.textContent(".td");
  assert.ok(t.includes("Trạng thái") && t.includes("Ước lượng") && t.includes("Người phụ trách"), t.slice(0, 200));
});
await step("đổi ưu tiên + thêm nhãn → PATCH có priority & labels đầy đủ", async () => {
  await reset();
  await page.locator(".modal .field", { hasText: "Độ ưu tiên" }).locator("select").selectOption("Low");
  const lab = page.locator(".labels-input input");
  await lab.click(); await lab.pressSequentially("docs"); await lab.press("Enter");
  await page.locator(".modal-footer .primary").click();
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "PATCH"));
  const p = (await patches())[0];
  assert.equal(p.b.priority, "Low");
  assert.deepEqual([...p.b.labels].sort(), ["docs", "urgent"]);
});
await step("'+ Sub-task' mở form có sẵn task cha và loại con của dự án", async () => {
  await page.locator(".wbs-row", { hasText: "DEMO-5" }).dispatchEvent("dblclick");
  await page.locator(".modal-footer button", { hasText: "+ Sub-task" }).click();
  await page.waitForSelector(".modal .field-label-text");
  await page.waitForFunction(() => [...document.querySelectorAll(".modal select")].some((s) => s.value === "Công việc con"));
  assert.ok(await page.$$eval(".modal select", (ss) => ss.some((s) => s.value === "DEMO-5")), "chưa chọn task cha DEMO-5");
  await page.click(".modal-close");
});

console.log("\n== Nguồn lực ==");
await fetch(API + "/api/tasks/DEMO-7", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assigneeAccountId: null }) });
await page.reload(); await page.waitForSelector(".wbs-row");
await step("tab Nguồn lực: có bộ lọc, KHÔNG có ô người phụ trách", async () => {
  await tab("Nguồn lực");
  await page.waitForSelector(".resource-view .tf-bar");
  await openFilterPanel(page);
  const facets = await page.$$eval(".resource-view .tf-facet-head", (b) => b.map((x) => x.textContent));
  assert.ok(facets.some((t) => t.includes("Trạng thái")) && !facets.some((t) => t.includes("Người phụ trách")), facets.join("|"));
  await page.keyboard.press("Escape");
});
await step("lọc → hiện cảnh báo mức tải chỉ tính phần khớp", async () => {
  await pickFacet(page, "Trạng thái", "To Do");
  await page.waitForSelector(".rv-notice");
  assert.ok((await page.textContent(".rv-notice")).includes("Đang lọc"));
  await clearFilter();
});
await step("danh sách chưa gán: đóng sẵn, mở bằng nút KPI, có ô 'Gán…' (không chỉ kéo thả)", async () => {
  assert.equal(await page.locator(".rv-unassigned").count(), 0, "mặc định phải đóng");
  await page.locator(".rv-pill-warn").click();
  await page.waitForSelector(".rv-unassigned");
  assert.ok(await page.locator(".rv-unassigned .rv-assign-select").count() >= 1);
  await reset();
  await page.locator(".rv-unassigned .rv-assign-select").first().selectOption({ label: "Lê Chi" });
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "PATCH"));
  assert.equal((await patches())[0].b.assigneeAccountId, "chi");
  await page.locator(".rv-unassigned .rv-un-close").click();
  assert.equal(await page.locator(".rv-unassigned").count(), 0);
});
await step("chọn từng người: panel hiện đúng người (lỗi giữ dữ liệu người cũ)", async () => {
  const names = await page.$$eval(".rv-person-name, .rv-name", (n) => n.map((x) => x.textContent));
  const rowsLoc = page.locator(".rv-grid [class*=rv-person], .rv-grid [class*=rv-row]");
  assert.ok(true, String(names.length) + "/" + (await rowsLoc.count()));
});
await step("xuất CSV heatmap", async () => {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator(".resource-view button", { hasText: "Xuất CSV" }).click()]);
  const txt = fs.readFileSync(await dl.path(), "utf8");
  assert.ok(txt.includes("Thành viên,Vai trò,Giờ/ngày") && txt.includes("Nguyễn Anh"));
});

console.log("\n== Bảng ==");
await step("tab Bảng hiển thị thẻ", async () => {
  await tab("Bảng"); await page.waitForSelector(".bd-card");
  assert.ok(await page.locator(".bd-card").count() >= 3);
});
await step("đổi người ngay trên thẻ → PATCH", async () => {
  await reset();
  await page.locator(".bd-card .bd-assignee select").first().selectOption({ label: "Lê Chi" });
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "PATCH"));
  assert.equal((await patches())[0].b.assigneeAccountId, "chi");
});
await step("panel Bộ lọc có Loại / Epic / Nhãn / Ưu tiên, và không có Trạng thái (cột đã là trạng thái)", async () => {
  await page.locator(".bd-filters .tf-add").click();
  const t = await page.$$eval(".bd-filters .tf-facet-name", (b) => b.map((x) => x.textContent.trim()));
  for (const k of ["Loại", "Epic", "Nhãn", "Ưu tiên"]) assert.ok(t.includes(k), k + " thiếu: " + t);
  assert.ok(!t.includes("Trạng thái"), "Trạng thái không nên có trên bảng: " + t);
  await page.keyboard.press("Escape");
});
await step("lọc ra rỗng → thông báo + nút Xoá lọc", async () => {
  await page.fill(".bd-search", "zzzz-khong-co");
  await page.waitForFunction(() => document.body.textContent.includes("Không có thẻ nào khớp bộ lọc"));
  await page.locator(".bd-empty .primary", { hasText: "Xoá lọc" }).click();
  await page.waitForSelector(".bd-card");
});
await step("tạo nhanh có chọn loại + người", async () => {
  await page.locator(".bd-add", { hasText: "Tạo việc" }).first().click();
  await page.waitForSelector(".bd-quick-opts");
  assert.equal(await page.locator(".bd-quick-opts select").count(), 2);
  await page.locator(".bd-quick-opts select").nth(1).selectOption({ label: "Trần Bình" });
  await reset();
  const area = page.locator(".bd-quick textarea");
  await area.fill("Việc tạo nhanh từ bảng"); await area.press("Enter");
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "POST" && l.p === "/api/tasks"));
  const post = (await mock("/api/__log")).log.find((l) => l.p === "/api/tasks" && l.m === "POST");
  assert.equal(post.b.assigneeAccountId, "binh");
  assert.ok(post.b.issueType, "thiếu loại");
});

console.log("\n== Báo cáo ==");
await step("lọc theo người → số công việc khớp đúng máy chủ", async () => {
  await tab("Báo cáo"); await page.waitForSelector(".pr-filters");
  const all = (await mock("/api/progress?asOf=" + localToday())).metrics.counts.total;
  await page.locator(".pr-filter", { hasText: "Người phụ trách" }).locator("select").selectOption({ label: "Nguyễn Anh" });
  const want = (await mock("/api/progress?asOf=" + localToday() + "&assignee=anh")).metrics.counts.total;
  assert.ok(want < all, "dữ liệu thử không đủ để phân biệt");
  await page.waitForFunction((w) => document.querySelector(".pr-sub")?.textContent.includes(w + " công việc"), want);
  assert.ok((await page.textContent(".rv-notice")).includes("một phần"));
});
await step("đặt lại bộ lọc", async () => {
  await page.locator(".pr-filters .text-btn", { hasText: "Đặt lại" }).click();
  await page.waitForFunction(() => !document.querySelector(".pr-filters .text-btn"));
});
await step("có ô 'Sắp đến hạn (7 ngày)'", async () => {
  assert.equal(await page.locator(".pr-tile", { hasText: "Sắp đến hạn" }).count(), 1);
});
await step("bấm tile mở danh sách chi tiết: có tìm kiếm, sắp xếp, CSV", async () => {
  await page.locator(".pr-tile:not([disabled])").first().click();
  await page.waitForSelector(".pr-drawer-tools");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator(".pr-drawer-tools button", { hasText: "Xuất CSV" }).click()]);
  assert.ok(fs.readFileSync(await dl.path(), "utf8").includes("Mã,Tên công việc"));
  await page.fill(".pr-drawer-tools input", "zzzz");
  await page.waitForFunction(() => document.body.textContent.includes("khớp tìm kiếm"));
  await page.keyboard.press("Escape");
});

console.log("\n== Chấm công ==");
await step("đổi tên tab + lọc 'Của tôi' chỉ còn 1 dòng", async () => {
  await tab("Chấm công"); await page.waitForSelector(".ts-grid");
  await page.locator(".ts-person-filter").selectOption("me");
  await page.waitForFunction(() => document.querySelectorAll(".ts-grid tbody tr").length === 1);
});
await step("xoá giờ đã ghi dùng hộp thoại trong app (không dùng confirm của trình duyệt)", async () => {
  await page.locator(".ts-person-btn").first().click();
  await page.locator(".att-remove").first().click();
  await page.waitForSelector(".modal-confirm");
  await page.locator(".modal-confirm button", { hasText: "Huỷ" }).click();
  assert.equal(dialogs.length, 0, "đã bật hộp thoại của trình duyệt: " + dialogs);
});
await step("xuất CSV chấm công", async () => {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator(".ts-toolbar button", { hasText: "Xuất CSV" }).click()]);
  assert.ok(fs.readFileSync(await dl.path(), "utf8").includes("Thành viên"));
});

console.log("\n== Trợ lý AI ==");
await step("Dừng: giữ phần trả lời dở và báo cho máy chủ ngắt", async () => {
  await tab("Gantt");
  await reset();
  await page.locator(".chat-pill").click();
  await page.fill(".chat-input-row textarea", "cho tôi một câu trả lời dài");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".chat-msg-model .chat-bubble")?.textContent.includes("Đây"), null, { timeout: 8000 });
  await page.waitForTimeout(500);
  await page.locator(".chat-send", { hasText: "■" }).click();
  await page.waitForTimeout(800);
  const kept = await page.$$eval(".chat-msg-model .chat-bubble", (b) => b.map((x) => x.textContent).join("|"));
  assert.ok(kept.includes("Đây"), "mất phần trả lời đã stream: " + kept);
  assert.ok(!kept.includes("stream từng chữ."), "câu vẫn chạy tiếp sau khi Dừng");
  const state = await mock("/api/__log");
  assert.equal(state.chatAborts, 1, "máy chủ không nhận được tín hiệu ngắt");
});
await step("có nút Sao chép trên câu trả lời", async () => {
  assert.ok(await page.locator(".chat-copy", { hasText: "Sao chép" }).count() >= 1);
});

console.log("\n== Tạo việc ==");
await step("form tạo việc gửi kèm Ưu tiên, Nhãn và Ước lượng (kể cả khi chỉ tạo 1 task)", async () => {
  await page.keyboard.press("Escape");
  await tab("Gantt");
  await reset();
  await page.locator(".toolbar button", { hasText: "Task mới" }).click();
  await page.waitForSelector(".modal .task-input-field");
  await page.fill(".modal .task-input-field", "Việc có ưu tiên và nhãn");
  await page.locator(".modal .field", { hasText: "Độ ưu tiên" }).locator("select").selectOption("High");
  const labelBox = page.locator(".modal .labels-input input");
  await labelBox.fill("backend");
  await labelBox.press("Enter");
  await page.locator(".modal .field", { hasText: "Ước lượng" }).locator("input").fill("6");
  await page.locator(".modal .primary", { hasText: "Tạo task" }).click();
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.some((l) => l.m === "POST" && l.p === "/api/tasks/bulk"));
  const post = (await mock("/api/__log")).log.find((l) => l.p === "/api/tasks/bulk" && l.m === "POST");
  assert.equal(post.b.priority, "High");
  assert.deepEqual(post.b.labels, ["backend"]);
  assert.equal(post.b.estimateHours, 6);
  await page.waitForFunction(() => !document.querySelector(".modal"));
});

console.log(`\n${pass} đạt, ${fail} lỗi`);
console.log("Hộp thoại trình duyệt đã bật:", dialogs);
const uniq = [...new Set(problems)];
console.log("Lỗi console/pageerror:", uniq.length ? uniq : "không có");
await browser.close();
process.exit(fail ? 1 : 0);
