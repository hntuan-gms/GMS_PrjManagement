// Screenshots for the user guide (Hướng dẫn sử dụng), taken step by step against the stand-in API,
// with numbered call-outs drawn on the page. Not a test: run.mjs only runs *.e2e.mjs.
//
//   E2E_APP=http://localhost:5173/ E2E_API=http://localhost:4000 node guide-shots.mjs [outDir]
//
// Two walkthroughs:
//   a-*  dragging work into the assistant (select, mid-drag, chips, answer, drop zone)
//   b-*  a whole project from one sentence: plan → review → create → baseline → three weeks later →
//        report → "Vì sao?" → AI analysis → list + CSV → menu → print view → report from the chat
// The assistant's answers are scripted by mock-api.mts (no Gemini); the plan's dates come from the
// real layoutSchedule and the report's figures from the real computeProgress.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const APP = (process.env.E2E_APP ?? "http://localhost:5173/").replace(/\?.*$/, "");
const API = process.env.E2E_API ?? "http://localhost:4000";
const OUT = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "shots", "guide"));
fs.mkdirSync(OUT, { recursive: true });

const post = (p, body = {}) => fetch(API + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1.5, colorScheme: "light", locale: "vi-VN" });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);

// ---- call-outs drawn over the page -------------------------------------------------------------
const ORANGE = "#e8590c";
/** marks: [{ sel | box, n, text, side: "right"|"left"|"top"|"bottom", nth }] */
async function mark(marks) {
  const resolved = [];
  for (const m of marks) {
    let box = m.box;
    if (!box && m.sel) {
      const loc = page.locator(m.sel).nth(m.nth ?? 0);
      box = await loc.boundingBox();
    }
    if (box) resolved.push({ ...m, box });
  }
  await page.evaluate(({ marks, ORANGE }) => {
    for (const m of marks) {
      const pad = m.pad ?? 4;
      const o = document.createElement("div");
      o.className = "__guide";
      Object.assign(o.style, {
        position: "fixed", left: `${m.box.x - pad}px`, top: `${m.box.y - pad}px`, width: `${m.box.width + 2 * pad}px`, height: `${m.box.height + 2 * pad}px`,
        border: `3px solid ${ORANGE}`, borderRadius: "8px", zIndex: 2147483000, pointerEvents: "none", boxShadow: "0 0 0 3px rgba(255,255,255,.7)",
      });
      document.body.appendChild(o);
      if (!m.n && !m.text) continue;
      const tag = document.createElement("div");
      tag.className = "__guide";
      Object.assign(tag.style, {
        position: "fixed", zIndex: 2147483001, pointerEvents: "none", display: "flex", alignItems: "center", gap: "6px",
        font: "600 14px/1.25 'Be Vietnam Pro', Arial, sans-serif", color: "#1f1f1f", whiteSpace: "nowrap",
      });
      if (m.n) {
        const b = document.createElement("span");
        b.textContent = String(m.n);
        Object.assign(b.style, { width: "26px", height: "26px", borderRadius: "50%", background: ORANGE, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "15px", boxShadow: "0 1px 3px rgba(0,0,0,.35)", flex: "none" });
        tag.appendChild(b);
      }
      if (m.text) {
        const t = document.createElement("span");
        t.textContent = m.text;
        Object.assign(t.style, { background: "#fff", border: `2px solid ${ORANGE}`, borderRadius: "6px", padding: "3px 8px", boxShadow: "0 1px 4px rgba(0,0,0,.2)" });
        tag.appendChild(t);
      }
      document.body.appendChild(tag);
      const r = tag.getBoundingClientRect();
      const side = m.side ?? "right";
      let x = m.box.x + m.box.width + pad + 8, y = m.box.y + m.box.height / 2 - r.height / 2;
      if (side === "left") x = m.box.x - pad - 8 - r.width;
      if (side === "top") { x = m.box.x; y = m.box.y - pad - 8 - r.height; }
      if (side === "bottom") { x = m.box.x; y = m.box.y + m.box.height + pad + 8; }
      if (side === "inside") { x = m.box.x + 6; y = m.box.y + 6; }
      x = Math.max(4, Math.min(window.innerWidth - r.width - 4, x));
      y = Math.max(4, Math.min(window.innerHeight - r.height - 4, y));
      tag.style.left = `${x}px`;
      tag.style.top = `${y}px`;
    }
  }, { marks: resolved, ORANGE });
}
/** A dashed arrow from one point to another, and a drag "ghost" with a cursor at the end. */
async function dragPicture(from, to, ghostText) {
  await page.evaluate(({ from, to, ghostText, ORANGE }) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "__guide");
    Object.assign(svg.style, { position: "fixed", left: 0, top: 0, width: "100vw", height: "100vh", zIndex: 2147483002, pointerEvents: "none" });
    const mx = (from.x + to.x) / 2, my = Math.min(from.y, to.y) - 80;
    svg.innerHTML = `<defs><marker id="gArrow" markerWidth="12" markerHeight="12" refX="9" refY="6" orient="auto"><path d="M0,0 L12,6 L0,12 z" fill="${ORANGE}"/></marker></defs>
      <path d="M${from.x},${from.y} Q${mx},${my} ${to.x - 14},${to.y - 14}" fill="none" stroke="${ORANGE}" stroke-width="3" stroke-dasharray="9 7" marker-end="url(#gArrow)"/>
      <path transform="translate(${to.x},${to.y})" d="M0,0 L0,22 L6,16 L10,26 L14,24 L10,14 L18,14 z" fill="#fff" stroke="#111" stroke-width="1.5"/>`;
    document.body.appendChild(svg);
    const g = document.createElement("div");
    g.className = "__guide";
    g.textContent = ghostText;
    Object.assign(g.style, {
      position: "fixed", left: `${to.x + 18}px`, top: `${to.y + 18}px`, zIndex: 2147483001, pointerEvents: "none", opacity: ".92",
      background: "#fff", border: "1px solid #c9c9c9", borderRadius: "6px", padding: "5px 10px", boxShadow: "0 6px 18px rgba(0,0,0,.25)",
      font: "500 13px/1.3 'Be Vietnam Pro', Arial, sans-serif", color: "#222", whiteSpace: "pre",
    });
    document.body.appendChild(g);
  }, { from, to, ghostText, ORANGE });
}
const clear = () => page.evaluate(() => document.querySelectorAll(".__guide").forEach((e) => e.remove()));
const shots = [];
async function shot(name, marks = [], opts = {}) {
  await page.waitForTimeout(opts.wait ?? 500);
  if (marks.length) await mark(marks);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: !!opts.fullPage });
  shots.push(name);
  await clear();
  console.log("  ✓", name);
}
const center = async (sel, nth = 0) => {
  const b = await page.locator(sel).nth(nth).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const row = (key) => page.locator(".wbs-row", { has: page.locator(".wbs-col-key", { hasText: new RegExp(`^${key}$`) }) }).first();

// =============================================================================================
console.log("A. Kéo việc vào trợ lý");
await post("/api/__restore");
await post("/api/__tasks/reset");
await page.goto(APP + "?view=gantt");
await page.waitForSelector(".wbs-row");
await page.waitForTimeout(800);

// Small pictures of the buttons, for the guide's "Bấm vào đâu" column.
fs.mkdirSync(path.join(OUT, "icons"), { recursive: true });
async function icon(name, loc, pad = 4) {
  if ((await loc.count()) === 0) return console.log("  ✗ icon", name);
  const b = await loc.first().boundingBox();
  if (!b) return console.log("  ✗ icon", name);
  await page.screenshot({ path: path.join(OUT, "icons", `${name}.png`), clip: { x: b.x - pad, y: b.y - pad, width: b.width + 2 * pad, height: b.height + 2 * pad } });
}
await icon("rail-du-an", page.locator(".app-rail .rail-btn", { hasText: "Dự án" }));
await icon("rail-hom-nay", page.locator(".app-rail .rail-btn", { hasText: "Hôm nay" }));
await icon("rail-clockwork", page.locator(".app-rail .rail-btn", { hasText: "Clockwork" }));
await icon("rail-tro-ly", page.locator(".app-rail .rail-btn", { hasText: "Trợ lý" }));
await icon("rail-avatar", page.locator(".app-rail .rail-avatar"));
await icon("project-switch", page.locator(".project-switch"));
await icon("tab-list", page.locator(".lens-tabs button", { hasText: "List" }));
await icon("tab-board", page.locator(".lens-tabs button", { hasText: "Board" }));
await icon("tab-resource", page.locator(".lens-tabs button", { hasText: "Resource" }));
await icon("tab-report", page.locator(".lens-tabs button", { hasText: "Report" }));
await icon("tabs", page.locator(".lens-tabs"));
await icon("create", page.locator(".hd-create"));
await icon("sync", page.locator(".sync-indicator"));
await icon("cmdk", page.locator(".cmdk-trigger"));
await icon("bo-loc", page.getByRole("button", { name: /Bộ lọc/ }));
await icon("da-luu", page.getByRole("button", { name: /Đã lưu/ }));
await icon("ve-hom-nay", page.getByRole("button", { name: /Về hôm nay/ }));
await icon("more", page.locator(".view-menu, .io-menu, [aria-label='Thêm']"));
await icon("ngay-tuan-thang", page.locator(".seg-group", { hasText: "Tuần" }));
await page.keyboard.press("Control+j");
await page.waitForSelector(".chat-dock .chat-composer textarea");
await page.waitForTimeout(600);

await row("DEMO-5").locator(".wbs-col-name").click();
await row("DEMO-6").locator(".wbs-col-name").click({ modifiers: ["Control"] });
await page.waitForSelector(".chat-selected-strip");
const r5 = await row("DEMO-5").boundingBox();
const r6 = await row("DEMO-6").boundingBox();
await shot("a1-chon-viec", [
  { box: { x: r5.x, y: r5.y, width: 560, height: r6.y + r6.height - r5.y }, n: 1, text: "Bấm việc thứ nhất, giữ Ctrl rồi bấm việc thứ hai", side: "right" },
  { sel: ".chat-selected-strip", n: 2, text: "Hoặc bấm Đính kèm", side: "top" },
]);

// Mid-drag: a real HTML5 drag (the dock lights up), with the arrow and the ghost drawn on top.
{
  const from = { x: r5.x + 200, y: r5.y + r5.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const to = await center(".chat-dock .chat-messages-wrap");
  await page.mouse.move(from.x + 40, from.y + 10, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.waitForTimeout(300);
  await dragPicture(from, to, "DEMO-5  Thiết kế cơ sở dữ liệu\nDEMO-6  Dựng API đăng nhập");
  await shot("a2-dang-keo", [{ sel: ".chat-dock", n: 3, text: "Kéo và thả vào cửa sổ trợ lý", side: "left" }]);
  await page.mouse.up();
}
await page.waitForSelector(".chat-tray .chat-chip[data-chip-key='DEMO-6']");
await page.fill(".chat-composer textarea", "Hai việc này đang vướng gì? Ai rảnh để làm cùng?");
await shot("a3-viec-da-dinh-kem", [
  { sel: ".chat-tray", n: 4, text: "Việc đã đính kèm (× để bỏ)", side: "top" },
  { sel: ".chat-composer textarea", n: 5, text: "Gõ câu hỏi rồi nhấn Enter", side: "left" },
]);
await page.keyboard.press("Enter");
await page.waitForFunction(() => document.querySelectorAll(".chat-msg-model").length > 0 && !document.querySelector(".chat-stop"));
await page.waitForTimeout(800);
await shot("a4-tra-loi", [
  { sel: ".chat-msg-user", n: 6, text: "Câu hỏi kèm các việc", side: "left" },
  { sel: ".chat-msg-model .chat-bubble", nth: 0, n: 7, text: "Trả lời; mã việc bấm được", side: "left" },
]);

// Window closed: starting a drag shows the drop zone.
await page.locator(".chat-composer textarea").focus();
await page.keyboard.press("Escape");
await page.waitForSelector(".chat-dock", { state: "detached" });
await page.waitForTimeout(400);
{
  const b = await row("DEMO-7").locator(".wbs-col-name").boundingBox();
  const from = { x: b.x + 40, y: b.y + b.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 20, { steps: 4 });
  await page.waitForSelector(".chat-dropzone");
  const to = await center(".chat-dropzone");
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.waitForTimeout(300);
  await dragPicture(from, to, "DEMO-7  Sửa lỗi hiển thị bảng");
  await shot("a5-vung-tha", [{ sel: ".chat-dropzone", n: 1, text: "Cửa sổ đang đóng: thả vào đây để mở và hỏi", side: "left" }]);
  await page.mouse.up();
  await page.waitForSelector(".chat-tray .chat-chip[data-chip-key='DEMO-7']");
  await page.locator(".chat-composer textarea").focus();
  await page.keyboard.press("Escape");
  await page.waitForSelector(".chat-dock", { state: "detached" });
}

// =============================================================================================
console.log("B. Cả một dự án từ một câu lệnh");
await post("/api/__guide/empty");
await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
await page.goto(APP + "?view=gantt");
await page.waitForSelector(".toolbar");
await page.waitForTimeout(1200);
await shot("b0-du-an-trong");
await page.keyboard.press("Control+j");
await page.waitForSelector(".chat-dock .chat-composer textarea");
await page.waitForTimeout(500);
const BRIEF = "Lập kế hoạch dự án Website bán hàng cho Công ty ABC: khảo sát, thiết kế, lập trình, kiểm thử, go-live. Bắt đầu hôm nay, xong trước 31/01/2027. Nguyễn Anh làm backend, Lê Chi làm giao diện, Trần Bình viết tài liệu và kiểm thử.";
await page.fill(".chat-composer textarea", BRIEF);
await shot("b1-yeu-cau", [{ sel: ".chat-composer", n: 1, text: "Mô tả dự án: việc gì, bắt đầu và hạn chót, ai làm gì", side: "left" }]);
await page.keyboard.press("Enter");
await page.waitForSelector(".chat-plan-card");
await page.waitForFunction(() => !document.querySelector(".chat-stop"));
await page.waitForTimeout(800);
await shot("b2-the-ke-hoach", [{ sel: ".chat-plan-card", n: 2, text: "Bấm thẻ để kiểm tra kế hoạch", side: "left" }]);

await page.locator(".chat-plan-card").last().click();
await page.waitForSelector(".ai-modal .ai-table tbody tr");
await page.waitForTimeout(600);
await shot("b3-kiem-tra-ke-hoach", [
  { sel: ".ai-modal .ai-table thead", n: 3, text: "Sửa tên, loại, số ngày, người; ngày tự tính lại", side: "top" },
  { sel: ".ai-modal .modal-footer .primary", n: 4, text: "Duyệt & tạo", side: "top" },
]);
// The one row the AI left without an owner: give it to Nguyễn Anh, and lengthen the UI design by two days.
{
  const infra = page.locator(".ai-modal .ai-table tbody tr", { has: page.locator("input[value='Chuẩn bị máy chủ và tên miền']") });
  await infra.scrollIntoViewIfNeeded();
  await infra.locator("select").nth(1).selectOption("anh");
  await page.waitForTimeout(500);
  await shot("b4-sua-ke-hoach", [{ sel: ".ai-modal .ai-table tbody tr:has(input[value='Chuẩn bị máy chủ và tên miền'])", n: 3, text: "AI để trống người làm: chọn Nguyễn Anh", side: "top" }]);
}
await page.locator(".ai-modal .modal-footer .primary").click();
await page.waitForSelector(".ai-modal .ai-result");
await page.waitForTimeout(600);
await shot("b5-da-tao", [{ sel: ".ai-modal .ai-result p", n: 5, text: "Các việc đã có trên Jira", side: "bottom" }]);
await page.locator(".ai-modal .ai-result button").click();
await page.waitForSelector(".ai-modal", { state: "detached" });
await page.keyboard.press("Control+j");
await page.waitForSelector(".chat-dock", { state: "detached" });
await page.waitForSelector(".wbs-row");
await page.getByRole("button", { name: "Tuần", exact: true }).first().click().catch(() => {});
await page.getByRole("button", { name: /Về hôm nay/ }).first().click().catch(() => {});
await page.waitForTimeout(1200);
await shot("b6-gantt", [
  { sel: ".wbs-row", nth: 0, n: 6, text: "Epic: giai đoạn của dự án", side: "right" },
]);

// Freeze the approved plan as the baseline: select everything, then Baseline… → Lưu.
await row("DEMO-102").locator(".wbs-col-name").click();
await page.keyboard.press("Control+a");
await page.waitForSelector(".selection-bar");
await page.waitForTimeout(400);
await shot("b7-chon-tat-ca", [
  { sel: ".selection-bar", n: 7, text: "Ctrl A chọn tất cả, rồi Baseline… → Lưu baseline = lịch hiện tại", side: "top" },
]);
await page.locator(".selection-bar select[aria-label^='Lưu hoặc xoá baseline']").selectOption("save");
await page.locator(".dlg button.primary").click({ timeout: 2000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.waitForSelector(".toast");
await shot("b8-da-chot-baseline", [{ sel: ".toast", n: 8, text: "Bình thường: Epic lấy lịch theo việc con nên được bỏ qua", side: "top" }]);
await page.keyboard.press("Escape");

// Three weeks later (stand-in only): the plan is moved back 21 days, the survey is done and the client's sign-off is late.
await post("/api/__guide/advance", { days: 21 });
await page.goto(APP + "?view=gantt");
await page.waitForSelector(".wbs-row");
await page.getByRole("button", { name: /Về hôm nay/ }).first().click().catch(() => {});
await page.waitForTimeout(1500);
await shot("b9-sau-3-tuan", [{ sel: ".wbs-row:has-text('Khách hàng duyệt SRS')", n: 1, text: "Việc trễ: thanh tô đỏ, các việc sau phải chờ", side: "bottom" }]);

await page.keyboard.press("4");
await page.waitForSelector(".pulse");
await page.waitForTimeout(1200);
await shot("b10-bao-cao", [
  { sel: ".pulse-lead", n: 1, text: "Kết luận: đúng hạn hay chậm", side: "right" },
  { sel: ".np-why", n: 2, text: "Bấm để xem lý do", side: "right" },
  { sel: ".np-fact.pr-tile", n: 3, text: "Bấm một con số để xem danh sách việc", side: "bottom" },
  { sel: ".pulse-actions", n: 4, text: "Nút làm ngay: Dời hạn, Giao lại", side: "left" },
]);
await page.locator(".np-why").click();
await page.waitForSelector(".pulse-reasons");
await shot("b11-vi-sao", [{ sel: ".pulse-reasons", n: 2, text: "Lý do, viết bằng lời", side: "right" }]);
await page.locator(".np-why").click();

await page.locator(".pr-analyze").click();
await page.waitForFunction(() => !document.querySelector(".pr-analyze"));
await page.waitForTimeout(1500);
{
  const b = await page.locator(".ai-brief, .pr-ai, aside").first().boundingBox();
  await shot("b12-ai-phan-tich", [{ box: { x: b.x + 6, y: b.y + 6, width: b.width - 12, height: 170 }, n: 5, text: "Nhận định AI: dự báo, vấn đề, đề xuất", side: "left" }]);
}

const overdue = page.locator(".np-fact.pr-tile", { hasText: "quá hạn" }).first();
if (await overdue.count()) {
  await overdue.click();
  await page.waitForSelector(".pr-drawer");
  await page.waitForTimeout(600);
  await shot("b13-danh-sach-qua-han", [{ sel: ".pr-drawer-tools .text-btn", n: 6, text: "Xuất CSV", side: "bottom" }]);
  await page.locator(".pr-drawer-close").click();
}
await page.locator("[aria-label='Thêm']").first().click();
await page.waitForSelector("[role=menu] .menu-item");
await shot("b14-menu-bao-cao", [{ sel: "[role=menu]", n: 7, text: "So sánh, sao chép liên kết, báo cáo Agile, In", side: "left" }]);
await page.keyboard.press("Escape");

await page.emulateMedia({ media: "print" });
await page.waitForTimeout(800);
await shot("b15-ban-in", [], { fullPage: true });
await page.emulateMedia({ media: "screen" });

await page.keyboard.press("Control+j");
await page.waitForSelector(".chat-dock .chat-composer textarea");
await page.locator(".chat-dock-header button[aria-label*='mới'], .chat-dock-header button[title*='mới']").first().click().catch(() => {});
await page.fill(".chat-composer textarea", "Viết báo cáo tiến độ tuần này");
await page.keyboard.press("Enter");
await page.waitForSelector(".chat-report-card");
await page.waitForFunction(() => !document.querySelector(".chat-stop"));
await page.waitForTimeout(800);
await shot("b16-bao-cao-tu-chat", [{ sel: ".chat-report-card", nth: 0, n: 8, text: "Bấm để mở báo cáo đã lưu", side: "left" }]);

await browser.close();
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(shots, null, 2));
console.log("Ảnh ở", OUT);
