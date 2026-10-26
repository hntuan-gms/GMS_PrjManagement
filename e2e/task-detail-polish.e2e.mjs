// The task detail window's second pass: a title that wraps, counts instead of empty boxes, attachments
// you can open / download / delete, a link form that stays folded, quick time-logging behind a button,
// and the classification facts one per line. Client against the stand-in API.
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
  await title.press("Enter");
  assert.equal(await title.inputValue(), long, "Enter đã chèn dòng mới");
  await title.fill("Dòng một\ndòng hai");
  assert.equal(await title.inputValue(), "Dòng một dòng hai", "xuống dòng dán vào phải thành khoảng trắng");
});

console.log("\n== Các thẻ bên trái ==");
await openTask();
await step("số đếm nằm ở tiêu đề thẻ; không còn nhãn lặp và ô 'Không có'", async () => {
  assert.equal(await hint("Đính kèm"), "2");
  assert.equal(await hint("Phụ thuộc lịch"), "0");
  assert.equal(await hint("Liên kết Jira"), "1");
  const text = await page.locator(".td-main").innerText();
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
await step("thẻ bình luận không còn tiêu đề gập lặp lại; nút gửi dịu hơn nút Lưu; câu 'chưa có' nằm trên ô nhập", async () => {
  assert.equal(await page.locator(".td-section-title", { hasText: "Bình luận" }).count(), 0, "còn tiêu đề gập 'Bình luận & lịch sử'");
  assert.equal(await page.getByRole("tab", { name: /Bình luận/ }).count(), 1);
  const send = await page.locator(".td-box-actions .primary").evaluate((el) => getComputedStyle(el).backgroundColor);
  const save = await page.locator(".modal-footer .primary").evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.notEqual(send, save, "nút gửi bình luận cùng màu đặc với nút Lưu");
  const empty = await page.locator(".td-muted", { hasText: "Chưa có bình luận nào." }).boundingBox();
  const box = await page.locator(".td-box").boundingBox();
  assert.ok(empty.y < box.y, "câu 'chưa có bình luận' nằm dưới ô nhập");
});
await step("câu hướng dẫn của Liên kết Jira nói đúng chiều: Phụ thuộc lịch nằm bên trên", async () => {
  const text = await page.locator(".td-main").innerText();
  assert.ok(text.includes("“Phụ thuộc lịch” bên trên") && !text.includes("bên dưới"), text.slice(0, 80));
});

console.log("\n== Thanh bên ==");
await openTask();
await step("ghi giờ: form gập sẵn, mở bằng '+ Ghi giờ' ngay cạnh 'Đã ghi'", async () => {
  assert.equal(await page.locator("#td-logform").count(), 0);
  const spent = await page.locator(".td-spent-row .time-spent").boundingBox();
  const btn = await page.locator(".td-logtoggle").boundingBox();
  assert.ok(Math.abs(spent.y - btn.y) < 24, "nút nằm lệch hàng với 'Đã ghi'");
  await page.locator(".td-logtoggle").click();
  await page.locator("#td-logform .log-hours").waitFor();
});
await step("trạng thái không lặp nhãn; ngày kết thúc là giá trị tính ra, không phải ô nhập; ước lượng và đã ghi cùng một hàng", async () => {
  assert.equal(await page.locator(".td-group", { hasText: "Trạng thái" }).first().locator("label:not(.sr-only)").count(), 0);
  assert.equal(await page.locator(".td-calc").evaluate((el) => el.tagName), "OUTPUT");
  const est = await page.locator(".td-pair.is-effort .field").first().boundingBox();
  const spent = await page.locator(".td-pair.is-effort .field").nth(1).boundingBox();
  assert.ok(Math.abs(est.y - spent.y) < 4 && spent.x > est.x + est.width - 2, JSON.stringify([est, spent]));
});
await step("phân loại: tên và giá trị cùng một dòng", async () => {
  for (const label of ["Độ ưu tiên", "Nhãn", "Loại công việc", "Sprint"]) {
    const row = page.locator(".td-row", { has: page.locator(":scope > span", { hasText: new RegExp("^" + label + "$") }) });
    const name = await row.locator(":scope > span").first().boundingBox();
    const value = await row.locator(":scope > :not(span:first-child)").first().boundingBox();
    assert.ok(value.x > name.x + 40 && Math.abs(value.y + value.height / 2 - (name.y + name.height / 2)) < 20, `${label}: ${JSON.stringify([name, value])}`);
  }
});
await step("hai thanh cuộn của cửa sổ là loại mảnh", async () => {
  for (const sel of [".td-main", ".td-side"]) assert.equal(await page.locator(sel).evaluate((el) => getComputedStyle(el).scrollbarWidth), "thin", sel);
});

console.log("\n== Ô nhập ==");
await step("ô mô tả và ô bình luận cùng kiểu ô nhập của ứng dụng: tự giãn theo chữ, không có nút kéo, không gạch đỏ chính tả", async () => {
  for (const sel of [".td-main .field textarea", ".td-box textarea"]) {
    const t = page.locator(sel).first();
    const c = await t.evaluate((el) => ({ resize: getComputedStyle(el).resize, spell: el.spellcheck }));
    assert.equal(c.resize, "none", sel);
    assert.equal(c.spell, false, sel);
  }
  // The comment box and its button share one border and one focus ring.
  await page.locator(".td-box textarea").focus();
  const ring = await page.locator(".td-box").evaluate((el) => getComputedStyle(el).boxShadow);
  assert.notEqual(ring, "none");
});

assert.equal(problems.length, 0, "lỗi trong trình duyệt: " + problems.join("; "));
await fetch(API + "/api/__restore", { method: "POST" });
await browser.close();
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
process.exit(failed ? 1 : 0);
