// Booking (rail) và Resource › Booking (lăng kính), cùng Clockwork xuyên dự án.
// Luật: rail là một người trên mọi dự án, lăng kính là một dự án. API giả lập chạy đúng luật quyền thật
// (server/src/booking.ts): mặc định người đăng nhập quản lý DEMO; POST /api/__booking/role đổi vai.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = (process.env.E2E_APP ?? "http://localhost:5173/").replace(/\?.*$/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(8000);
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && !/403|404/.test(m.text()) && problems.push("console: " + m.text()));
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
const post = (path, body) => fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
const reset = () => fetch(API + "/api/__reset", { method: "POST" });
const logOf = async () => (await (await fetch(API + "/api/__log")).json()).log;
async function waitLog(pred, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = (await logOf()).find(pred);
    if (hit) return hit;
    await page.waitForTimeout(80);
  }
  throw new Error("không thấy yêu cầu mong đợi trong log");
}
const person = (id) => page.locator(`.bk-person[data-person="${id}"]`);
const peopleShown = () => page.locator(".bk-person").evaluateAll((els) => els.map((e) => e.dataset.person));
const PX = 18;
/** The x of the Monday `weeks` weeks from this one, plus `days`, in page pixels. */
async function xOf(weeks, days = 0) {
  const now = await page.locator(".bk-week.is-now").boundingBox();
  return now.x + (weeks * 7 + days) * PX + PX / 2;
}
async function dragOn(locator, fromX, toX) {
  const box = await locator.boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await page.mouse.move((fromX + toX) / 2, y, { steps: 3 });
  await page.mouse.move(toX, y, { steps: 3 });
  await page.mouse.up();
}
async function openBooking() {
  await page.goto(APP + "?view=booking");
  await page.waitForSelector(".bk-person");
}

await fetch(API + "/api/__restore", { method: "POST" });
await openBooking();

console.log("\n== Booking trên rail: một người trên mọi dự án ==");
await step("rail có Booking, đang ở đó thì không có hàng lăng kính, địa chỉ là ?view=booking", async () => {
  assert.equal(await page.locator(".app-rail .rail-btn[aria-current=page]", { hasText: "Booking" }).count() + (await page.locator(".app-rail .rail-btn.active", { hasText: "Booking" }).count()) > 0, true);
  assert.equal(await page.locator(".lens-tabs").count(), 0);
  assert.equal(new URL(page.url()).searchParams.get("view"), "booking");
});
await step("quản lý dự án thấy cả nhóm, mình đứng đầu và đã mở sẵn", async () => {
  const ids = await peopleShown();
  assert.equal(ids[0], "me");
  assert.deepEqual([...ids].sort(), ["anh", "binh", "chi", "me"]);
  assert.equal(await person("me").locator(".bk-row-project").count(), 2, "DEMO và OTHER");
});
await step("người bị book chồng có nhãn vượt công suất, lọc Quá tải chỉ còn người đó", async () => {
  assert.match(await person("anh").locator(".bk-over").textContent(), /vượt 5 ngày/);
  await page.locator(".bk-scope [data-filter=over]").click();
  assert.deepEqual(await peopleShown(), ["anh"]);
  await page.locator(".bk-scope [data-filter=all]").click();
});
await step("dự án không xem được hiện là 'Dự án khác': có giờ, không tên, không sửa được", async () => {
  await person("anh").locator(".bk-toggle").click();
  const other = person("anh").locator('.bk-row-project[data-project="other"]');
  assert.equal(await other.count(), 1);
  assert.match(await other.locator(".bk-name").textContent(), /Dự án khác/);
  assert.equal(await other.locator(".bk-bar.is-other").count(), 1);
  assert.equal(await other.locator(".bk-bar.is-editable").count(), 0);
  assert.equal((await page.content()).includes("SECRET"), false, "mã dự án bị ẩn không được lọt ra trang");
  assert.equal((await page.content()).includes("bí mật"), false, "ghi chú của dự án bị ẩn không được lọt ra trang");
});
await step("thanh công cụ nằm trên một dòng ở 1280px", async () => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const h = (await page.locator(".bk-toolbar").boundingBox()).height;
  assert.ok(h <= 52, `thanh cao ${h}px`);
  await page.setViewportSize({ width: 1440, height: 900 });
});

console.log("\n== Tạo, sửa, xoá ==");
await step("kéo trên dòng của một người rồi gõ 50%: tạo booking 4h/ngày Dự kiến trên dự án mình quản", async () => {
  await reset();
  const track = person("chi").locator(".bk-track-total");
  await dragOn(track, await xOf(1, 0), await xOf(1, 4));
  await page.waitForSelector(".bk-editor");
  await page.locator(".bk-ed-hours").fill("50%");
  await page.locator(".bk-ed-hours").press("Enter");
  const made = await waitLog((l) => l.m === "POST" && l.p === "/api/bookings");
  assert.equal(made.b.accountId, "chi");
  assert.equal(made.b.projectKey, "DEMO");
  assert.equal(made.b.hoursPerDay, 4);
  assert.equal(made.b.status, "tentative");
  assert.equal(Math.round((Date.parse(made.b.to) - Date.parse(made.b.from)) / 86400000), 4, "thứ Hai tới thứ Sáu");
  assert.equal(new Date(made.b.from + "T00:00:00Z").getUTCDay(), 1);
  await page.waitForSelector(".bk-editor", { state: "detached" });
  await person("chi").locator(".bk-toggle").click();
  assert.equal(await person("chi").locator(".bk-bar.is-tentative").count(), 1);
});
await step("bấm vào thanh rồi đổi sang Chắc: chỉ gửi đúng trường đã đổi", async () => {
  await reset();
  await person("chi").locator(".bk-bar.is-tentative").click();
  await page.waitForSelector(".bk-editor");
  await page.locator(".bk-ed-status button", { hasText: "Chắc" }).click();
  await page.locator(".bk-ed-hours").press("Enter");
  const patched = await waitLog((l) => l.m === "PATCH" && l.p.startsWith("/api/bookings/"));
  assert.deepEqual(patched.b, { status: "confirmed" });
  await page.waitForSelector(".bk-person[data-person=chi] .bk-bar.is-confirmed");
});
await step("gõ sai giờ thì khung không đóng và không gửi gì", async () => {
  await reset();
  await person("chi").locator(".bk-bar.is-confirmed").click();
  await page.locator(".bk-ed-hours").fill("4hh");
  await page.locator(".bk-ed-hours").press("Enter");
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".bk-editor").count(), 1);
  assert.equal(await page.locator(".bk-ed-hours.is-bad").count(), 1);
  assert.equal((await logOf()).length, 0);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".bk-editor", { state: "detached" });
});
await step("kéo mép phải thêm một tuần: chỉ đổi ngày kết thúc", async () => {
  await reset();
  const bar = person("chi").locator(".bk-bar.is-confirmed");
  const box = await bar.boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width - 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2 + 7 * PX, y, { steps: 5 });
  await page.mouse.up();
  const patched = await waitLog((l) => l.m === "PATCH" && l.p.startsWith("/api/bookings/"));
  assert.deepEqual(Object.keys(patched.b), ["to"], JSON.stringify(patched.b));
  assert.equal(new Date(patched.b.to + "T00:00:00Z").getUTCDay(), 5, "vẫn kết thúc vào thứ Sáu, tuần sau đó");
});
await step("Delete trên thanh xoá booking, Hoàn tác tạo lại đúng nó", async () => {
  await reset();
  await person("chi").locator(".bk-bar.is-confirmed").focus();
  await page.keyboard.press("Delete");
  await waitLog((l) => l.m === "DELETE" && l.p.startsWith("/api/bookings/"));
  assert.equal(await person("chi").locator(".bk-bar").count(), 0);
  await page.locator(".toast button", { hasText: "Hoàn tác" }).click();
  const again = await waitLog((l) => l.m === "POST" && l.p === "/api/bookings");
  assert.equal(again.b.accountId, "chi");
  assert.equal(again.b.status, "confirmed");
  await page.waitForSelector(".bk-person[data-person=chi] .bk-bar.is-confirmed");
});
await step("book chồng lên người đã kín: vẫn tạo, có lời báo vượt công suất", async () => {
  await reset();
  await dragOn(person("binh").locator(".bk-track-total"), await xOf(0, 0), await xOf(0, 4));
  await page.waitForSelector(".bk-editor");
  await page.locator(".bk-ed-hours").fill("4");
  await page.locator(".bk-ed-hours").press("Enter");
  await waitLog((l) => l.m === "POST" && l.p === "/api/bookings");
  await page.waitForSelector(".toast", { hasText: "vượt công suất" });
});
await step("nghỉ phép: kéo trên dòng Nghỉ của mình, ghi lý do", async () => {
  await reset();
  await dragOn(person("me").locator('.bk-row-leave .bk-track'), await xOf(2, 1), await xOf(2, 2));
  await page.waitForSelector(".bk-editor");
  await page.locator(".bk-ed-note").fill("phép năm");
  await page.locator(".bk-ed-note").press("Enter");
  const leave = await waitLog((l) => l.m === "POST" && l.p === "/api/bookings/absences");
  assert.equal(leave.b.accountId, "me");
  assert.equal(leave.b.reason, "phép năm");
  await page.waitForSelector(".bk-person[data-person=me] .bk-bar.is-leave");
});
await step("+ Người: thêm người chưa có dòng để book", async () => {
  await page.locator(".bk-add-person").click();
  await page.locator(".bk-person-menu input").fill("Dũng");
  await page.locator(".bk-person-menu .menu-item", { hasText: "Phạm Dũng" }).click();
  assert.ok((await peopleShown()).includes("dung"));
});

console.log("\n== Thành viên ==");
await step("thành viên chỉ thấy dòng của mình, chỉ đọc, không có + Người", async () => {
  await post("/api/__booking/reset");
  await post("/api/__booking/role", { role: "member" });
  await openBooking();
  assert.deepEqual(await peopleShown(), ["me"]);
  assert.equal(await page.locator(".bk-bar.is-editable").count(), 0);
  assert.equal(await page.locator(".bk-add-person").count(), 0);
  assert.equal(await page.locator(".bk-add").count(), 0);
  assert.equal(await page.locator(".bk-search").count(), 0, "một người thì không cần ô tìm");
  assert.equal(await person("me").locator(".bk-row-project .bk-bar").count(), 2);
});
await step("thành viên vẫn tự nhập được nghỉ phép của mình", async () => {
  assert.equal(await person("me").locator(".bk-row-leave .bk-track.is-creatable").count(), 1);
});

console.log("\n== Quản lý nguồn lực ==");
await step("quản lý nguồn lực sửa được booking của mọi dự án mình xem được", async () => {
  await post("/api/__booking/role", { role: "manager" });
  await openBooking();
  assert.equal(await person("me").locator('.bk-row-project[data-project="OTHER"] .bk-bar.is-editable').count(), 1);
});

console.log("\n== Resource › Booking: một dự án ==");
await step("lăng kính Resource mở ở Booking, cắt về dự án đang mở", async () => {
  await post("/api/__booking/reset");
  const asked = page.waitForRequest((r) => r.url().includes("/api/bookings?") && r.url().includes("project=DEMO"));
  await page.goto(APP + "?view=resource");
  await asked;
  await page.waitForSelector(".bk-wrap.is-project .bk-person");
  assert.equal(await page.locator(".rv-modes [data-mode=booking][aria-selected=true]").count(), 1);
  assert.equal(await page.locator(".lens-tabs").count(), 1);
});
await step("chuyển sang Mức tải rồi quay lại vẫn được, chế độ được nhớ", async () => {
  await page.locator(".rv-modes [data-mode=load]").click();
  await page.waitForSelector(".resource-view");
  await page.locator(".rv-modes [data-mode=booking]").click();
  await page.waitForSelector(".bk-wrap.is-project");
});
await step("việc đã giao vượt booking thì dòng dự án nói ra", async () => {
  await person("chi").locator(".bk-toggle").click();
  assert.match(await person("chi").locator(".bk-gap").textContent(), /giao \d+(\.\d+)?h · book 0h/);
});
await step("Book từ việc đã giao: hỏi trước, tạo booking Dự kiến, chạy lại không tạo thêm", async () => {
  await reset();
  await page.locator(".bk-more").click();
  await page.locator(".bk-from-load").click();
  await page.waitForSelector(".dlg");
  await page.locator(".dlg button.primary").click();
  const made = await waitLog((l) => l.m === "POST" && l.p === "/api/bookings" && l.b.accountId === "chi");
  assert.equal(made.b.status, "tentative");
  assert.equal(made.b.projectKey, "DEMO");
  await page.waitForSelector(".toast", { hasText: "Đã tạo" });
  await page.waitForSelector(".bk-person[data-person=chi] .bk-bar.is-tentative");
  await page.waitForTimeout(600);
  await reset();
  await page.locator(".bk-more").click();
  await page.locator(".bk-from-load").click();
  await page.waitForSelector(".toast", { hasText: "đều đã có booking" });
  assert.equal((await logOf()).length, 0);
});

console.log("\n== Clockwork: giờ của tôi trên mọi dự án ==");
await step("dòng gom theo dự án, mỗi dự án có giờ đã ghi cạnh giờ được book", async () => {
  await post("/api/__booking/reset");
  await page.goto(APP + "?view=timesheet");
  await page.waitForSelector(".ts-mine");
  const groups = await page.locator(".ts-group-row").evaluateAll((els) => els.map((e) => e.dataset.project));
  assert.deepEqual(groups, ["DEMO", "OTHER"]);
  assert.match(await page.locator('.ts-group-row[data-project="DEMO"] .ts-booked').textContent(), /4\s*\/\s*20h book/);
  assert.match(await page.locator(".ts-tile-booked").textContent(), /30h/);
});
await step("ghi giờ cho việc của dự án khác: yêu cầu mang đúng dự án của việc đó", async () => {
  await reset();
  const sent = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/timesheet/worklogs"));
  const cell = page.locator('.ts-mine input[data-key="OTHER-7"]').first();
  await cell.fill("2");
  await cell.press("Enter");
  const req = await sent;
  assert.equal(req.headers()["x-project-key"], "OTHER");
  const posted = await waitLog((l) => l.m === "POST" && l.p === "/api/timesheet/worklogs");
  assert.equal(posted.b.issueKey, "OTHER-7");
});
await step("Cả nhóm: có cột book và ô lọc người lệch booking", async () => {
  await page.locator("[data-scope=team]").click();
  await page.waitForSelector(".ts-team");
  assert.ok((await page.locator(".ts-team .ts-booked").count()) > 0);
  await page.locator(".ts-tile-off").click();
  assert.ok((await page.locator(".ts-team .ts-prow").count()) > 0);
  assert.equal(await page.locator(".ts-team .ts-prow .ts-booked:not(.is-off)").count(), 0);
  await page.locator(".ts-tile-off").click();
  await page.locator("[data-scope=mine]").click();
});
await step("thành viên không có Cả nhóm", async () => {
  await post("/api/__booking/role", { role: "member" });
  await page.reload();
  await page.waitForSelector(".ts-mine");
  assert.equal(await page.locator("[data-scope=team]").count(), 0);
});

console.log("\n== Phím ==");
await step("G B tới Booking, G T tới Clockwork", async () => {
  await post("/api/__booking/role", { role: "pm" });
  await page.goto(APP + "?view=gantt");
  await page.waitForSelector(".wbs-row");
  await page.keyboard.press("g");
  await page.keyboard.press("b");
  await page.waitForSelector(".bk-wrap.is-site");
  await page.keyboard.press("g");
  await page.keyboard.press("t");
  await page.waitForSelector(".ts-wrap");
});

console.log("\n== Giai đoạn 4: phím, kéo sang người khác, nối vào phần còn lại ==");
await step("J / K đi giữa các dòng người, Enter mở hoặc đóng, N mở khung book cho người đang chọn", async () => {
  await post("/api/__booking/reset");
  await openBooking();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  const cursorOf = () => page.locator(".bk-person.is-cursor").evaluateAll((els) => els.map((e) => e.dataset.person));
  // The cursor is React state: a key press has rendered only a moment later, so wait for it rather than read at once.
  const cursorIs = async (id) => {
    await page.waitForSelector(`.bk-person.is-cursor[data-person="${id}"]`, { timeout: 3000 });
    assert.deepEqual(await cursorOf(), [id]);
  };
  await page.keyboard.press("j");
  await cursorIs("me");
  await page.keyboard.press("j");
  await page.waitForSelector(".bk-person.is-cursor:not([data-person=me])", { timeout: 3000 });
  const second = await cursorOf();
  assert.equal(second.length, 1);
  await page.keyboard.press("k");
  await cursorIs("me");
  assert.equal(await person("me").locator(".bk-row-project").count(), 2, "mình đang mở");
  await page.keyboard.press("Enter");
  assert.equal(await person("me").locator(".bk-row-project").count(), 0, "Enter đóng dòng");
  await page.keyboard.press("Enter");
  assert.equal(await person("me").locator(".bk-row-project").count(), 2, "Enter mở lại");
  await page.keyboard.press("n");
  await page.waitForSelector(".bk-editor");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".bk-editor", { state: "detached" });
});
await step("kéo thân thanh sang dòng người khác: chỉ gửi accountId", async () => {
  await post("/api/__booking/reset");
  await openBooking();
  await person("binh").locator(".bk-toggle").click();
  const bar = person("binh").locator(".bk-bar.is-tentative");
  const from = await bar.boundingBox();
  const to = await person("chi").locator(".bk-track-total").boundingBox();
  const x = from.x + from.width / 2;
  await page.mouse.move(x, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(x, to.y + to.height / 2, { steps: 4 });
  assert.equal(await page.locator(".bk-person.is-drop[data-person=chi]").count(), 1, "dòng nhận được tô viền");
  await page.mouse.up();
  const patched = await waitLog((l) => l.m === "PATCH" && l.p.startsWith("/api/bookings/"));
  assert.deepEqual(patched.b, { accountId: "chi" }, JSON.stringify(patched.b));
  await page.waitForSelector(".bk-person[data-person=chi] .bk-bar.is-tentative");
  assert.equal(await person("binh").locator(".bk-bar.is-tentative").count(), 0);
});
await step("thả sang dòng của dự án khác hoặc dòng Nghỉ thì không đổi người", async () => {
  await post("/api/__booking/reset");
  await openBooking();
  await person("binh").locator(".bk-toggle").click();
  await reset();
  const bar = person("binh").locator(".bk-bar.is-tentative");
  const from = await bar.boundingBox();
  const leave = await person("me").locator(".bk-row-leave .bk-track").boundingBox();
  const x = from.x + from.width / 2;
  await page.mouse.move(x, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, leave.y + leave.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  assert.equal((await logOf()).filter((l) => l.m === "PATCH").length, 0);
  assert.equal(await page.locator(".bk-editor").count(), 0, "kéo hụt không mở khung sửa");
});

await step("việc của dự án khác không giao cho mình tìm được ở + Thêm việc, và dòng có tên", async () => {
  await post("/api/__booking/reset");
  await page.goto(APP + "?view=timesheet");
  await page.waitForSelector(".ts-mine");
  await page.locator(".ts-add").click();
  await page.locator(".cell-picker input").fill("hợp đồng");
  const row = page.locator(".cell-picker-item", { hasText: "OTHER-12" });
  await row.waitFor();
  assert.match(await row.innerText(), /Rà soát hợp đồng khách hàng/);
  await row.click();
  const line = page.locator('.ts-mine tr[data-key="OTHER-12"], .ts-mine [data-key="OTHER-12"]').first();
  await line.waitFor();
  assert.match(await page.locator(".ts-mine").innerText(), /Rà soát hợp đồng khách hàng/);
});

await step("gợi ý giao việc trừ giờ đã book ở dự án khác: 'bị giữ 8h/ngày'", async () => {
  await post("/api/__booking/reset");
  const today = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const later = new Date(today.getTime() + 21 * 86400000);
  await post("/api/__booking/role", { role: "manager" });
  const made = await post("/api/bookings", { accountId: "chi", projectKey: "OTHER", from: iso(today), to: iso(later), hoursPerDay: 8, status: "confirmed" });
  assert.equal(made.status, 201);
  await post("/api/__booking/role", { role: "pm" });
  await reset();
  await page.goto(APP + "?view=gantt");
  await page.waitForSelector(".wbs-row");
  await page.waitForTimeout(1500);
  await page.locator('.wbs-row[data-row-id="DEMO-7"]').click();
  await page.keyboard.press("a");
  await page.waitForSelector(".cell-picker-item");
  const items = await page.locator(".cell-picker-item").allTextContents();
  const chi = items.find((t) => t.includes("Lê Chi")) ?? "";
  assert.match(chi, /bị giữ 8h\/ngày/, items.join(" | "));
  assert.doesNotMatch(chi, /rảnh/);
  await page.keyboard.press("Escape");
});
await step("huy hiệu của lăng kính Resource đếm người vượt công suất theo booking", async () => {
  await post("/api/__booking/reset");
  await page.goto(APP + "?view=gantt");
  await page.waitForSelector(".wbs-row");
  // Counted by Mức tải until the bookings arrive (fetched with the board), then by booking.
  await page.waitForFunction(() => /^1(\s|$)/.test(document.querySelector(".lens-tabs .tab-badge")?.textContent?.trim() ?? ""), null, { timeout: 5000 }).catch(async (e) => {
    throw new Error("huy hiệu: " + JSON.stringify(await page.locator(".lens-tabs").innerText()) + " " + String(e.message).split("\n")[0]);
  });
});

await step("Nhịp dự án: người được giao nhiều hơn booking có dòng, 'Book thêm' mở Booking đúng người", async () => {
  await post("/api/__booking/reset");
  await page.goto(APP + "?view=report");
  const row = page.locator(".pulse-row", { hasText: "nhiều hơn booking" });
  await row.waitFor();
  assert.match(await row.innerText(), /Lê Chi/);
  assert.match(await row.innerText(), /mới book 0h trên DEMO/);
  await row.locator("button", { hasText: "Book thêm" }).click();
  await page.waitForSelector(".bk-wrap.is-project .bk-person");
  await page.waitForSelector(".bk-person.is-cursor[data-person=chi].is-open");
  assert.equal(new URL(page.url()).searchParams.get("view"), "resource");
});

await fetch(API + "/api/__restore", { method: "POST" });
assert.deepEqual(problems, [], problems.join("\n"));
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
await browser.close();
process.exit(failed ? 1 : 0);
