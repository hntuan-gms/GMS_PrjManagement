// The assistant as a window (floating, draggable, resizable) and as a drop target: work dragged in from the
// plan and the board, "@" people with several marked at once, screen context, buttons instead of typed answers,
// receipts with undo. Contract for client/src/components/ChatDock.tsx, ChatComposer.tsx, useFloatingWindow.ts.
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
    console.log("  FAIL", name, "\n       ", String(e.message).split("\n").slice(0, 8).join("\n        "));
    if (process.env.E2E_SHOT) await page.screenshot({ path: `${process.env.E2E_SHOT}/chat-window-fail-${failed}.png` }).catch(() => {});
  }
}
const dock = page.locator(".chat-dock");
// The window's own rectangle (its inline style), not the painted box: the open animation scales it for a moment.
const box = async () => dock.evaluate((el) => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), width: parseFloat(el.style.width), height: parseFloat(el.style.height) }));
const textarea = page.locator(".chat-composer textarea");
const chatPosts = async () => (await (await fetch(API + "/api/__log")).json()).log.filter((l) => l.m === "POST" && l.p === "/api/ai/chat");
// The stand-in numbers its replies across every script of a run, so a reply is recognised by there being one more
// answer than before the question was sent, not by its number.
let answersBefore = 0;
const waitReply = () =>
  page.waitForFunction((k) => document.querySelectorAll(".chat-msg-model .chat-bubble").length > k && !document.querySelector(".chat-send.is-stop"), answersBefore);
const row = (id) => page.locator(`.wbs-row[data-row-id="${id}"]`);
const send = async (text) => {
  answersBefore = await page.locator(".chat-msg-model .chat-bubble").count();
  await textarea.fill(text);
  await page.keyboard.press("Enter");
};
const openByRail = () => page.locator(".app-rail button[aria-label='Trợ lý']").click();
const clearTray = async () => {
  while ((await page.locator(".chat-tray .chat-chip-x").count()) > 0) await page.locator(".chat-tray .chat-chip-x").first().click();
};

await fetch(API + "/api/__reset", { method: "POST" });
await fetch(API + "/api/__restore", { method: "POST" });
await page.goto(process.env.E2E_APP ?? "http://localhost:5173/?view=gantt");
await page.waitForSelector(".wbs-row");
await page.evaluate(() => localStorage.removeItem("gms.chat.window"));

console.log("\n== Cửa sổ ==");
await step("mở: nằm trọn trong màn hình, con trỏ ở ô nhập, gợi ý theo tab", async () => {
  await openByRail();
  await dock.waitFor();
  await page.waitForTimeout(350);
  const b = await box();
  assert(b.x >= 0 && b.y >= 0 && b.x + b.width <= 1500 && b.y + b.height <= 900, JSON.stringify(b));
  assert(await page.evaluate(() => document.activeElement?.closest(".chat-composer") !== null), "con trỏ không ở ô nhập");
  const sugg = await page.locator(".chat-suggestion").allTextContents();
  assert(sugg.length >= 3 && sugg.includes("Việc nào đang trễ?"), sugg.join("|"));
});
await step("không đẩy kế hoạch sang bên: lề phải của trang không đổi", async () => {
  const pad = await page.evaluate(() => getComputedStyle(document.querySelector(".app")).paddingRight);
  assert.equal(pad, "0px", pad);
});
await step("kéo thanh tiêu đề: cửa sổ dời theo chuột", async () => {
  const before = await box();
  const t = await page.locator(".chat-dock-title").boundingBox();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2 - 300, t.y + t.height / 2 - 150, { steps: 8 });
  await page.mouse.up();
  const after = await box();
  assert(Math.abs(after.x - (before.x - 300)) <= 2 && Math.abs(after.y - (before.y - 150)) <= 2, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  assert(after.width === before.width && after.height === before.height, "kích thước đổi khi kéo");
});
await step("kéo ra ngoài màn hình: thanh tiêu đề vẫn nằm trong tầm nắm", async () => {
  const t = await page.locator(".chat-dock-title").boundingBox();
  await page.mouse.move(t.x + 10, t.y + 5);
  await page.mouse.down();
  await page.mouse.move(-2000, 2000, { steps: 6 });
  await page.mouse.up();
  const b = await box();
  assert(b.x + b.width >= 260 && b.x <= 1500 - 120 && b.y >= 0 && b.y <= 900 - 40, JSON.stringify(b));
  // ...and it can be taken back from there by the part of the bar that is still on screen.
  const h = await page.locator(".chat-dock-header").boundingBox();
  await page.mouse.move(60, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(700, 300, { steps: 8 });
  await page.mouse.up();
  const back = await box();
  assert(back.x > 300 && back.y < 400, JSON.stringify(back));
});
await step("vị trí được nhớ: đóng rồi mở lại vẫn ở chỗ cũ", async () => {
  const before = await box();
  await page.keyboard.press("Control+j");
  await dock.waitFor({ state: "detached" });
  await page.keyboard.press("Control+j");
  await dock.waitFor();
  const after = await box();
  assert(Math.abs(after.x - before.x) <= 1 && Math.abs(after.y - before.y) <= 1, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
});
await step("Tuỳ chọn → Đặt lại vị trí: về góc dưới phải", async () => {
  await page.locator(".chat-dock button[aria-label='Tuỳ chọn trợ lý']").click();
  await page.locator("[role=menuitem]", { hasText: "Đặt lại vị trí" }).click();
  const b = await box();
  assert(b.x + b.width > 1400 && b.y + b.height > 800, JSON.stringify(b));
});
await step("đổi cỡ từ góc trên trái: to ra, mép dưới phải đứng yên", async () => {
  const before = await box();
  const h = await page.locator(".chat-rz-nw").boundingBox();
  await page.mouse.move(h.x + 4, h.y + 4);
  await page.mouse.down();
  await page.mouse.move(h.x - 96, h.y - 76, { steps: 6 });
  await page.mouse.up();
  const after = await box();
  assert(after.width - before.width >= 90 && after.height - before.height >= 70, `${before.width}x${before.height} → ${after.width}x${after.height}`);
  assert(Math.abs(after.x + after.width - (before.x + before.width)) <= 2 && Math.abs(after.y + after.height - (before.y + before.height)) <= 2, "mép dưới phải bị dời");
});
await step("không thu nhỏ quá mức tối thiểu", async () => {
  const h = await page.locator(".chat-rz-se").boundingBox();
  await page.mouse.move(h.x + 4, h.y + 4);
  await page.mouse.down();
  await page.mouse.move(h.x - 1000, h.y - 1000, { steps: 6 });
  await page.mouse.up();
  const b = await box();
  assert(b.width >= 340 && b.height >= 360, `${b.width}x${b.height}`);
});
await step("bấm đúp thanh tiêu đề: mở rộng, bấm đúp nữa: trở lại như cũ", async () => {
  const before = await box();
  await page.locator(".chat-dock-title").dblclick();
  await page.waitForFunction(() => document.querySelector(".chat-dock")?.classList.contains("is-max"));
  const big = await box();
  assert(big.width > 900, String(big.width));
  await page.locator(".chat-dock-title").dblclick();
  await page.waitForFunction(() => !document.querySelector(".chat-dock")?.classList.contains("is-max"));
  const back = await box();
  assert(Math.abs(back.width - before.width) <= 1 && Math.abs(back.x - before.x) <= 1, `${JSON.stringify(before)} → ${JSON.stringify(back)}`);
});
await step("Esc khi con trỏ ở ngoài cửa sổ không đóng nó; trong cửa sổ thì đóng", async () => {
  await row("DEMO-3").locator(".wbs-col-name").click();
  await page.keyboard.press("Escape");
  assert.equal(await dock.count(), 1, "Esc ngoài cửa sổ đã đóng nó");
  await textarea.focus();
  await page.keyboard.press("Escape");
  await dock.waitFor({ state: "detached" });
  await openByRail();
  await dock.waitFor();
});
await step("nút Trợ lý trên thanh bên bật / tắt", async () => {
  await openByRail();
  await dock.waitFor({ state: "detached" });
  await openByRail();
  await dock.waitFor();
});

console.log("\n== Kéo việc vào chat ==");
await step("kéo một dòng của kế hoạch vào cửa sổ → chip trong ô soạn, bấm ✕ bỏ được", async () => {
  await row("DEMO-3").locator(".wbs-col-name").dragTo(page.locator(".chat-dock .chat-messages-wrap"));
  await page.waitForSelector(".chat-tray .chat-chip[data-chip-key='DEMO-3']");
  await page.locator(".chat-tray .chat-chip-x").click();
  assert.equal(await page.locator(".chat-tray").count(), 0);
});
await step("chọn hai dòng (Ctrl+bấm) rồi kéo một trong hai → cả hai thành chip", async () => {
  await row("DEMO-5").locator(".wbs-col-name").click();
  await row("DEMO-6").locator(".wbs-col-name").click({ modifiers: ["Control"] });
  await row("DEMO-5").locator(".wbs-col-name").dragTo(page.locator(".chat-dock .chat-messages-wrap"));
  await page.waitForSelector(".chat-tray .chat-chip[data-chip-key='DEMO-6']");
  const keys = await page.$$eval(".chat-tray .chat-chip", (c) => c.map((x) => x.getAttribute("data-chip-key")));
  assert.deepEqual(keys, ["DEMO-5", "DEMO-6"]);
});
await step("kéo một dòng không thuộc vùng chọn: chỉ dòng đó đi", async () => {
  await clearTray();
  await row("DEMO-5").locator(".wbs-col-name").click();
  await row("DEMO-6").locator(".wbs-col-name").click({ modifiers: ["Control"] });
  await row("DEMO-8").locator(".wbs-col-name").dragTo(page.locator(".chat-dock .chat-messages-wrap"));
  await page.waitForSelector(".chat-tray .chat-chip[data-chip-key='DEMO-8']");
  assert.equal(await page.locator(".chat-tray .chat-chip").count(), 1);
});
await step("gửi: tin nhắn mang dòng 'Việc đính kèm', bong bóng hiện chip, chip trong ô soạn mất", async () => {
  await clearTray();
  await row("DEMO-5").locator(".wbs-col-name").click();
  await row("DEMO-6").locator(".wbs-col-name").click({ modifiers: ["Control"] });
  await row("DEMO-5").locator(".wbs-col-name").dragTo(page.locator(".chat-dock .chat-messages-wrap"));
  await page.waitForSelector(".chat-tray .chat-chip[data-chip-key='DEMO-6']");
  await send("nhanh dời hai việc này sang tuần sau");
  await waitReply(1);
  const last = (await chatPosts()).at(-1).b.message;
  assert(last.includes("nhanh dời hai việc này sang tuần sau\n\nViệc đính kèm: DEMO-5 «Thiết kế cơ sở dữ liệu»; DEMO-6 «Dựng API đăng nhập»"), last);
  assert.equal(await page.locator(".chat-msg-user .chat-chip").count(), 2);
  assert.equal(await page.locator(".chat-tray").count(), 0);
});
await step("bấm chip trong bong bóng mở chi tiết (lớp giữa màn hình, phủ lên cửa sổ chat); đóng thì cửa sổ chat còn nguyên", async () => {
  await page.locator(".chat-msg-user .chat-chip[data-chip-key='DEMO-5'] .chat-chip-main").click();
  await page.waitForSelector(".modal-detail .modal-id");
  assert((await page.textContent(".modal-detail .modal-id")).includes("DEMO-5"));
  await page.waitForTimeout(300);
  const peek = await page.locator(".modal-detail").boundingBox();
  assert(peek.width > 900, `chi tiết chỉ rộng ${peek.width}`);
  const b0 = await box();
  await page.keyboard.press("Escape");
  await page.waitForSelector(".modal-detail", { state: "detached" });
  assert(await dock.isVisible());
  const b1 = await box();
  assert.deepEqual(b1, b0, "cửa sổ chat bị xê dịch khi mở/đóng chi tiết");
});
await step("mã việc nằm trong câu trả lời của trợ lý cũng bấm được", async () => {
  await send("nhanh cho tôi xem DEMO-3");
  await waitReply(2);
  // The model's reply text does not name a key here; the user's own message does.
  await page.locator(".chat-msg-user .chat-issue", { hasText: "DEMO-3" }).click();
  await page.waitForSelector(".modal-detail .modal-id");
  assert((await page.textContent(".modal-detail .modal-id")).includes("DEMO-3"));
  await page.keyboard.press("Escape");
  await page.waitForSelector(".modal-detail", { state: "detached" });
});
await step("kéo thẻ từ tab Bảng vào cửa sổ", async () => {
  await page.locator(".toolbar-tabs button", { hasText: "Bảng" }).click();
  await page.waitForSelector(".bd-card");
  await page.locator(".bd-card[data-card-key='DEMO-5']").dragTo(page.locator(".chat-dock .chat-messages-wrap"));
  await page.waitForSelector(".chat-tray .chat-chip[data-chip-key='DEMO-5']");
  await clearTray();
  await page.locator(".toolbar-tabs button", { hasText: "Kế hoạch" }).click();
  await page.waitForSelector(".wbs-row");
});
await step("cửa sổ đóng: kéo một dòng thì hiện vùng thả, thả vào là mở và đính kèm", async () => {
  await textarea.focus();
  await page.keyboard.press("Escape");
  await dock.waitFor({ state: "detached" });
  const r = await row("DEMO-7").locator(".wbs-col-name").boundingBox();
  await page.mouse.move(r.x + 30, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + 60, r.y + r.height / 2 + 20, { steps: 4 });
  await page.waitForSelector(".chat-dropzone");
  const z = await page.locator(".chat-dropzone").boundingBox();
  await page.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 8 });
  await page.mouse.up();
  await dock.waitFor();
  await page.waitForSelector(".chat-tray .chat-chip[data-chip-key='DEMO-7']");
  await clearTray();
});
await step("dải 'Đang chọn n việc' đề nghị đính kèm bằng một cú bấm", async () => {
  await row("DEMO-3").locator(".wbs-col-name").click();
  await row("DEMO-4").locator(".wbs-col-name").click({ modifiers: ["Control"] });
  await page.waitForSelector(".chat-selected-strip");
  assert((await page.textContent(".chat-selected-strip")).includes("2"));
  await page.locator(".chat-selected-strip button").click();
  await page.waitForSelector(".chat-tray .chat-chip[data-chip-key='DEMO-4']");
  assert.equal(await page.locator(".chat-selected-strip").count(), 0, "đã đính kèm hết thì dải phải mất");
  await clearTray();
});
await step("câu hỏi mang theo màn hình và vùng chọn (context)", async () => {
  await send("nhanh ngữ cảnh");
  await waitReply(3);
  const ctx = (await chatPosts()).at(-1).b.context;
  assert.equal(ctx.view, "gantt");
  assert.deepEqual([...ctx.selected].sort(), ["DEMO-3", "DEMO-4"]);
  assert((await page.locator(".chat-msg-model .chat-bubble").last().textContent()).includes("tab gantt"));
});

console.log("\n== @ gọi người ==");
await step("gõ @ → danh sách người, gõ tiếp thì lọc không dấu, Enter chèn", async () => {
  await textarea.fill("giao cho ");
  await page.keyboard.type("@");
  await page.waitForSelector(".chat-mention-menu");
  assert.equal(await page.locator(".chat-mention-row").count(), 4);
  assert((await page.locator(".chat-mention-row").first().textContent()).includes("tôi"), "mình phải đứng đầu");
  await page.keyboard.type("binh");
  await page.waitForFunction(() => document.querySelectorAll(".chat-mention-row").length === 1);
  await page.keyboard.press("Enter");
  assert.equal(await textarea.inputValue(), "giao cho @Trần Bình ");
  assert.equal(await page.locator(".chat-mention-menu").count(), 0);
});
await step("Ctrl+bấm chọn nhiều người rồi Enter: chèn tất cả; gửi đi mang đúng accountId", async () => {
  await textarea.fill("nhanh nhờ ");
  await page.keyboard.type("@");
  await page.locator(".chat-mention-row", { hasText: "Nguyễn Anh" }).click({ modifiers: ["Control"] });
  await page.locator(".chat-mention-row", { hasText: "Lê Chi" }).click({ modifiers: ["Control"] });
  assert((await page.textContent(".chat-mention-insert")).includes("2"), "nút chèn phải nói 2 người");
  assert.equal(await page.locator(".chat-mention-row.is-marked").count(), 2, "chỉ hai người được bấm, không tính dòng đang sáng");
  await page.keyboard.press("Enter");
  assert.equal(await textarea.inputValue(), "nhanh nhờ @Lê Chi @Nguyễn Anh ");
  await page.keyboard.press("Enter");
  await waitReply(4);
  const msg = (await chatPosts()).at(-1).b.message;
  assert.equal(msg, "nhanh nhờ @[Lê Chi](chi) @[Nguyễn Anh](anh)");
  assert.equal(await page.locator(".chat-msg-user .chat-mention").count(), 2);
});
await step("Shift+bấm chọn một dải người", async () => {
  await textarea.fill("");
  await page.keyboard.type("@");
  await page.locator(".chat-mention-row").nth(0).click({ modifiers: ["Control"] });
  await page.locator(".chat-mention-row").nth(2).click({ modifiers: ["Shift"] });
  assert.equal(await page.locator(".chat-mention-row.is-marked").count(), 3);
  assert((await page.textContent(".chat-mention-insert")).includes("3"));
});
await step("Esc đóng riêng danh sách, cửa sổ vẫn mở", async () => {
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".chat-mention-menu").count(), 0);
  assert.equal(await dock.count(), 1);
});
await step("bấm thường vào một người: chèn ngay người đó", async () => {
  await textarea.fill("");
  await page.keyboard.type("@");
  await page.locator(".chat-mention-row", { hasText: "Trần Bình" }).click();
  assert.equal(await textarea.inputValue(), "@Trần Bình ");
  await textarea.fill("");
});
await step("@ trong địa chỉ thư không mở danh sách", async () => {
  await textarea.fill("");
  await page.keyboard.type("a@");
  assert.equal(await page.locator(".chat-mention-menu").count(), 0);
  await textarea.fill("");
});
await step("↑ trong ô trống gọi lại câu hỏi trước", async () => {
  await page.keyboard.press("ArrowUp");
  assert((await textarea.inputValue()).startsWith("nhanh nhờ @"), await textarea.inputValue());
  await textarea.fill("");
});

console.log("\n== Nút bấm thay cho gõ trả lời, biên nhận ==");
await step("cần xác nhận → hiện nút, bấm 'Huỷ' gửi đúng câu đó", async () => {
  await send("xoá việc này");
  await page.waitForSelector(".chat-choices");
  assert.equal(await page.locator(".chat-choice").count(), 2);
  assert(await page.locator(".chat-choice.is-danger").count() === 1);
  await page.locator(".chat-choice", { hasText: "Huỷ" }).click();
  await page.waitForFunction(async () => (await (await fetch("/api/__log")).json()).log.filter((l) => l.p === "/api/ai/chat").at(-1)?.b?.message === "Thôi, không làm nữa");
  await page.locator(".chat-send.is-stop").click();
  await page.waitForSelector(".chat-send:not(.is-stop)");
});
await step("việc ghi lên Jira → biên nhận một dòng, 'Hoàn tác' gửi đúng bản vá một lần", async () => {
  await send("gán nhanh việc");
  await page.waitForSelector(".chat-receipts li");
  assert((await page.textContent(".chat-receipts li")).includes("DEMO-1 → Bình"));
  await fetch(API + "/api/__reset", { method: "POST" });
  await page.locator(".chat-receipt-undo").click();
  await page.waitForSelector(".chat-receipts li.is-undone");
  const patches = (await (await fetch(API + "/api/__log")).json()).log.filter((l) => l.m === "PATCH" && l.p === "/api/tasks/DEMO-1");
  assert.equal(patches.length, 1, "bản vá phải gửi đúng một lần");
  assert.equal(patches[0].b.assigneeAccountId, null);
  assert.equal(await page.locator(".chat-receipt-undo").count(), 0, "đã hoàn tác thì hết nút");
});
await step("lượt đã ghi: không có 'Tạo lại' / 'Sửa'", async () => {
  assert.equal(await page.locator(".chat-act[aria-label='Tạo lại']").count(), 0);
  assert.equal(await page.locator(".chat-msg-user .chat-act[aria-label='Sửa']").count(), 0);
});
await step("danh sách cuộc trò chuyện là ngăn kéo phủ lên: mở ra không làm dịch hội thoại hay ô soạn", async () => {
  const before = { c: await page.locator(".chat-composer").boundingBox(), m: await page.locator(".chat-messages").boundingBox() };
  await page.locator(".chat-session-btn").click();
  await page.waitForSelector(".chat-side.is-open .chat-sessions");
  await page.waitForTimeout(400);
  const after = { c: await page.locator(".chat-composer").boundingBox(), m: await page.locator(".chat-messages").boundingBox() };
  assert.deepEqual(after, before, "hội thoại hoặc ô soạn bị dịch khi mở danh sách");
  // The drawer lies over the conversation; the scrim closes it.
  const side = await page.locator(".chat-side").boundingBox();
  assert(side.width > 200 && side.width <= 290, String(side.width));
  const scrim = await page.locator(".chat-scrim").boundingBox();
  assert(scrim.width > side.width + 10, `không còn chỗ ngoài ngăn kéo để bấm: ${scrim.width} vs ${side.width}`);
  await page.mouse.click(scrim.x + scrim.width - 6, scrim.y + 200);
  await page.waitForSelector(".chat-side:not(.is-open)", { state: "attached" });
  await page.waitForTimeout(350);
  assert.equal(await page.locator(".chat-side").isVisible(), false, "ngăn kéo đóng rồi phải ẩn");
});
await step("phóng to: thanh bên lịch sử cố định bên trái, hội thoại căn giữa phần còn lại", async () => {
  await page.locator(".chat-dock button[aria-label='Mở rộng']").click();
  await page.waitForSelector(".chat-dock.is-max .chat-side.is-open");
  await page.waitForTimeout(700);
  const side = await page.locator(".chat-side").boundingBox();
  const main = await page.locator(".chat-main").boundingBox();
  const comp = await page.locator(".chat-composer").boundingBox();
  assert(Math.abs(side.width - 288) <= 2, String(side.width));
  assert(Math.abs(side.x + side.width - main.x) <= 2, "thanh bên phải sát cạnh vùng trả lời");
  // The composer is centred in the area beside the sidebar.
  assert(Math.abs(comp.x + comp.width / 2 - (main.x + main.width / 2)) <= 2, `lệch tâm ${comp.x + comp.width / 2} vs ${main.x + main.width / 2}`);
  // The header button folds the sidebar, and the conversation re-centres in the full width.
  await page.locator(".chat-session-btn").click();
  await page.waitForTimeout(500);
  assert((await page.locator(".chat-side").boundingBox()).width <= 1, "thanh bên chưa gập");
  await page.locator(".chat-session-btn").click();
  await page.waitForTimeout(500);
  await page.locator(".chat-dock button[aria-label='Thu nhỏ']").click();
  await page.waitForFunction(() => !document.querySelector(".chat-dock")?.classList.contains("is-max"));
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".chat-side").isVisible(), false, "thu nhỏ rồi thì ngăn kéo phải đóng");
});

console.log("\n== Điện thoại ==");
await step("màn hình hẹp: trợ lý là một tờ kín màn hình, không có tay nắm đổi cỡ", async () => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForSelector(".chat-dock.is-phone");
  await page.waitForTimeout(350);
  const b = await dock.boundingBox();
  assert(b.width >= 389 && b.x === 0, JSON.stringify(b));
  assert.equal(await page.locator(".chat-rz").count(), 0);
  await page.setViewportSize({ width: 1500, height: 900 });
});

await fetch(API + "/api/__restore", { method: "POST" });
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
console.log("Lỗi console/pageerror:", problems.length ? problems : "không có");
await browser.close();
process.exit(failed || problems.length ? 1 : 0);
