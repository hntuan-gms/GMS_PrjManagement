// Comments and descriptions as rich text: the formatting bar and its keys, lists that carry on with Enter,
// a picture pasted straight into the box (uploaded once, shown in the comment), HTML pasted with its
// structure, and a description written with a heading. Client against the stand-in API.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
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
  // Opened by its link (?task=), the way "Sao chép liên kết" hands it over.
  await page.goto(`${process.env.E2E_APP ?? "http://localhost:5173/?view=gantt"}&project=DEMO&task=${id}`);
  await page.waitForSelector(".modal-detail .modal-id");
}

// A 1×1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Pastes into the focused element what a clipboard holding `files` / `html` / `text` would. */
async function paste({ png = false, html = "", text = "" }) {
  await page.evaluate(
    ({ png, html, text, b64 }) => {
      const dt = new DataTransfer();
      if (png) {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        dt.items.add(new File([bytes], "image.png", { type: "image/png" }));
      }
      if (html) dt.setData("text/html", html);
      if (text) dt.setData("text/plain", text);
      document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    { png, html, text, b64: PNG }
  );
}

const box = () => page.locator(".td-box textarea[aria-label='Bình luận mới']").first();
const attachmentCount = async () => (await (await fetch(API + "/api/tasks/DEMO-5/attachments")).json()).files.length;

console.log("\n== Bình luận ==");
await openTask();
await step("khung bình luận có thanh định dạng khi bấm vào", async () => {
  await box().click();
  await page.locator(".td-box .rt-bar").waitFor();
  for (const label of ["Đậm", "Nghiêng", "Danh sách", "Danh sách số", "Khối mã", "Chèn ảnh"]) {
    assert.equal(await page.locator(`.td-box .rt-bar button[aria-label='${label}']`).count(), 1, `thiếu nút ${label}`);
  }
});

await step("Enter nối tiếp danh sách, Enter ở dòng trống thì thoát", async () => {
  await box().fill("");
  await box().pressSequentially("- một");
  await box().press("Enter");
  await box().pressSequentially("hai");
  await box().press("Enter");
  await box().press("Enter");
  await box().pressSequentially("Xong");
  assert.equal(await box().inputValue(), "- một\n- hai\nXong");
});

await step("Ctrl B bôi đậm chữ đang chọn; Ctrl Z hoàn tác được", async () => {
  await box().evaluate((el) => {
    const at = el.value.indexOf("Xong");
    el.setSelectionRange(at, at + 4);
  });
  await box().press("Control+b");
  assert.equal(await box().inputValue(), "- một\n- hai\n**Xong**");
  await box().press("Control+z");
  assert.equal(await box().inputValue(), "- một\n- hai\nXong");
  await box().press("Control+b");
});

await step("dán ảnh: lên Jira một lần (không thêm lần nữa vào đính kèm), nằm trong bình luận", async () => {
  const before = await attachmentCount();
  await box().evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
  await paste({ png: true });
  await page.waitForFunction(() => /\]\(attachment:\d+\)/.test(document.querySelector(".td-box textarea").value));
  assert.match(await box().inputValue(), /\n!\[anh-dan-\d+\.png\]\(attachment:\d+\)\n?$/);
  await page.waitForTimeout(300);
  assert.equal(await attachmentCount(), before + 1, "ảnh phải lên đúng một lần");
});

await step("Xem trước vẽ danh sách, chữ đậm và ảnh", async () => {
  await page.locator(".td-box .rt-bar-preview").click();
  const pv = page.locator(".td-preview");
  assert.equal(await pv.locator("ul > li").count(), 2);
  assert.equal(await pv.locator("strong").innerText(), "Xong");
  await pv.locator(".rt-img-btn img").waitFor();
  await page.locator(".td-box .rt-bar-preview").click();
});

await step("gửi xong, bình luận hiện có cấu trúc và ảnh tải được", async () => {
  await box().press("Control+Enter");
  const c = page.locator(".td-comment .td-ctext").first();
  await c.locator("ul").waitFor();
  assert.equal(await c.locator("ul > li").count(), 2);
  assert.equal(await c.locator("strong").innerText(), "Xong");
  const img = c.locator(".rt-img-btn img");
  await img.waitFor();
  await page.waitForFunction((el) => el.complete && el.naturalWidth > 0, await img.elementHandle());
  const sent = (await (await fetch(API + "/api/tasks/DEMO-5/comments")).json())[0].text;
  assert.match(sent, /^- một\n- hai\n\*\*Xong\*\*\n!\[anh-dan-\d+\.png\]\(attachment:\d+\)$/);
});

await step("bấm ảnh trong bình luận mở to", async () => {
  await page.locator(".td-comment .rt-img-btn").first().click();
  await page.locator(".lightbox, [class*='lightbox']").first().waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".modal-detail").count(), 1, "Esc ở ảnh không được đóng cửa sổ việc");
});

await step("dán HTML (từ Jira/Docs) giữ tiêu đề, danh sách và chữ đậm", async () => {
  await box().click();
  await box().fill("");
  await paste({
    html: "<h2>Việc cần làm</h2><ol><li>BoardView</li><li><b>OkrView</b> (59)</li></ol><p>Xem <a href='https://e.com/k'>kit</a></p>",
    text: "Việc cần làm\nBoardView\nOkrView (59)\nXem kit",
  });
  assert.equal(await box().inputValue(), "## Việc cần làm\n\n1. BoardView\n2. **OkrView** (59)\n\nXem [kit](https://e.com/k)");
  await box().fill("");
});

await step("sửa bình luận mở lại đúng văn bản đã gửi", async () => {
  // The new-comment box is focused and empty: pressing "Sửa" folds it, and the click must still land.
  await box().click();
  await page.locator(".td-comment").first().locator("button", { hasText: "Sửa" }).click();
  const edit = page.locator(".td-comment .td-box textarea").first();
  assert.match(await edit.inputValue(), /^- một\n- hai\n\*\*Xong\*\*/);
  await edit.press("Escape");
});

console.log("\n== Mô tả ==");
await openTask();
await step("mô tả có thanh định dạng; tiêu đề và mã hiện đúng sau khi lưu", async () => {
  await page.locator(".tdx-desc").click();
  const area = page.locator(".tdx-desc-edit textarea");
  await page.locator(".tdx-desc-edit .rt-bar").waitFor();
  await area.fill("# Bối cảnh\n\nDùng `kit.tsx`:\n\n- Button\n- Input");
  await area.press("Control+Enter");
  const read = page.locator(".tdx-desc");
  await read.locator(".rt-h1").waitFor();
  assert.equal(await read.locator(".rt-h1").innerText(), "Bối cảnh");
  assert.equal(await read.locator("code").innerText(), "kit.tsx");
  assert.equal(await read.locator("ul > li").count(), 2);
});

await step("dán ảnh vào mô tả: chờ ảnh lên rồi mới lưu được", async () => {
  await page.locator(".tdx-desc").click({ position: { x: 300, y: 4 } });
  const area = page.locator(".tdx-desc-edit textarea");
  await area.waitFor();
  await area.evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
  await paste({ png: true });
  await page.waitForFunction(() => /\]\(attachment:\d+\)/.test(document.querySelector(".tdx-desc-edit textarea")?.value ?? ""));
  await area.press("Control+Enter");
  await page.locator(".tdx-desc .rt-img-btn img").waitFor();
});

if (problems.length) {
  console.log("  problems:", problems.slice(0, 5));
  failed++;
}
await fetch(API + "/api/__restore", { method: "POST" });
await browser.close();
if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
