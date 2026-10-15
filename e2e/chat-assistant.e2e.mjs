// The assistant's dock (phase 2 / stage 1): answering again, editing the last
// question, a screen filter set by a sentence, and the cost in money. Streaming
// itself (Dừng, copy) is covered in phase1.e2e.mjs.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.setDefaultTimeout(8000);
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && !m.text().includes("409") && problems.push("console: " + m.text()));
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
const chatPosts = async () => (await (await fetch(API + "/api/__log")).json()).log.filter((l) => l.m === "POST" && l.p === "/api/ai/chat");
const users = () => page.$$eval(".chat-msg-user .chat-bubble", (b) => b.map((x) => x.textContent.trim()));
const models = () => page.$$eval(".chat-msg-model .chat-bubble", (b) => b.map((x) => x.textContent.trim()));
const ask = async (text) => {
  await page.fill(".chat-input-row textarea", text);
  await page.keyboard.press("Enter");
};
const waitModel = (text) => page.waitForFunction((t) => [...document.querySelectorAll(".chat-msg-model .chat-bubble")].some((b) => b.textContent.includes(t)), text);

await fetch(API + "/api/__reset", { method: "POST" });
await page.goto(process.env.E2E_APP ?? "http://localhost:5173/");
await page.waitForSelector(".wbs-row");
await page.locator(".chat-pill").click();
await page.waitForSelector(".chat-input-row textarea");

console.log("\n== Trợ lý: tạo lại, sửa câu hỏi ==");
await step("hỏi một câu → một câu trả lời", async () => {
  await ask("cho tôi biết nhanh tiến độ");
  await waitModel("Trả lời số 1");
  assert((await users()).length === 1 && (await models()).length === 1);
});
await step("chi phí quy ra tiền hiện ở thanh token", async () => {
  await page.waitForFunction(() => /≈/.test(document.querySelector(".chat-token-strip")?.textContent ?? ""));
});
await step("'Tạo lại' → gọi máy chủ với regenerate, câu trả lời cũ được thay (không dồn thêm)", async () => {
  await page.locator(".chat-copy", { hasText: "Tạo lại" }).click();
  await waitModel("Trả lời số 2");
  assert.deepEqual(await models(), ["Trả lời số 2."]);
  assert.deepEqual(await users(), ["cho tôi biết nhanh tiến độ"]);
  const last = (await chatPosts()).at(-1);
  assert(last.b.regenerate === true && last.b.sessionId === "s1", JSON.stringify(last.b));
});
await step("'Sửa' câu hỏi → ô soạn thảo, Esc huỷ mà không mất câu cũ", async () => {
  await page.locator(".chat-msg-user .chat-copy", { hasText: "Sửa" }).click();
  await page.waitForSelector(".chat-edit textarea");
  assert((await page.inputValue(".chat-edit textarea")) === "cho tôi biết nhanh tiến độ");
  await page.locator(".chat-edit textarea").press("Escape");
  await page.waitForSelector(".chat-edit", { state: "detached" });
  assert.deepEqual(await users(), ["cho tôi biết nhanh tiến độ"]);
});
await step("sửa rồi 'Gửi lại' → câu hỏi và câu trả lời cũ đều được thay", async () => {
  await page.locator(".chat-msg-user .chat-copy", { hasText: "Sửa" }).click();
  await page.fill(".chat-edit textarea", "tình hình nhanh của Epic 2");
  await page.locator(".chat-edit-actions .primary").click();
  await waitModel("Trả lời số 3");
  assert.deepEqual(await users(), ["tình hình nhanh của Epic 2"]);
  assert.deepEqual(await models(), ["Trả lời số 3."]);
  const last = (await chatPosts()).at(-1);
  assert(last.b.replaceLast === true && last.b.message === "tình hình nhanh của Epic 2", JSON.stringify(last.b));
});

console.log("\n== Trợ lý: lượt đã ghi lên Jira không làm lại được ==");
await step("sau một lượt có ghi: ẩn 'Tạo lại' và 'Sửa', nói rõ vì sao", async () => {
  await ask("tạo giúp tôi một việc nhanh");
  await waitModel("Trả lời số 4");
  await page.waitForSelector(".chat-copy-off");
  assert((await page.locator(".chat-copy", { hasText: "Tạo lại" }).count()) === 0, "Tạo lại vẫn hiện");
  assert((await page.locator(".chat-msg-user .chat-copy", { hasText: /^Sửa$/ }).count()) === 0, "Sửa vẫn hiện");
  const why = await page.locator(".chat-copy-off").first().getAttribute("title");
  assert(why.includes("ghi lần nữa"), why);
});
await step("một câu hỏi mới vẫn được (làm lại được lượt sau)", async () => {
  await ask("hỏi nhanh lại");
  await waitModel("Trả lời số 5");
  assert((await page.locator(".chat-copy", { hasText: "Tạo lại" }).count()) === 1);
});

console.log("\n== Trợ lý: lọc màn hình bằng lời ==");
await step("tool set_view_filter → Gantt chỉ còn việc của Anh (+ dòng cha), có ghi chú dưới câu trả lời", async () => {
  await ask("lọc nhanh việc của Anh");
  await page.waitForSelector(".chat-filter-note");
  assert((await page.textContent(".chat-filter-note")).includes("người: Nguyễn Anh"));
  await page.waitForFunction(() => document.querySelector(".tf-count")?.textContent.includes("2/9"));
  const rows = await page.$$eval(".wbs-row", (r) => r.map((x) => x.textContent));
  assert(rows.some((t) => t.includes("DEMO-3")) && rows.some((t) => t.includes("DEMO-5")), "thiếu việc của Anh");
  assert(!rows.some((t) => t.includes("DEMO-6")), "DEMO-6 là của Chi, không được hiện");
});
await step("bộ lọc do trợ lý đặt gỡ được bằng nút Xoá lọc như bộ lọc tay", async () => {
  await page.locator(".tf-clear").click();
  await page.waitForFunction(() => document.querySelectorAll(".wbs-row").length >= 8);
});
await step("bộ lọc cũng sang tab Bảng", async () => {
  await ask("lọc nhanh việc của Anh trên bảng");
  await page.waitForFunction(() => document.querySelector(".tf-count")?.textContent.includes("2/9"));
  await page.locator(".toolbar-tabs button", { hasText: "Bảng" }).click();
  await page.waitForSelector(".bd-card");
  // The board's own filter is on ("Xoá lọc" only shows while something is filtered) and only Anh's cards remain.
  await page.waitForFunction(() => (document.querySelector(".bd-filters")?.textContent ?? "").includes("Xoá lọc"));
  const cards = await page.$$eval(".bd-card", (c) => c.map((x) => x.textContent));
  assert(cards.length === 2 && cards.some((t) => t.includes("DEMO-3")) && cards.some((t) => t.includes("DEMO-5")), "thẻ hiện: " + cards.join(" | "));
});

console.log("\n== Trợ lý: tệp đính kèm ==");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const fileInput = page.locator(".chat-dock input[type=file]");
await step("đính kèm một ảnh → hiện chip, gửi kèm dữ liệu, bong bóng hiện tên tệp", async () => {
  await fileInput.setInputFiles({ name: "loi.png", mimeType: "image/png", buffer: PNG });
  await page.waitForSelector(".chat-pending .chat-files li");
  assert((await page.textContent(".chat-pending")).includes("loi.png"));
  await ask("xem ảnh nhanh");
  await waitModel("Đã đọc 1 tệp: loi.png");
  const last = (await chatPosts()).at(-1);
  assert(last.b.attachments?.length === 1 && last.b.attachments[0].name === "loi.png" && last.b.attachments[0].mimeType === "image/png", JSON.stringify(last.b).slice(0, 200));
  assert(last.b.attachments[0].data === PNG.toString("base64"), "dữ liệu base64 không khớp");
  assert((await page.locator(".chat-msg-user .chat-files").last().textContent()).includes("loi.png"));
  assert((await page.locator(".chat-pending").count()) === 0, "chip phải mất sau khi gửi");
});
await step("lượt có tệp không tạo lại / sửa được, và nói rõ vì sao", async () => {
  assert((await page.locator(".chat-copy", { hasText: "Tạo lại" }).count()) === 0);
  const why = await page.locator(".chat-msg-user .chat-copy-off").last().getAttribute("title");
  assert(why.includes("tệp"), why);
});
await step("dán ảnh chụp màn hình vào ô soạn thảo → thành tệp đính kèm", async () => {
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], "man-hinh.png", { type: "image/png" }));
    const area = document.querySelector(".chat-input-row textarea");
    area.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForSelector(".chat-pending .chat-files li");
  assert((await page.textContent(".chat-pending")).includes("man-hinh.png"));
});
await step("bỏ tệp bằng nút ✕", async () => {
  await page.locator(".chat-file-remove").click();
  await page.waitForSelector(".chat-pending", { state: "detached" });
});
await step("loại tệp không hỗ trợ bị từ chối ngay, không thành chip", async () => {
  await fileInput.setInputFiles({ name: "chay.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ") });
  await page.waitForSelector(".chat-pending .chat-error");
  assert((await page.textContent(".chat-pending")).includes("chưa hỗ trợ"));
  assert((await page.locator(".chat-pending .chat-files li").count()) === 0);
});
await step("tệp quá lớn bị từ chối", async () => {
  await fileInput.setInputFiles({ name: "to.png", mimeType: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await page.waitForFunction(() => (document.querySelector(".chat-pending")?.textContent ?? "").includes("lớn hơn 5 MB"));
});
await step("chỉ có tệp, không có chữ: vẫn gửi được", async () => {
  await fileInput.setInputFiles({ name: "ghi-chu.md", mimeType: "", buffer: Buffer.from("# Yêu cầu") });
  await page.waitForSelector(".chat-pending .chat-files li");
  await page.locator(".chat-send.primary").click();
  await page.waitForFunction(() => document.querySelectorAll(".chat-msg-model .chat-bubble").length >= 1);
  const last = (await chatPosts()).at(-1);
  assert(last.b.attachments?.[0].name === "ghi-chu.md" && last.b.attachments[0].mimeType === "text/markdown", JSON.stringify(last.b).slice(0, 200));
});

console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
console.log("Lỗi console/pageerror:", problems.length ? problems : "không có");
await browser.close();
process.exit(failed || problems.length ? 1 : 0);
