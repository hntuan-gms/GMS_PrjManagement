// The task detail: a layer over the page in two panes (what the work is on the left, where it stands on the
// right), values that are text until pressed, a title that wraps, counts instead of empty boxes (an empty
// section is one "+" button), attachments you can open / download / delete, quick time-logging behind a button.
// Client against the stand-in API.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
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
async function openTask(id = "DEMO-5") {
  await fetch(API + "/api/__restore", { method: "POST" });
  await page.goto(process.env.E2E_APP ?? "http://localhost:5173/");
  await page.waitForSelector(".wbs-row");
  await page.locator(".wbs-row", { hasText: id }).dblclick();
  await page.waitForSelector(".modal-detail .modal-id");
}
const section = (title) => page.locator(".td-section", { has: page.locator(".td-section-title", { hasText: title }) });
const hint = async (title) => (await section(title).locator(".td-section-hint").textContent()).trim();

console.log("\n== Tiêu đề ==");
await openTask();
await step("tiêu đề dài xuống dòng, không bị cắt, và Enter không tạo dòng mới", async () => {
  const title = page.locator(".td-title");
  const one = (await title.boundingBox()).height;
  const long = "Một tiêu đề rất dài để xem nó xuống dòng chứ không bị cắt ở mép ô nhập " + "chữ ".repeat(30);
  await title.fill(long);
  const many = (await title.boundingBox()).height;
  assert.ok(many > one * 1.8, `chiều cao ${one} → ${many}`);
  assert.equal(await title.evaluate((el) => el.scrollHeight <= el.clientHeight + 1), true, "vẫn bị cuộn/cắt");
  await title.fill("Dòng một\ndòng hai");
  assert.equal(await title.inputValue(), "Dòng một dòng hai", "xuống dòng dán vào phải thành khoảng trắng");
  await title.press("Escape");
});

console.log("\n== Các thẻ bên trái ==");
await openTask();
await step("số đếm nằm ở tiêu đề thẻ; thẻ trống không có mặt (chỉ có nút +); không còn nhãn lặp", async () => {
  assert.equal(await hint("Đính kèm"), "2");
  await section("Liên kết Jira").locator(".td-section-hint").waitFor();
  assert.equal(await hint("Liên kết Jira"), "1");
  // A section with nothing in it is not drawn: one "+" button stands for it.
  assert.equal(await section("Phụ thuộc lịch").count(), 0);
  assert.equal(await page.locator(".td-add-row button", { hasText: "Phụ thuộc" }).count(), 1);
  const text = await page.locator(".td-left").innerText();
  for (const gone of ["Phụ thuộc (predecessors)", "Liên kết Jira (issue links)", "Không có"]) assert.ok(!text.includes(gone), `còn "${gone}"`);
});
await step("form liên kết gập sẵn; bấm '+ Thêm liên kết' mới mở, Esc chỉ đóng form chứ không đóng cửa sổ", async () => {
  assert.equal(await page.locator(".att-link-add").count(), 0);
  await page.getByRole("button", { name: "Thêm liên kết" }).click();
  await page.locator(".att-link-add input").first().waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".att-link-add").count(), 0);
  assert.equal(await page.locator(".modal-detail").count(), 1, "Esc đã đóng cả cửa sổ chi tiết");
});

await openTask("DEMO-1");
await step("việc không có gì: ba nút '+' thay cho ba form; bấm mới mở đúng phần đó", async () => {
  assert.equal(await page.locator(".td-add-row button").count(), 3);
  assert.equal(await page.locator(".att-drop, .pred-add, .att-add-link").count(), 0, "form trống vẫn chiếm chỗ");
  await page.locator(".td-add-row button", { hasText: "Phụ thuộc" }).click();
  await page.locator(".pred-add").waitFor();
  assert.equal(await page.locator(".td-add-row button").count(), 2);
  await page.locator(".td-add-row button", { hasText: "Đính kèm" }).click();
  await page.locator(".att-drop").waitFor();
  await page.locator(".td-add-row button", { hasText: "Liên kết" }).click();
  await section("Liên kết Jira").locator(".pred-add").waitFor();
  assert.equal(await page.locator(".td-add-row").count(), 0, "cả ba đã mở thì không còn hàng nút");
});

console.log("\n== Tệp đính kèm ==");
await openTask();
await step("mỗi tệp có xem / tải về / xoá; ảnh hiện thumbnail", async () => {
  const row = page.locator(".att-row", { hasText: "man-hinh-dang-nhap.png" });
  await row.locator("img.att-thumb").waitFor();
  const names = async (r) => (await r.locator(".att-actions button").evaluateAll((b) => b.map((x) => x.getAttribute("title"))));
  assert.deepEqual(await names(row), ["Xem", "Tải về", "Xoá"]);
  // A PDF has nothing to preview: only download and delete.
  assert.deepEqual(await names(page.locator(".att-row", { hasText: "dac-ta.pdf" })), ["Tải về", "Xoá"]);
});
await step("bấm vào ảnh mở khung xem vừa phải; Esc chỉ đóng ảnh, cửa sổ chi tiết còn nguyên", async () => {
  await page.locator(".att-row", { hasText: "man-hinh-dang-nhap.png" }).locator(".att-open").click();
  const img = page.locator(".lightbox img");
  await img.waitFor();
  const box = await img.boundingBox();
  assert.ok(box.width >= 200 && box.width <= 1000 && box.height <= 800, JSON.stringify(box));
  await page.keyboard.press("Escape");
  await page.locator(".lightbox").waitFor({ state: "detached" });
  assert.equal(await page.locator(".modal-detail").count(), 1);
  assert.equal(await page.locator(".dlg").count(), 0, "Esc đã kích hoạt hỏi 'Bỏ thay đổi?'");
});
await step("bấm ra ngoài ảnh cũng đóng ảnh", async () => {
  await page.locator(".att-row", { hasText: "man-hinh-dang-nhap.png" }).locator(".att-open").click();
  await page.locator(".lightbox img").waitFor();
  await page.mouse.click(5, 5);
  await page.locator(".lightbox").waitFor({ state: "detached" });
});
await step("tải về một tệp", async () => {
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".att-row", { hasText: "dac-ta.pdf" }).locator('.att-act[title="Tải về"]').click(),
  ]);
  assert.equal(dl.suggestedFilename(), "dac-ta.pdf");
});
await step("xoá một tệp: hỏi trước, huỷ thì giữ, đồng ý thì mất khỏi danh sách và số đếm giảm", async () => {
  const pdf = page.locator(".att-row", { hasText: "dac-ta.pdf" });
  await pdf.locator('.att-act[title="Xoá"]').click();
  await page.locator(".dlg").waitFor();
  await page.locator(".dlg button", { hasText: "Huỷ" }).click();
  assert.equal(await pdf.count(), 1);
  await pdf.locator('.att-act[title="Xoá"]').click();
  await page.locator(".dlg button.danger-solid").click();
  await pdf.waitFor({ state: "detached" });
  assert.equal(await hint("Đính kèm"), "1");
});

console.log("\n== Bình luận ==");
await openTask();
await step("thẻ bình luận không còn tiêu đề gập lặp lại; ô viết gọn một dòng cho tới khi dùng; câu 'chưa có' nằm trên ô nhập", async () => {
  assert.equal(await page.locator(".td-section-title", { hasText: "Bình luận" }).count(), 0, "còn tiêu đề gập 'Bình luận & lịch sử'");
  assert.equal(await page.getByRole("tab", { name: /Bình luận/ }).count(), 1);
  assert.equal(await page.locator(".modal-footer").count(), 0, "không còn chân khung với nút Lưu");
  const slim = (await page.locator(".td-box").boundingBox()).height;
  assert.ok(slim < 60, `ô bình luận chưa dùng cao ${slim}px`);
  assert.equal(await page.locator(".td-box-actions").isVisible(), false, "nút Gửi hiện khi chưa dùng ô");
  await page.locator(".td-box .ProseMirror").click();
  await page.locator(".td-box-actions .primary").waitFor();
  assert.ok((await page.locator(".td-box").boundingBox()).height > slim + 30, "ô không mở rộng khi dùng");
  const empty = await page.locator(".td-muted", { hasText: "Chưa có bình luận nào." }).boundingBox();
  const box = await page.locator(".td-box").boundingBox();
  assert.ok(empty.y < box.y, "câu 'chưa có bình luận' nằm dưới ô nhập");
});
await step("Liên kết Jira không kèm đoạn hướng dẫn: tên thẻ đã phân biệt nó với Phụ thuộc lịch", async () => {
  const text = await page.locator(".td-left").innerText();
  assert.ok(!text.includes("Chỉ để tham khảo"), text.slice(0, 80));
});

console.log("\n== Khung bên phải ==");
await openTask();
await step("ghi giờ: form gập sẵn, mở bằng '+ Ghi giờ' ngay cạnh 'Đã ghi'", async () => {
  assert.equal(await page.locator("#td-logform").count(), 0);
  const spent = await page.locator(".td-spent-row .time-spent").boundingBox();
  const btn = await page.locator(".td-logtoggle").boundingBox();
  assert.ok(Math.abs(spent.y - btn.y) < 24, "nút nằm lệch hàng với 'Đã ghi'");
  await page.locator(".td-logtoggle").click();
  await page.locator("#td-logform .log-hours").waitFor();
});
await step("Lịch là chữ tại chỗ: bấm Kết thúc để sửa, đổi thì thời lượng đổi theo; đổi thời lượng thì Kết thúc đổi theo", async () => {
  const sched = page.locator(".tdx-sched");
  const startText = (await sched.locator(".tdx-val").first().innerText()).trim();
  const [d, m, y] = startText.split("/").map(Number);
  const plus = (n) => {
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return `${String(t.getUTCDate()).padStart(2, "0")}/${String(t.getUTCMonth() + 1).padStart(2, "0")}/${t.getUTCFullYear()}`;
  };
  assert.equal(await sched.locator("input").count(), 0, "lịch đang vẽ ô nhập khi chưa bấm");
  await sched.locator(".tdx-val[aria-label='Ngày kết thúc']").click();
  const end = sched.locator("input[aria-label='Ngày kết thúc']");
  await end.fill(plus(6));
  await end.press("Tab");
  await sched.locator(".tdx-val[aria-label='Thời lượng (ngày)']", { hasText: "7 ngày" }).waitFor();
  await sched.locator(".tdx-val[aria-label='Thời lượng (ngày)']").click();
  const dur = sched.locator("input[aria-label='Thời lượng (ngày)']");
  await dur.fill("3");
  await dur.press("Enter");
  await sched.locator(".tdx-val[aria-label='Ngày kết thúc']", { hasText: plus(2) }).waitFor();
});
await step("ước lượng và 'Đã ghi' cùng một dòng", async () => {
  const est = await page.locator("[data-prop=estimate] .tdx-val").boundingBox();
  const spent = await page.locator(".td-effort .td-spent-row").boundingBox();
  assert.ok(Math.abs(spent.y - est.y) < 24, JSON.stringify([est, spent]));
});
await step("facts: tên và giá trị cùng một dòng, nhãn thẳng cột", async () => {
  const xs = new Set();
  for (const name of ["progress", "estimate", "type", "parent", "labels", "sprint"]) {
    const row = page.locator(`[data-prop=${name}]`);
    const label = await row.locator(".tdx-label").boundingBox();
    const value = await row.locator(".tdx-value").boundingBox();
    assert.ok(value.x > label.x + 60 && value.y < label.y + label.height + 12 && label.y < value.y + 40, `${name}: ${JSON.stringify([label, value])}`);
    xs.add(Math.round(value.x));
  }
  assert.equal(xs.size, 1, "giá trị không thẳng cột: " + [...xs]);
});
await step("hai khung cuộn riêng: trái và phải cuộn bằng thanh mảnh, khung ngoài không cuộn", async () => {
  for (const sel of [".td-left", ".td-right"]) {
    const c = await page.locator(sel).evaluate((el) => ({ w: getComputedStyle(el).scrollbarWidth, o: getComputedStyle(el).overflowY }));
    assert.equal(c.w, "thin", sel);
    assert.equal(c.o, "auto", sel);
  }
  assert.equal(await page.locator(".peek-panel").evaluate((el) => getComputedStyle(el).overflow), "hidden");
});
await step("ở 440px: một cột, trạng thái lên trước, không tràn ngang, nhãn vẫn cùng dòng với giá trị", async () => {
  await page.setViewportSize({ width: 440, height: 900 });
  await page.waitForTimeout(200);
  const over = await page.locator(".peek-panel").evaluate((el) => el.scrollWidth - el.clientWidth);
  assert.ok(over <= 1, `khung tràn ngang ${over}px`);
  const right = await page.locator(".td-right").boundingBox();
  const left = await page.locator(".td-left").boundingBox();
  assert.ok(right.y < left.y, "trạng thái phải nằm trên khi hẹp");
  for (const name of ["progress", "labels"]) {
    const row = page.locator(`[data-prop=${name}]`);
    const label = await row.locator(".tdx-label").boundingBox();
    const value = await row.locator(".tdx-value").boundingBox();
    assert.ok(value.x > label.x + 40 && Math.abs(value.y - label.y) < 24, `${name}: ${JSON.stringify([label, value])}`);
  }
  await page.setViewportSize({ width: 1400, height: 900 });
});

console.log("\n== Ô nhập: chữ cho tới khi bấm ==");
await openTask("DEMO-1");
await step("mô tả không vẽ ô nhập khi chưa bấm; bấm mới thành ô, tự giãn, không nút kéo, không gạch đỏ chính tả", async () => {
  const read = page.locator(".tdx-desc");
  const rest = await read.evaluate((el) => ({ border: getComputedStyle(el).borderTopWidth, bg: getComputedStyle(el).backgroundColor }));
  assert.equal(rest.border, "0px", "mô tả có viền khi chưa bấm");
  assert.equal(await page.locator(".tdx-desc-edit .ProseMirror").count(), 0);
  await read.click();
  const area = page.locator(".tdx-desc-edit .ProseMirror");
  await area.waitFor();
  assert.equal(await area.evaluate((el) => el.spellcheck), false);
  await area.fill("Nháp không lưu");
  await area.press("Escape");
  await page.locator(".tdx-desc-edit").waitFor({ state: "detached" });
  assert.equal(await page.locator(".modal-detail").count(), 1, "Esc khi đang sửa mô tả đã đóng cả khung");
  assert.ok(!(await read.innerText()).includes("Nháp không lưu"), "bản nháp bị Esc phải bị bỏ");
});
await step("ô bình luận: cùng một viền và một vòng focus cho cả ô và nút", async () => {
  await page.locator(".td-box .ProseMirror").focus();
  const ring = await page.locator(".td-box").evaluate((el) => getComputedStyle(el).boxShadow);
  assert.notEqual(ring, "none");
});

console.log("\n== Chờ đủ rồi mới hiện ==");
await step("chi tiết chưa tải đủ: chỉ có vòng xoay (khung đã đủ cỡ), đủ rồi mới hiện cả khung một lần", async () => {
  await fetch(API + "/api/__restore", { method: "POST" });
  await page.route("**/api/tasks/*/comments", async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });
  await page.goto(process.env.E2E_APP ?? "http://localhost:5173/");
  await page.waitForSelector(".wbs-row");
  await page.locator(".wbs-row", { hasText: "DEMO-5" }).dblclick();
  await page.locator(".td-loading .spinner").waitFor();
  await page.waitForTimeout(400); // the layer's own fade-in
  const loadingBox = await page.locator(".modal-detail").boundingBox();
  assert.equal(await page.locator(".td-cols").count(), 0, "đã hiện nội dung khi chưa tải đủ");
  assert.equal(await page.locator(".modal-detail .modal-id").count(), 0, "đã hiện mã việc khi chưa tải đủ");
  assert.equal(await page.locator(".td-title").count(), 0, "đã hiện tên khi chưa tải đủ");
  await page.locator(".td-cols").waitFor();
  assert.equal(await page.locator(".td-loading").count(), 0, "vòng xoay còn sau khi đã đủ");
  // Everything is there on the first frame it appears, not filled in later.
  for (const sel of [".td-title", ".td-tabs", ".td-box", "[data-prop=labels]", ".td-right .tdx-chips"]) assert.equal(await page.locator(sel).count() > 0, true, sel);
  const doneBox = await page.locator(".modal-detail").boundingBox();
  assert.deepEqual(doneBox, loadingBox, "khung đổi kích thước khi nội dung hiện ra");
  await page.unroute("**/api/tasks/*/comments");
});

console.log("\n== Mở một phần mới ==");
await openTask("DEMO-3");
await step("bấm '+ Phụ thuộc': phần mới hiện đúng chỗ nút vừa bấm, phần trên không xê dịch, ô đầu được trỏ tới", async () => {
  const top = (sel) => page.locator(sel).evaluate((el) => Math.round(el.getBoundingClientRect().top));
  await page.waitForTimeout(400); // the sections' own fade-in
  const linkBefore = await top("[data-section=link]");
  const addBefore = await top(".td-add-row");
  await page.locator(".td-add-row button", { hasText: "Phụ thuộc" }).click();
  await page.locator("[data-section=pred]").waitFor();
  await page.waitForTimeout(400);
  const linkAfter = await top("[data-section=link]");
  const predTop = await top("[data-section=pred]");
  assert.ok(Math.abs(linkAfter - linkBefore) <= 1, `phần phía trên bị đẩy: ${linkBefore} → ${linkAfter}`);
  assert.ok(Math.abs(predTop - addBefore) <= 6, `phần mới không nằm ở chỗ nút: nút ${addBefore}, phần ${predTop}`);
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest("[data-section=pred]")), true, "ô đầu của phần mới không được trỏ tới");
});
await step("phần có dữ liệu đầu tiên không nhảy lên trên các phần khác", async () => {
  const order = () => page.$$eval(".tdx-related .td-section", (s) => s.map((x) => x.getAttribute("data-section")));
  const before = await order();
  assert.deepEqual(before, ["link", "pred"]);
  await page.locator("[data-section=pred] .td-add-btn").click();
  await page.locator(".cell-picker input").fill("DEMO-5");
  await page.locator(".cell-picker-item", { hasText: "DEMO-5" }).first().click();
  await page.locator("[data-section=pred] .pred-list li").waitFor();
  assert.deepEqual(await order(), ["link", "pred"], "phần Phụ thuộc đổi chỗ khi có mục đầu tiên");
});

console.log("\n== Lớp phủ ==");
await step("chi tiết là một lớp giữa màn hình: rộng, hai khung cạnh nhau, bảng phía sau không bị dồn", async () => {
  await page.keyboard.press("Escape");
  await page.waitForSelector(".modal-detail", { state: "detached" });
  const before = await page.locator(".wbs-row", { hasText: "DEMO-6" }).first().locator(".wbs-col-name").evaluate((el) => el.getBoundingClientRect().width);
  await page.locator(".wbs-row", { hasText: "DEMO-5" }).dblclick();
  await page.waitForSelector(".modal-detail");
  await page.waitForTimeout(300);
  const after = await page.locator(".wbs-row", { hasText: "DEMO-6" }).first().locator(".wbs-col-name").evaluate((el) => el.getBoundingClientRect().width);
  assert.ok(Math.abs(after - before) < 1, `bảng bị dồn: ${before} → ${after}`);
  const panel = await page.locator(".modal-detail").boundingBox();
  assert.ok(panel.width >= 1100, `khung chỉ rộng ${panel.width}px`);
  assert.ok(Math.abs(panel.x + panel.width / 2 - 700) < 80, "khung không nằm giữa màn hình");
  const l = await page.locator(".td-left").boundingBox();
  const r = await page.locator(".td-right").boundingBox();
  assert.ok(l.x + l.width <= r.x + 1 && Math.abs(l.y - r.y) < 2 && Math.abs(l.height - r.height) < 2, JSON.stringify([l, r]));
  assert.ok(l.width > r.width * 1.6, "khung trái phải rộng hơn hẳn khung phải");
  assert.equal(await page.locator(".modal-detail").getAttribute("aria-modal"), "true");
});
await step("bấm vào nền mờ quanh khung thì đóng", async () => {
  await page.mouse.click(8, 450);
  await page.waitForSelector(".modal-detail", { state: "detached" });
});

assert.equal(problems.length, 0, "lỗi trong trình duyệt: " + problems.join("; "));
await fetch(API + "/api/__restore", { method: "POST" });
await browser.close();
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
process.exit(failed ? 1 : 0);
