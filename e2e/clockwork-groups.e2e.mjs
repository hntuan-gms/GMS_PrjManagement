// Clockwork "Của tôi" gom theo dự án (client/src/clockworkLayout.ts): dự án ghi giờ gần nhất đứng đầu, ghim đưa
// một dự án lên đầu, mỗi dự án có "+ Thêm việc" của riêng nó, dự án gấp/mở được và được nhớ, "Dự án khác" đưa
// vào một dự án chưa có gì trên trang. Không có thanh "+ Thêm việc" chung ở cuối, không lộ điểm hay chữ "gợi ý".
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = (process.env.E2E_APP ?? "http://localhost:5173/").replace(/\?.*$/, "");
const URL_CW = APP + "?view=timesheet";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(8000);
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
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
const post = (path, body) => fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
const groups = () => page.locator(".ts-mine .ts-group-row").evaluateAll((els) => els.map((e) => e.dataset.project));
const rowsIn = (project) => page.locator(`.ts-mine .ts-row[data-project="${project}"] .ts-key`).allTextContents();
const open = async () => {
  await page.goto(URL_CW);
  await page.waitForSelector(".ts-mine .ts-group-row");
};

await post("/api/__restore");
await post("/api/__clockwork/role", { role: "pm" });
await page.goto(URL_CW);
await page.evaluate(() => {
  for (const k of Object.keys(localStorage)) if (k.startsWith("gms.cw.")) localStorage.removeItem(k);
});
await open();

console.log("\n== Clockwork: nhóm theo dự án ==");
await step("dự án ghi giờ gần nhất đứng đầu; dự án không có gì thì không hiện", async () => {
  assert.deepEqual(await groups(), ["DEMO", "OTHER"]);
  assert.equal(await page.locator('.ts-group-row[data-project="TRAIN"]').count(), 0);
});
await step("trong dự án: việc đã ghi trong kỳ, rồi việc ghi trước kỳ, rồi việc được giao", async () => {
  const keys = await rowsIn("DEMO");
  assert.equal(keys[0], "DEMO-3", "việc đã ghi hôm nay đứng đầu");
  assert.equal(keys[1], "DEMO-5", "việc ghi tuần trước đứng thứ hai, dù không còn giao cho mình");
  assert.ok(keys.includes("DEMO-9"), "việc được giao cho mình có dòng");
});
await step("không lộ điểm, không chữ 'gợi ý'; nút ghim luôn nhìn thấy ở mỗi dự án", async () => {
  const text = await page.locator(".ts-mine").innerText();
  assert.doesNotMatch(text, /gợi ý|điểm/i);
  for (const p of ["DEMO", "OTHER"]) {
    const pin = page.locator(`.ts-group-row[data-project="${p}"] button.ts-pin`);
    assert.ok(await pin.isVisible(), `nút ghim của ${p} phải thấy được khi không rê chuột`);
    assert.equal(await pin.getAttribute("aria-pressed"), "false");
  }
});
await step("mỗi dự án có '+ Thêm việc' riêng ngay dưới việc của nó; không có thanh thêm việc chung ở cuối", async () => {
  assert.equal(await page.locator(".ts-add-row").count(), 2);
  const last = await page.locator(".ts-mine tbody tr").last().getAttribute("class");
  assert.match(last, /ts-others-row/, "dòng cuối là 'Dự án khác', không phải ô thêm việc chung");
  const order = await page.locator(".ts-mine tbody tr").evaluateAll((trs) => trs.map((t) => `${t.className.split(" ")[0]}:${t.dataset.project ?? ""}`));
  const demoAdd = order.indexOf("ts-add-row:DEMO");
  assert.equal(order[demoAdd + 1], "ts-group-row:OTHER", "'+ Thêm việc' của DEMO nằm ngay trước nhóm OTHER");
});

console.log("\n== Ghim ==");
await step("ghim OTHER: lên đầu ngay, nút đổi trạng thái, F5 vẫn ở đầu", async () => {
  await page.locator('.ts-group-row[data-project="OTHER"] button.ts-pin').click();
  assert.deepEqual(await groups(), ["OTHER", "DEMO"]);
  assert.equal(await page.locator('.ts-group-row[data-project="OTHER"] button.ts-pin').getAttribute("aria-pressed"), "true");
  await open();
  assert.deepEqual(await groups(), ["OTHER", "DEMO"]);
});
await step("bỏ ghim: về chỗ theo giờ đã ghi", async () => {
  await page.locator('.ts-group-row[data-project="OTHER"] button.ts-pin').click();
  await open();
  assert.deepEqual(await groups(), ["DEMO", "OTHER"]);
});

console.log("\n== Gấp / mở ==");
await step("bấm tên dự án thì gấp lại, tiêu đề nói còn bao nhiêu việc; F5 vẫn gấp; bấm lần nữa thì mở", async () => {
  await page.locator('.ts-group-row[data-project="DEMO"] button.ts-group-toggle').click();
  // The rows fade out before they go.
  await page.waitForFunction(() => document.querySelectorAll('.ts-row[data-project="DEMO"]').length === 0);
  assert.equal(await page.locator('.ts-add-row[data-project="DEMO"]').count(), 0);
  assert.match(await page.locator('.ts-group-row[data-project="DEMO"]').innerText(), /\d+ việc/);
  assert.equal(await page.locator('.ts-group-row[data-project="DEMO"] button.ts-group-toggle').getAttribute("aria-expanded"), "false");
  await open();
  assert.equal((await rowsIn("DEMO")).length, 0);
  await page.locator('.ts-group-row[data-project="DEMO"] button.ts-group-toggle').click();
  assert.ok((await rowsIn("DEMO")).length > 0);
});

console.log("\n== Thêm việc theo dự án ==");
await step("'+ Thêm việc' của OTHER: chưa gõ đã có việc của OTHER; gõ thì tìm cả việc đã xong", async () => {
  await page.locator('.ts-add-row[data-project="OTHER"] button.ts-add').click();
  await page.waitForSelector('.cell-picker input[placeholder="Thêm việc vào OTHER"]');
  await page.locator(".cell-picker-item", { hasText: "OTHER-12" }).waitFor();
  assert.equal(await page.locator(".cell-picker-item", { hasText: "DEMO-" }).count(), 0, "chưa gõ thì chỉ là việc của OTHER");
  await page.locator(".cell-picker input").fill("bàn giao");
  const done = page.locator(".cell-picker-item", { hasText: "OTHER-14" });
  await done.waitFor();
  assert.match(await done.innerText(), /xong/);
  await done.click();
  await page.waitForFunction(() => !!document.querySelector('.ts-row[data-project="OTHER"] input[data-key="OTHER-14"]'));
  assert.ok((await rowsIn("OTHER")).includes("OTHER-14"));
});

console.log("\n== Dự án khác ==");
await step("'Dự án khác' đưa vào một dự án chưa có gì: hiện nhóm mở sẵn, có '+ Thêm việc' riêng", async () => {
  await page.locator("button.ts-others").click();
  await page.locator(".cell-picker-item", { hasText: "TRAIN" }).click();
  await page.waitForSelector('.ts-group-row[data-project="TRAIN"]');
  await page.locator('.ts-add-row[data-project="TRAIN"] button.ts-add').click();
  await page.locator(".cell-picker-item", { hasText: "TRAIN-1" }).click();
  await page.waitForFunction(() => !!document.querySelector('.ts-row[data-project="TRAIN"] input[data-key="TRAIN-1"]'));
  assert.equal(await page.locator("button.ts-others").count(), 0, "không còn dự án nào khác để đưa vào");
});

console.log("\n== Ẩn bớt ==");
await step("ẩn dự án: chỉ dự án chưa ghi giờ trong kỳ mới có nút; bấm thì biến mất, 'Hoàn tác' đưa lại", async () => {
  await open();
  assert.equal(await page.locator('.ts-group-row[data-project="DEMO"] button.ts-hide').count(), 0, "DEMO đã có giờ trong kỳ, không ẩn được");
  const hide = page.locator('.ts-group-row[data-project="OTHER"] button.ts-hide');
  await page.mouse.move(5, 5);
  assert.equal(await hide.evaluate((b) => getComputedStyle(b).opacity), "0", "nút ẩn là việc phụ: chỉ hiện khi rê chuột vào dòng dự án");
  await page.locator('.ts-group-row[data-project="OTHER"]').hover();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.ts-group-row[data-project="OTHER"] button.ts-hide')).opacity === "1");
  await hide.click();
  assert.equal(await page.locator('.ts-group-row[data-project="OTHER"]').count(), 0);
  await page.locator(".toast-action", { hasText: "Hoàn tác" }).click();
  await page.waitForSelector('.ts-group-row[data-project="OTHER"]');
});
await step("dự án đã ẩn: F5 vẫn ẩn, có trong '+ Thêm dự án'; chọn lại thì hiện và không còn bị ẩn", async () => {
  await page.locator('.ts-group-row[data-project="OTHER"]').hover();
  await page.locator('.ts-group-row[data-project="OTHER"] button.ts-hide').click();
  await open();
  assert.equal(await page.locator('.ts-group-row[data-project="OTHER"]').count(), 0);
  assert.equal((await page.locator("button.ts-others").innerText()).trim(), "Thêm dự án", "nút ghi rõ là thêm dự án");
  await page.locator("button.ts-others").click();
  await page.locator(".cell-picker-item", { hasText: "OTHER" }).click();
  await page.waitForSelector('.ts-group-row[data-project="OTHER"]');
  await open();
  assert.ok((await groups()).includes("OTHER"), "chọn lại từ 'Dự án khác' là bỏ ẩn");
});
await step("ẩn dòng bằng × (hiện khi rê chuột vào dòng): F5 vẫn ẩn, chọn lại từ '+ Thêm việc' thì hiện", async () => {
  const row = page.locator('.ts-row[data-project="DEMO"]', { hasText: "DEMO-9" });
  await row.hover();
  await row.locator("button.ts-dismiss").click();
  assert.ok(!(await rowsIn("DEMO")).includes("DEMO-9"));
  await open();
  assert.ok(!(await rowsIn("DEMO")).includes("DEMO-9"), "dòng đã ẩn không quay lại sau F5");
  await page.locator('.ts-add-row[data-project="DEMO"] button.ts-add').click();
  await page.locator(".cell-picker input").fill("DEMO-9");
  await page.locator(".cell-picker-item", { hasText: "DEMO-9" }).first().click();
  await page.waitForFunction(() => !!document.querySelector('.ts-row[data-project="DEMO"] input[data-key="DEMO-9"]'));
});

console.log("\n== Việc vừa xong ==");
await step("việc của mình vừa chuyển sang Done vẫn có dòng để ghi giờ, kèm dấu đã xong", async () => {
  const done = await fetch(API + "/api/tasks/DEMO-9", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ statusTransition: "Done", transitionFields: { customfield_9: "xong" } }),
  });
  assert.ok(done.ok, `không chuyển được DEMO-9 sang Done: ${done.status}`);
  await open();
  assert.ok((await rowsIn("DEMO")).includes("DEMO-9"), "DEMO-9 vừa xong phải còn dòng");
  const glyph = page.locator('.ts-row[data-project="DEMO"]', { hasText: "DEMO-9" }).locator("svg.status-glyph");
  assert.match(await glyph.getAttribute("class"), /sg-done/);
});

console.log("\n== Hiện thêm / Thu gọn, mở việc ==");
await step("'Hiện thêm n việc' mở từ từ: dự án bên dưới trượt xuống, không nhảy; nút thành 'Thu gọn'", async () => {
  await post("/api/__tasks/generate", { n: 80 });
  await open();
  const more = page.locator('.ts-add-row[data-project="DEMO"] button.ts-more-rows');
  assert.match(await more.innerText(), /^Hiện thêm \d+ việc$/);
  assert.equal(await more.getAttribute("aria-expanded"), "false");
  const before = await page.locator('.ts-row[data-project="DEMO"]').count();
  const top = () => page.locator('tr[data-flip="group:OTHER"]').evaluate((r) => r.getBoundingClientRect().top);
  const start = await top();
  await more.click();
  const seen = [];
  for (let i = 0; i < 12; i++) {
    seen.push(await top());
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(400);
  const end = await top();
  assert.ok(end > start + 60, "dự án bên dưới phải xuống chỗ mới");
  assert.ok(seen.some((y) => y > start + 5 && y < end - 5), `phải có lúc ở giữa đường (đi từ từ), thấy: ${seen.map(Math.round).join(", ")}`);
  assert.ok((await page.locator('.ts-row[data-project="DEMO"]').count()) > before);
  assert.equal(await more.innerText(), "Thu gọn");
  assert.equal(await more.getAttribute("aria-expanded"), "true");
});
await step("'Thu gọn' về lại như cũ, không dòng nào kẹt ở trạng thái mờ", async () => {
  const more = page.locator('.ts-add-row[data-project="DEMO"] button.ts-more-rows');
  await more.click();
  await page.waitForFunction(() => document.querySelectorAll('.ts-row[data-project="DEMO"]').length === 8);
  await page.waitForTimeout(400);
  assert.match(await more.innerText(), /^Hiện thêm \d+ việc$/);
  const faded = await page.locator(".ts-mine tr").evaluateAll((trs) => trs.filter((t) => getComputedStyle(t).opacity !== "1").length);
  assert.equal(faded, 0);
});
await step("việc của dự án khác mở được: tab mới, đúng dự án", async () => {
  const btn = page.locator('.ts-row[data-project="OTHER"]').first().locator("button.ts-open");
  assert.match(await btn.getAttribute("title"), /tab mới/);
  const [popup] = await Promise.all([page.context().waitForEvent("page"), btn.click()]);
  await popup.waitForFunction(() => document.querySelector(".toolbar")?.textContent?.includes("OTHER"), null, { timeout: 15000 });
  await popup.close();
});
await step("việc của dự án đang mở hiện ngay trong khung chi tiết", async () => {
  await page.locator('.ts-row[data-project="DEMO"]', { hasText: "DEMO-3" }).locator("button.ts-open").click();
  await page.waitForSelector(".modal .modal-id");
  assert.match(await page.locator(".modal .modal-id").textContent(), /DEMO-3/);
  await page.keyboard.press("Escape");
  await post("/api/__restore");
});

console.log("\n== Ngày nghỉ phép ==");
await step("ngày nghỉ phép có giờ ghi không bị tính là vượt công suất", async () => {
  const iso = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const made = await post("/api/resources/me/absences", { from: iso, to: iso });
  assert.ok(made.ok, `không thêm được kỳ nghỉ: ${made.status}`);
  await open();
  const foot = page.locator(".ts-mine tfoot td.ts-foot.is-today");
  const cls = await foot.getAttribute("class");
  assert.doesNotMatch(cls, /st-over/);
  assert.match(cls, /st-extra/);
  assert.equal(await foot.getAttribute("title"), "Ghi giờ trong ngày nghỉ phép");
});

await step("không có lỗi trên trang", async () => {
  assert.deepEqual(problems, []);
});

await page.evaluate(() => {
  for (const k of Object.keys(localStorage)) if (k.startsWith("gms.cw.")) localStorage.removeItem(k);
});
await post("/api/__restore");
await browser.close();
if (failed) {
  console.log(`\n${failed} bước hỏng`);
  process.exit(1);
}
