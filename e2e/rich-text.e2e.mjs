// Comments and descriptions are edited as they read (TipTap): pressing a description shows its headings,
// lists and links — never the stored `**`/`[..](..)` text. Markdown typed out of habit becomes the thing,
// a picture pasted is uploaded once and shown, HTML pasted keeps its structure, "@" makes a mention, and
// what reaches the API is still the stored text. Client against the stand-in API.
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
async function openTask(id = "DEMO-5", restore = true) {
  if (restore) await fetch(API + "/api/__restore", { method: "POST" });
  // Opened by its link (?task=), the way "Sao chép liên kết" hands it over.
  await page.goto(`${process.env.E2E_APP ?? "http://localhost:5173/?view=gantt"}&project=DEMO&task=${id}`);
  await page.waitForSelector(".modal-detail .modal-id");
}

// A 1×1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Pastes into the focused element what a clipboard holding a picture / HTML / text would. */
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

const box = () => page.locator(".td-box .ProseMirror").first();
const comments = async () => await (await fetch(API + "/api/tasks/DEMO-5/comments")).json();
const attachmentCount = async () => (await (await fetch(API + "/api/tasks/DEMO-5/attachments")).json()).files.length;
const waitComments = (n) => page.waitForFunction(async (n) => (await (await fetch("/api/tasks/DEMO-5/comments")).json()).length >= n, n);

console.log("\n== Bình luận ==");
await openTask();
await step("khung bình luận có thanh định dạng khi bấm vào", async () => {
  await box().click();
  await page.locator(".td-box .rt-bar").waitFor();
  for (const label of ["Đậm", "Nghiêng", "Danh sách", "Danh sách số", "Khối mã", "Liên kết", "Chèn ảnh"]) {
    assert.equal(await page.locator(`.td-box .rt-bar button[aria-label='${label}']`).count(), 1, `thiếu nút ${label}`);
  }
});

await step("gõ '- ' thành danh sách thật; Enter nối tiếp, Enter ở dòng trống thì thoát", async () => {
  await page.keyboard.type("- một");
  await page.keyboard.press("Enter");
  await page.keyboard.type("hai");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Xong");
  assert.equal(await box().locator("ul > li").count(), 2);
  assert.ok(!(await box().innerText()).includes("- "), "còn thấy dấu '- ' thô");
});

await step("Ctrl B bôi đậm chữ đang chọn; Ctrl Z hoàn tác được", async () => {
  await page.keyboard.press("Shift+Home");
  // The editor reads a keyboard selection on the browser's selectionchange, a beat later.
  await page.waitForTimeout(60);
  await page.keyboard.press("Control+b");
  assert.equal(await box().locator("strong").innerText(), "Xong");
  await page.keyboard.press("Control+z");
  assert.equal(await box().locator("strong").count(), 0);
  await page.keyboard.press("Control+b");
  await page.keyboard.press("End");
});

await step("dán ảnh: hiện ngay trong ô, lên Jira đúng một lần", async () => {
  const before = await attachmentCount();
  await paste({ png: true });
  await box().locator(".rt-img-btn img").waitFor();
  await page.waitForTimeout(300);
  assert.equal(await attachmentCount(), before + 1, "ảnh phải lên đúng một lần");
});

await step("gửi: API nhận văn bản đã lưu; bình luận hiện có cấu trúc và ảnh", async () => {
  const n = (await comments()).length;
  await page.keyboard.press("Control+Enter");
  await waitComments(n + 1);
  assert.match((await comments())[0].text, /^- một\n- hai\n\n\*\*Xong\*\*\n\n!\[anh-dan-\d+\.png\]\(attachment:\d+\)$/);
  const c = page.locator(".td-comment .td-ctext").first();
  await c.locator("ul").waitFor();
  assert.equal(await c.locator("ul > li").count(), 2);
  const img = c.locator(".rt-img-btn img");
  await img.waitFor();
  await page.waitForFunction((el) => el.complete && el.naturalWidth > 0, await img.elementHandle());
  assert.equal((await box().innerText()).trim(), "", "ô phải trống sau khi gửi");
});

await step("bấm ảnh trong bình luận mở to; Esc chỉ đóng ảnh", async () => {
  await page.locator(".td-comment .td-ctext .rt-img-btn").first().click();
  await page.locator(".lightbox").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".lightbox").waitFor({ state: "detached" });
  assert.equal(await page.locator(".modal-detail").count(), 1);
});

await step("dán HTML (từ Jira/Docs) giữ tiêu đề, danh sách, chữ đậm và link", async () => {
  await box().click();
  await paste({
    html: "<h2>Việc cần làm</h2><ol><li><p>BoardView</p></li><li><p><b>OkrView</b> (59)</p></li></ol><p>Xem <a href='https://e.com/k'>kit</a></p>",
    text: "Việc cần làm\nBoardView\nOkrView (59)\nXem kit",
  });
  assert.equal(await box().locator("h2").innerText(), "Việc cần làm");
  assert.equal(await box().locator("ol > li").count(), 2);
  assert.equal(await box().locator("a[href='https://e.com/k']").count(), 1);
  const n = (await comments()).length;
  await page.keyboard.press("Control+Enter");
  await waitComments(n + 1);
  assert.equal((await comments())[0].text, "## Việc cần làm\n\n1. BoardView\n2. **OkrView** (59)\n\nXem [kit](https://e.com/k)");
});

await step("@ gợi ý người; chọn thì thành mention, API nhận @[Tên](id)", async () => {
  await box().click();
  await page.keyboard.type("Nhờ @Anh");
  await page.locator(".re-suggest").waitFor();
  await page.keyboard.press("Enter");
  assert.equal(await box().locator(".td-mention").innerText(), "@Nguyễn Anh");
  await page.keyboard.type("xem giúp");
  const n = (await comments()).length;
  await page.keyboard.press("Control+Enter");
  await waitComments(n + 1);
  assert.equal((await comments())[0].text, "Nhờ @[Nguyễn Anh](anh) xem giúp");
});

await step("thả 3 ảnh + 1 PDF vào ô: cả 3 ảnh nằm trong ô, PDF thành đính kèm, khung không kẹt lớp 'Thả tệp'", async () => {
  await box().click();
  const before = await attachmentCount();
  const rect = await box().boundingBox();
  await page.evaluate(
    ({ b64, x, y }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      for (const n of [1, 2, 3]) dt.items.add(new File([bytes], `man-${n}.png`, { type: "image/png" }));
      dt.items.add(new File(["%PDF-1.4"], "dac-ta.pdf", { type: "application/pdf" }));
      const target = document.querySelector(".td-box .ProseMirror");
      const panel = document.querySelector(".modal.peek-panel");
      panel.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true, cancelable: true }));
      target.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }));
    },
    { b64: PNG, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  );
  await page.waitForFunction(() => document.querySelectorAll(".td-box .ProseMirror .rt-img-btn img").length === 3);
  assert.equal(await page.locator(".modal.peek-panel.is-dropping").count(), 0, "lớp 'Thả tệp để đính kèm' còn kẹt");
  await page.waitForFunction(async (n) => (await (await fetch("/api/tasks/DEMO-5/attachments")).json()).files.length >= n, before + 4);
  await page.keyboard.type("sau ảnh");
  assert.equal(await box().locator(".rt-img-btn img").count(), 3, "gõ chữ làm mất ảnh");
  const n = (await comments()).length;
  await page.keyboard.press("Control+Enter");
  await waitComments(n + 1);
  const text = (await comments())[0].text;
  assert.equal((text.match(/!\[man-\d\.png\]\(attachment:\d+\)/g) ?? []).length, 3, text);
  assert.ok(!text.includes("dac-ta.pdf"), text);
  // The PDF going up opened "Đính kèm" without taking the cursor: the space typed did not press a file.
  assert.equal(await page.locator(".lightbox").count(), 0, "gõ chữ đã bấm vào tệp đính kèm");
});

await step("Sửa bình luận: hiện như lúc đọc (danh sách, ảnh), không lộ mã", async () => {
  await box().click();
  const target = page.locator(".td-comment", { hasText: "hai" });
  await target.locator("button", { hasText: "Sửa" }).click();
  const edit = target.locator(".ProseMirror");
  await edit.waitFor();
  assert.equal(await edit.locator("ul > li").count(), 2);
  await edit.locator(".rt-img-btn img").waitFor();
  const shown = await edit.innerText();
  assert.ok(!/\*\*|\]\(|attachment:/.test(shown), `lộ mã: ${shown}`);
  await page.keyboard.press("Escape");
  await target.locator(".ProseMirror").waitFor({ state: "detached" });
});

console.log("\n== Mô tả ==");
await openTask();
await step("viết mô tả bằng các phím quen (# , ``, - ) → lưu → hiện đúng", async () => {
  await page.locator(".tdx-desc").click();
  await page.locator(".tdx-desc-edit .rt-bar").waitFor();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("# Bối cảnh");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Dùng `kit.tsx` cho");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- Button");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Input");
  await page.keyboard.press("Control+Enter");
  const read = page.locator(".tdx-desc");
  await read.locator(".rt-h1").waitFor();
  assert.equal(await read.locator(".rt-h1").innerText(), "Bối cảnh");
  assert.equal(await read.locator("code").innerText(), "kit.tsx");
  assert.equal(await read.locator("ul > li").count(), 2);
});

await step("bấm vào để sửa: trông như lúc đọc — tiêu đề, mã, danh sách", async () => {
  await page.locator(".tdx-desc").click({ position: { x: 300, y: 4 } });
  const ed = page.locator(".tdx-desc-edit .ProseMirror");
  await ed.waitFor();
  assert.equal(await ed.locator("h1").innerText(), "Bối cảnh");
  assert.equal(await ed.locator("code").innerText(), "kit.tsx");
  assert.equal(await ed.locator("ul > li").count(), 2);
  const shown = await ed.innerText();
  assert.ok(!/^#|`|^- /m.test(shown), `lộ mã: ${shown}`);
  await page.keyboard.press("Escape");
  await page.locator(".tdx-desc-edit").waitFor({ state: "detached" });
  assert.equal(await page.locator(".modal-detail").count(), 1, "Esc ở mô tả đóng cả cửa sổ");
});

await step("mô tả có link: lúc sửa chỉ thấy chữ của link, không thấy địa chỉ", async () => {
  await fetch(API + "/api/tasks/DEMO-5", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: "**Mục tiêu:** thử\n\n- Đề bài: [MKT - Bài toán](https://docs.google.com/document/d/16C/edit)" }),
  });
  await openTask("DEMO-5", false);
  await page.locator(".tdx-desc").click({ position: { x: 300, y: 4 } });
  const ed = page.locator(".tdx-desc-edit .ProseMirror");
  await ed.waitFor();
  assert.equal(await ed.locator("strong").innerText(), "Mục tiêu:");
  assert.equal(await ed.locator("a").innerText(), "MKT - Bài toán");
  assert.ok(!(await ed.innerText()).includes("docs.google.com"), "lộ địa chỉ link");
  await page.keyboard.press("Escape");
});

await step("dán ảnh vào mô tả: hiện trong ô, lưu xong hiện ở trang", async () => {
  await page.locator(".tdx-desc").click({ position: { x: 300, y: 4 } });
  const ed = page.locator(".tdx-desc-edit .ProseMirror");
  await ed.waitFor();
  await page.keyboard.press("Control+End");
  await paste({ png: true });
  await ed.locator(".rt-img-btn img").waitFor();
  await page.keyboard.press("Control+Enter");
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
