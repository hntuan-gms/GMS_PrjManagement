// The resource tab's layout contract, in a real browser against the stand-in API: two rows of chrome
// (toolbar + KPI pills), work nobody owns as a floating card that is closed until asked for and fades
// while something is dragged, a person's tasks opened inline under their row on the heatmap's own date
// columns, and the profile & leave slide-over. What reaches Jira for real is on the manual checklist.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.setDefaultTimeout(8000);
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && problems.push("console: " + m.text()));
page.on("dialog", (d) => {
  problems.push("native dialog: " + d.message());
  d.dismiss();
});
let failed = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log("  ok  ", name);
  } catch (e) {
    failed++;
    console.log("  FAIL", name, "\n       ", String(e.message).split("\n").slice(0, 4).join(" | "));
  }
}
const log = async () => (await (await fetch(API + "/api/__log")).json()).log;
const reset = () => fetch(API + "/api/__reset", { method: "POST" });
async function waitLog(pred) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    const hit = (await log()).find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("request never reached the API");
}
const api = (method, path, body) =>
  fetch(API + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
const isoIn = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const ID = { "Nguyễn Anh": "anh", "Trần Bình": "binh", "Lê Chi": "chi" };

// Data: Anh holds two overlapping tasks (DEMO-5 and DEMO-7), and two dated tasks belong to nobody.
await api("POST", "/api/__restore");
await api("PATCH", "/api/tasks/DEMO-7", { assigneeAccountId: "anh" });
for (const [summary, d] of [["Việc mới chưa gán một", 2], ["Việc mới chưa gán hai", 5]]) {
  await api("POST", "/api/tasks", { summary, issueType: "Task", startDate: isoIn(d), dueDate: isoIn(d + 2) });
}
await api("POST", "/api/tasks", {
  summary: "Một tên công việc dài dòng đến mức không thể nào vừa trong một thẻ nổi rộng bốn trăm hai mươi pixel",
  issueType: "Task",
  startDate: isoIn(3),
  dueDate: isoIn(4),
});
await reset();

await page.goto(process.env.E2E_APP ?? "http://localhost:5173/");
await page.waitForSelector(".wbs-row");
await page.locator(".toolbar-tabs button", { hasText: "Nguồn lực" }).click();
await page.waitForSelector(".resource-view .rv-row-person");

const rect = (sel) => page.locator(sel).first().boundingBox();
const rowOf = (name) => page.locator(".rv-row-person", { hasText: name });
// The window, read from (and written through) the exact-date boxes in the "Khoảng" menu.
const windowOf = async () => {
  await page.locator(".rv-preset").click();
  const inputs = page.locator(".rv-exact input[type=date]");
  const w = { from: await inputs.nth(0).inputValue(), to: await inputs.nth(1).inputValue() };
  await page.keyboard.press("Escape");
  return w;
};
const setWindow = async (from, to) => {
  await page.locator(".rv-preset").click();
  const inputs = page.locator(".rv-exact input[type=date]");
  await inputs.nth(0).fill(from);
  await inputs.nth(1).fill(to);
  await page.keyboard.press("Escape");
};
const lenOf = (w) => (Date.parse(w.to) - Date.parse(w.from)) / 86400000 + 1;

console.log("\n== Hai hàng: toolbar + KPI ==");
await step("toolbar một hàng và hàng KPI một dòng ở 1500px và 1280px, trang không cuộn ngang", async () => {
  for (const width of [1500, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    const bar = await rect(".resource-view > .tf-bar");
    assert.ok(bar.height <= 56, `toolbar ở ${width}px cao ${bar.height} — đã xuống dòng`);
    const kpi = await rect(".rv-kpis");
    assert.ok(kpi.height <= 44, `hàng KPI ở ${width}px cao ${kpi.height} — đã xuống dòng`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 0, `trang cuộn ngang ${over}px ở ${width}px`);
  }
  await page.setViewportSize({ width: 1500, height: 900 });
});
await step("không còn ô 'Chỉ hiện người đang có việc' và dòng chữ vai trò Jira; có nút lọc đã lưu, Quá hạn, + Bộ lọc", async () => {
  const text = await page.locator(".resource-view").innerText();
  assert.ok(!text.includes("Chỉ hiện người đang có việc"));
  assert.equal(await page.locator(".resource-view input[type=checkbox]").count(), 0, "còn ô tick trên trang");
  assert.equal(await page.locator(".rv-source").count(), 0);
  assert.ok(!text.includes("lấy từ vai trò dự án"), "dòng chữ nguồn danh sách phải nằm trong ⓘ");
  for (const t of ["Mức tải", "Kỹ năng", "Quá hạn", "Bộ lọc"]) assert.ok(text.includes(t), t + " thiếu");
  assert.equal(await page.locator(".resource-view .tf-bar .sf-select").count(), 1, "thiếu menu bộ lọc đã lưu");
});
await step("pill KPI: Tất cả / Có việc / Đang quá tải kèm số, Hiệu suất TB, nút chưa gán", async () => {
  const pills = await page.locator(".rv-pills .rv-pill").allTextContents();
  assert.equal(pills.length, 3);
  assert.match(pills[0], /^Tất cả \(\d+\)$/);
  assert.match(pills[1], /^Có việc \(\d+\)$/);
  assert.match(pills[2], /^Đang quá tải \(\d+\)$/);
  assert.match(await page.locator(".rv-kpi-stat").innerText(), /Hiệu suất TB: \d+%/);
  assert.match(await page.locator(".rv-pill-warn").innerText(), /^\s*\d+ công việc chưa gán\s*$/);
});
await step("chú giải rút gọn: 4 mục, không có 'Trống', mô tả đầy đủ nằm trong tooltip", async () => {
  const items = await page.locator(".rv-legend-item").allTextContents();
  assert.deepEqual(items.map((t) => t.trim()), ["<50%", "50–100%", ">100%", "Ngày nghỉ"]);
  assert.ok((await page.locator(".rv-legend-item").first().getAttribute("title")).includes("Nhẹ tải"));
});
await step("bấm pill 'Có việc' chỉ còn người có việc; 'Tất cả' trả lại đủ", async () => {
  const n = async (label) => Number((await page.locator(".rv-pill", { hasText: label }).first().innerText()).match(/\((\d+)\)/)[1]);
  const all = await n("Tất cả");
  const busy = await n("Có việc");
  assert.ok(busy < all, "dữ liệu thử phải có người rảnh");
  await page.locator(".rv-pill", { hasText: "Có việc" }).click();
  assert.equal(await page.locator(".rv-row-person").count(), busy);
  assert.equal(await page.locator(".rv-pill", { hasText: "Có việc" }).getAttribute("aria-pressed"), "true");
  await page.locator(".rv-pill", { hasText: "Tất cả" }).click();
  assert.equal(await page.locator(".rv-row-person").count(), all);
});
await step("menu 'Khoảng' gom 6 mốc; nhãn đổi theo mốc đã chọn", async () => {
  await page.locator(".rv-preset").click();
  const items = (await page.locator(".rv-preset-item").allTextContents()).map((t) => t.trim());
  assert.deepEqual(items, ["Tháng này", "4 tuần", "8 tuần", "1 quý", "Toàn dự án", "Theo dự án"]);
  await page.locator(".rv-preset-item", { hasText: "8 tuần" }).click();
  assert.ok((await page.locator(".rv-preset").innerText()).includes("Khoảng: 8 tuần"));
  assert.equal(lenOf(await windowOf()), 56);
  await page.locator(".rv-preset").click();
  await page.locator(".rv-preset-item", { hasText: "Theo dự án" }).click();
  assert.ok((await page.locator(".rv-preset").innerText()).includes("Khoảng: Theo dự án"));
  assert.equal(await page.locator(".rv-range .rv-granularity").count(), 1, "chọn cột phải nằm cạnh khoảng thời gian");
});
await step("ⓘ cạnh THÀNH VIÊN: rê chuột hiện nguồn danh sách rồi ẩn đi", async () => {
  const btn = page.locator(".rv-corner .infotip-btn");
  assert.equal(await page.locator("[role=tooltip]").count(), 0);
  await btn.hover();
  await page.waitForSelector("[role=tooltip]");
  assert.ok((await page.locator("[role=tooltip]").innerText()).includes("lấy từ"));
  await page.mouse.move(700, 600);
  await page.waitForSelector("[role=tooltip]", { state: "detached" });
});

console.log("\n== Bảng lấp đầy bề ngang, nhãn tháng, tooltip ==");
const pickPreset = async (label) => {
  await page.locator(".rv-preset").click();
  await page.locator(".rv-preset-item", { hasText: label }).click();
};
await step("đặt khoảng quanh hôm nay, cột theo ngày (để đối chiếu thanh với cột)", async () => {
  await setWindow(isoIn(-2), isoIn(25));
  await page.locator(".rv-granularity").selectOption("day");
});
await step("ít cột: cột ngày giãn hết bề ngang bảng (không còn khoảng trống bên phải)", async () => {
  const m = await page.evaluate(() => {
    const scroll = document.querySelector(".rv-heatmap-scroll");
    const cells = [...document.querySelectorAll(".rv-row-head .rv-head-cell")];
    // The box minus its vertical scrollbar, which the pane now has when the people do not all fit.
    const right = scroll.getBoundingClientRect().left + scroll.clientLeft + scroll.clientWidth;
    return { gap: right - cells[cells.length - 1].getBoundingClientRect().right, over: scroll.scrollWidth - scroll.clientWidth, n: cells.length };
  });
  assert.ok(m.n < 45, "dữ liệu thử phải ít cột, có " + m.n);
  assert.ok(m.gap >= 0 && m.gap <= 3, "còn trống " + m.gap + "px bên phải");
  assert.ok(m.over <= 0, "không được cuộn ngang khi vừa");
});
await step("hàng việc mở rộng giãn cùng cột: thanh vẫn thẳng cột sau khi giãn", async () => {
  await rowOf("Trần Bình").click();
  await page.waitForSelector(".rv-expand .rv-tl-bar");
  const res = await page.evaluate(() => {
    const heads = [...document.querySelectorAll(".rv-head-cell")].map((e) => e.getBoundingClientRect().left);
    const cell = document.querySelector(".rv-head-cell").getBoundingClientRect().width;
    return { cell, bars: [...document.querySelectorAll(".rv-expand .rv-tl-bar")].map((b) => {
      const r = b.getBoundingClientRect();
      return { near: Math.min(...heads.map((h) => Math.abs(h - r.left))), cols: r.width / cell };
    }) };
  });
  assert.ok(res.cell > 30, "cột chưa giãn: " + res.cell);
  assert.ok(res.bars.length >= 1);
  for (const b of res.bars) assert.ok(b.near < 1.5 && Math.abs(b.cols - Math.round(b.cols)) < 0.06, JSON.stringify(b));
  await rowOf("Trần Bình").click();
});
await step("nhiều cột: giữ bề rộng tối thiểu của cột và cuộn ngang", async () => {
  await pickPreset("1 quý");
  await page.locator(".rv-granularity").selectOption("day");
  const m = await page.evaluate(() => {
    const scroll = document.querySelector(".rv-heatmap-scroll");
    return { over: scroll.scrollWidth - scroll.clientWidth, cell: document.querySelector(".rv-head-cell").getBoundingClientRect().width };
  });
  assert.ok(m.over > 100, "phải cuộn ngang, dư " + m.over);
  assert.ok(m.cell >= 21.5 && m.cell <= 23, "cột phải giữ ~22px, là " + m.cell);
});
await step("nhãn tháng rút gọn khi hẹp (T10/26, T10) và không bao giờ tràn sang tháng bên cạnh", async () => {
  let compact = 0;
  for (const preset of ["4 tuần", "8 tuần", "1 quý"]) {
    for (const g of ["day", "week", "month"]) {
      await pickPreset(preset);
      await page.locator(".rv-granularity").selectOption(g);
      const res = await page.locator(".rv-month").evaluateAll((els) =>
        els.map((el) => {
          const shown = [...el.children].find((c) => getComputedStyle(c).display !== "none");
          return { text: shown?.textContent ?? "", clipped: el.scrollWidth > el.clientWidth + 1, title: el.title };
        })
      );
      for (const r of res) {
        assert.ok(!r.clipped, `${preset}/${g}: "${r.text}" bị cắt`);
        assert.ok(r.text && r.title, "thiếu nhãn hoặc title đầy đủ");
        if (!/^(Thg \d+\/\d{4}|Năm \d{4})$/.test(r.text)) compact++;
      }
    }
  }
  assert.ok(compact > 0, "không có nhãn nào được rút gọn dù có tháng chỉ hiện vài ngày");
});
await step("trả lại khoảng quanh hôm nay, cột theo ngày", async () => {
  await setWindow(isoIn(-2), isoIn(25));
  await page.locator(".rv-granularity").selectOption("day");
});
await step("tooltip ô: ngày DD/MM/YYYY; ngày nghỉ ghi 'Ngày nghỉ' thay vì 0h / 0h", async () => {
  const titles = await page.locator(".rv-row-person .rv-cell").evaluateAll((els) => els.map((e) => ({ t: e.title, off: e.className.includes("band-off") })));
  const off = titles.find((x) => x.off && !x.t.includes("việc bị xếp"));
  assert.ok(off, "dữ liệu thử phải có ngày nghỉ");
  assert.match(off.t, /^\d{2}\/\d{2}\/\d{4} · Ngày nghỉ$/);
  assert.ok(!titles.some((x) => /0h \/ 0h/.test(x.t)), "còn '0h / 0h' trong tooltip");
  assert.ok(!titles.some((x) => /\d{4}-\d{2}-\d{2}/.test(x.t)), "còn ngày YYYY-MM-DD trong tooltip");
  const work = titles.find((x) => /h \/ \d/.test(x.t));
  assert.match(work.t, /^\d{2}\/\d{2}\/\d{4} · [\d.]+h \/ [\d.]+h \(\d+%\)/);
  const head = await page.locator(".rv-head-cell").first().getAttribute("title");
  assert.match(head, /^\d{2}\/\d{2}\/\d{4}$/);
});

console.log("\n== Cuộn và zoom như Gantt ==");
await step("không còn thanh trượt cửa sổ, mũi tên kỳ trước/sau; có 'Hôm nay'; ngày chính xác vẫn ở menu 'Khoảng'", async () => {
  assert.equal(await page.locator(".rv-scrub").count(), 0);
  assert.equal(await page.locator(".rv-step").count(), 0);
  assert.equal(await page.locator(".rv-range > input[type=date]").count(), 0, "ô ngày không được nằm ngoài menu");
  assert.equal(await page.locator(".rv-range button", { hasText: "Hôm nay" }).count(), 1);
  const w = await windowOf();
  assert.equal(w.from, isoIn(-2));
  assert.equal(w.to, isoIn(25));
});
await step("mặc định vẽ cả dự án (không cắt theo cửa sổ 4 tuần): cột đầu ≤ việc sớm nhất, cột cuối ≥ việc muộn nhất", async () => {
  await pickPreset("Theo dự án");
  await page.locator(".rv-granularity").selectOption("week");
  const tasks = await (await api("GET", "/api/tasks")).json();
  const dated = tasks.filter((t) => t.startDate);
  const minStart = dated.map((t) => t.startDate).sort()[0];
  const maxDue = dated.map((t) => t.dueDate ?? t.startDate).sort().at(-1);
  const titles = await page.locator(".rv-head-cell").evaluateAll((els) => els.map((e) => e.title));
  const iso = (dmy) => dmy.split("/").reverse().join("-");
  const first = iso(titles[0].split(" → ")[0]);
  const last = iso(titles.at(-1).split(" → ").at(-1));
  assert.ok(first <= minStart, `cột đầu ${first} sau việc sớm nhất ${minStart}`);
  assert.ok(last >= maxDue, `cột cuối ${last} trước việc muộn nhất ${maxDue}`);
});
await step("bảng có thanh cuộn riêng: cuộn dọc thì tiêu đề đứng yên, cuộn ngang thì cột tên đứng yên", async () => {
  await page.setViewportSize({ width: 1500, height: 430 });
  await page.locator(".rv-granularity").selectOption("day");
  await rowOf("Nguyễn Anh").click();
  await rowOf("Trần Bình").click();
  await page.waitForSelector(".rv-expand");
  const m = await page.evaluate(() => {
    const sc = document.querySelector(".rv-heatmap-scroll");
    return { v: sc.scrollHeight - sc.clientHeight, h: sc.scrollWidth - sc.clientWidth, page: document.documentElement.scrollHeight - window.innerHeight };
  });
  assert.ok(m.v > 40, "phải cuộn dọc được trong bảng, dư " + m.v);
  assert.ok(m.h > 40, "phải cuộn ngang được trong bảng, dư " + m.h);
  assert.ok(m.page <= 1, "trang không được tự cuộn: " + m.page);
  const head = await rect(".rv-row-head .rv-head-cell");
  const name = await rect(".rv-row-head .rv-name");
  await page.evaluate(() => {
    const sc = document.querySelector(".rv-heatmap-scroll");
    sc.scrollTop = 120;
    sc.scrollLeft = 300;
  });
  await page.waitForTimeout(100);
  const head2 = await rect(".rv-row-head .rv-head-cell");
  const name2 = await rect(".rv-row-head .rv-name");
  assert.ok(Math.abs(head2.y - head.y) < 1, `tiêu đề trượt ${head2.y - head.y}px khi cuộn dọc`);
  assert.ok(Math.abs(name2.x - name.x) < 1, `cột tên trượt ${name2.x - name.x}px khi cuộn ngang`);
  await page.evaluate(() => {
    const sc = document.querySelector(".rv-heatmap-scroll");
    sc.scrollTop = 0;
    sc.scrollLeft = 0;
  });
});
await step("Ctrl + cuộn chỉ zoom trục thời gian: cột rộng/hẹp theo, số hàng, chiều cao hàng và vị trí cuộn dọc không đổi", async () => {
  await page.locator(".rv-granularity").selectOption("week");
  const snap = () =>
    page.evaluate(() => {
      const sc = document.querySelector(".rv-heatmap-scroll");
      return {
        cell: document.querySelector(".rv-head-cell").getBoundingClientRect().width,
        people: document.querySelectorAll(".rv-row-person").length,
        tasks: document.querySelectorAll(".rv-task-row").length,
        rowH: document.querySelector(".rv-row-person").getBoundingClientRect().height,
        taskH: document.querySelector(".rv-task-row").getBoundingClientRect().height,
        top: sc.scrollTop,
        granularity: document.querySelector(".rv-granularity").value,
      };
    });
  await page.evaluate(() => (document.querySelector(".rv-heatmap-scroll").scrollTop = 60));
  const before = await snap();
  const box = await rect(".rv-heatmap-scroll");
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.keyboard.down("Control");
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(30);
  }
  const zoomedIn = await snap();
  assert.ok(zoomedIn.cell > before.cell * 1.3 || zoomedIn.granularity !== before.granularity, `cột ${before.cell} → ${zoomedIn.cell}`);
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(15);
  }
  await page.keyboard.up("Control");
  const zoomedOut = await snap();
  assert.equal(zoomedOut.granularity, "month", "thu nhỏ hết cỡ phải sang cột tháng");
  for (const s of [zoomedIn, zoomedOut]) {
    assert.equal(s.people, before.people);
    assert.equal(s.tasks, before.tasks, "số hàng việc đổi khi zoom");
    assert.equal(s.rowH, before.rowH);
    assert.equal(s.taskH, before.taskH);
    assert.equal(s.top, before.top, `cuộn dọc đổi ${before.top} → ${s.top}`);
  }
  // Choosing a granularity is the same zoom, in one click.
  await page.locator(".rv-granularity").selectOption("day");
  assert.ok(Math.abs((await snap()).cell - 22) < 1);
  await page.evaluate(() => (document.querySelector(".rv-heatmap-scroll").scrollTop = 0));
});
await step("zoom giữ nguyên ngày đang ở dưới con trỏ", async () => {
  await page.locator(".rv-granularity").selectOption("day");
  await page.evaluate(() => (document.querySelector(".rv-heatmap-scroll").scrollLeft = 500));
  const box = await rect(".rv-heatmap-scroll");
  const px = box.x + box.width * 0.6;
  const dateAt = (x) =>
    page.evaluate((x) => {
      const cells = [...document.querySelectorAll(".rv-row-head .rv-head-cell")];
      const hit = cells.find((c) => {
        const r = c.getBoundingClientRect();
        return x >= r.left && x < r.right;
      });
      return hit ? hit.title : null;
    }, x);
  const before = await dateAt(px);
  assert.ok(before, "con trỏ không nằm trên cột nào");
  await page.mouse.move(px, box.y + 200);
  await page.keyboard.down("Control");
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(30);
  }
  await page.keyboard.up("Control");
  const after = await dateAt(px);
  assert.ok(after, "sau zoom con trỏ không còn nằm trên cột nào");
  const day = (t) => Date.parse(t.split(" → ")[0].split("/").reverse().join("-"));
  assert.ok(Math.abs(day(after) - day(before)) <= 2 * 86400000, `${before} → ${after}`);
});
await step("mở một người: mọi việc của họ đều có hàng, kể cả việc nằm ngoài khoảng đang xem (hiện mũi tên ở mép)", async () => {
  await page.setViewportSize({ width: 1500, height: 900 });
  const total = async (name) => Number((await rowOf(name).locator(".rv-person-text small").innerText()).match(/(\d+) việc/)[1]);
  const anh = await total("Nguyễn Anh");
  assert.ok(anh >= 2);
  // A window that holds none of Anh's tasks.
  await setWindow(isoIn(200), isoIn(228));
  const block = page.locator(".rv-block", { has: rowOf("Nguyễn Anh") });
  await block.locator(".rv-task-row").first().waitFor();
  assert.equal(await block.locator(".rv-task-row").count(), anh, "mất hàng việc khi việc nằm ngoài khoảng");
  assert.equal(await block.locator(".rv-tl-beyond").count(), anh);
  assert.equal(await page.locator(".rv-expand-note").count(), 0);
  await setWindow(isoIn(-2), isoIn(25));
  await page.locator(".rv-granularity").selectOption("day");
  await rowOf("Nguyễn Anh").click();
  await rowOf("Trần Bình").click();
  assert.equal(await page.locator(".rv-expand").count(), 0);
});

console.log("\n== Việc chưa gán: thẻ nổi ==");
await step("đóng sẵn; mở bằng nút KPI thì nổi lên trên, không đẩy bảng xuống", async () => {
  assert.equal(await page.locator(".rv-unassigned").count(), 0);
  const before = await rect(".rv-heatmap-scroll");
  await page.locator(".rv-pill-warn").click();
  await page.waitForSelector(".rv-unassigned");
  const after = await rect(".rv-heatmap-scroll");
  assert.equal(after.y, before.y, "bảng bị đẩy xuống khi mở");
  assert.equal(await page.locator(".rv-unassigned").evaluate((el) => getComputedStyle(el).position), "fixed");
  assert.ok(await page.locator(".rv-unassigned .rv-un-row").count() >= 2);
  assert.equal(await page.locator(".rv-pill-warn").getAttribute("aria-expanded"), "true");
});
await step("mã việc không bị cắt bên trái, kể cả khi tên rất dài", async () => {
  const bad = await page.locator(".rv-un-main").evaluateAll((els) =>
    els.flatMap((el) => {
      const key = el.querySelector(".rv-un-key");
      const r = el.getBoundingClientRect();
      const k = key.getBoundingClientRect();
      return k.left >= r.left - 0.5 && key.scrollWidth <= key.clientWidth + 1 ? [] : [key.textContent];
    })
  );
  assert.deepEqual(bad, []);
});
await step("lọc trong thẻ theo mã hoặc tên (không cần dấu)", async () => {
  const all = await page.locator(".rv-un-row").count();
  await page.locator(".rv-un-search").fill("chua gan hai");
  assert.equal(await page.locator(".rv-un-row").count(), 1);
  await page.locator(".rv-un-search").fill("");
  assert.equal(await page.locator(".rv-un-row").count(), all);
});
await step("kéo một việc: thẻ mờ đi và nhường chuột; thả lên hàng bị thẻ che vẫn gán đúng người", async () => {
  const keyText = (await page.locator(".rv-un-key").first().innerText()).trim();
  const src = await rect(".rv-un-main");
  const panel = await rect(".rv-unassigned");
  // Any row the card covers — but not Anh's, whose two overlapping tasks the next steps look at.
  let target = null;
  let row = null;
  const rows = page.locator(".rv-row-person");
  for (let i = 0; i < (await rows.count()) && !target; i++) {
    const box = await rows.nth(i).boundingBox();
    const name = (await rows.nth(i).locator(".rv-person-text b").innerText()).trim();
    const mid = box.y + box.height / 2;
    if (name !== "Nguyễn Anh" && mid > panel.y && mid < panel.y + panel.height) {
      target = name;
      row = box;
    }
  }
  assert.ok(target, "dữ liệu thử: thẻ phải che ít nhất một hàng không phải của Anh");
  const targetName = target;
  const dst = { x: panel.x + 120, y: row.y + row.height / 2 };
  await reset();
  await page.mouse.move(src.x + 30, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(src.x + 40, src.y + src.height / 2 + 12, { steps: 4 });
  await page.waitForSelector(".rv-unassigned.is-ghost");
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector(".rv-unassigned")).opacity) < 0.5);
  assert.equal(await page.locator(".rv-unassigned").evaluate((el) => getComputedStyle(el).pointerEvents), "none");
  await page.mouse.move(dst.x, dst.y, { steps: 8 });
  await page.waitForSelector(".rv-block.is-drop-target");
  await page.mouse.up();
  const patch = await waitLog((l) => l.m === "PATCH" && l.p === "/api/tasks/" + keyText);
  assert.equal(patch.b.assigneeAccountId, ID[targetName] ?? patch.b.assigneeAccountId);
  assert.ok(patch.b.assigneeAccountId, "không gán cho ai");
  await page.waitForFunction(() => !document.querySelector(".rv-unassigned.is-ghost"));
});
await step("kéo chính thẻ bằng thanh tiêu đề: mờ khi di chuyển, dời đúng chỗ, rồi rõ lại", async () => {
  const head = await rect(".rv-un-head strong");
  const before = await rect(".rv-unassigned");
  await page.mouse.move(head.x + 10, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + 210, head.y + 90, { steps: 6 });
  await page.waitForSelector(".rv-unassigned.is-ghost");
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector(".rv-unassigned.is-ghost"));
  const after = await rect(".rv-unassigned");
  assert.ok(Math.abs(after.x - before.x - 200) <= 2 && Math.abs(after.y - before.y - 80) <= 12, `${before.x},${before.y} → ${after.x},${after.y}`);
});
await step("Esc trong thẻ đóng thẻ; mở lại thì giữ vị trí đã dời", async () => {
  const where = await rect(".rv-unassigned");
  await page.locator(".rv-un-search").focus();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".rv-unassigned").count(), 0);
  await page.locator(".rv-pill-warn").click();
  await page.waitForSelector(".rv-unassigned");
  const again = await rect(".rv-unassigned");
  assert.ok(Math.abs(again.x - where.x) <= 1 && Math.abs(again.y - where.y) <= 1);
  await page.locator(".rv-un-close").click();
  assert.equal(await page.locator(".rv-unassigned").count(), 0);
});

console.log("\n== Mở rộng tại chỗ ==");
await step("bấm hàng người: việc của họ hiện ngay dưới hàng đó, bảng không nhảy, cột tên 280–300px", async () => {
  const before = await rect(".rv-heatmap-scroll");
  await rowOf("Nguyễn Anh").click();
  await page.waitForSelector(".rv-expand");
  const after = await rect(".rv-heatmap-scroll");
  assert.equal(after.y, before.y);
  const order = await page.evaluate(() => {
    const block = document.querySelector(".rv-block.is-expanded");
    return [...block.children].map((c) => c.className.split(" ")[0]);
  });
  assert.deepEqual(order.slice(0, 2), ["rv-row", "rv-expand"]);
  assert.ok(await page.locator(".rv-expand .rv-task-row").count() >= 2);
  const w = (await rect(".rv-row-head .rv-name")).width;
  assert.ok(w >= 280 && w <= 300, "cột tên rộng " + w);
  assert.ok(await page.locator(".rv-row-head").isVisible(), "tiêu đề ngày phải còn");
});
await step("thanh việc thẳng hàng với cột ngày bên trên (mép trái trùng mép cột, độ dài tròn số cột)", async () => {
  const res = await page.evaluate(() => {
    const heads = [...document.querySelectorAll(".rv-head-cell")].map((e) => e.getBoundingClientRect().left);
    const cell = document.querySelector(".rv-head-cell").getBoundingClientRect().width;
    return [...document.querySelectorAll(".rv-expand .rv-tl-bar")].map((b) => {
      const r = b.getBoundingClientRect();
      return { near: Math.min(...heads.map((h) => Math.abs(h - r.left))), cols: r.width / cell };
    });
  });
  assert.ok(res.length >= 2);
  for (const r of res) {
    assert.ok(r.near < 1.5, "mép trái lệch " + r.near);
    assert.ok(Math.abs(r.cols - Math.round(r.cols)) < 0.06, "độ dài " + r.cols + " cột");
  }
});
await step("banner chồng lịch nằm ngay trên các hàng việc; hai việc trùng được tô nổi", async () => {
  const banner = page.locator(".rv-expand .rv-banner");
  const text = await banner.innerText();
  assert.match(text, /1 cặp công việc chồng lịch/);
  assert.ok(text.includes("DEMO-5") && text.includes("DEMO-7"), text);
  const b = await banner.boundingBox();
  const firstRow = await page.locator(".rv-expand .rv-task-row").first().boundingBox();
  assert.ok(b.y + b.height <= firstRow.y + 1, "banner phải nằm trên hàng việc đầu tiên");
  assert.equal(await page.locator(".rv-expand .rv-task-row.is-conflict").count(), 2);
});
await step("rê chuột vào hàng việc hiện 'Chuyển…'; chọn người khác → PATCH", async () => {
  const row = page.locator(".rv-expand .rv-task-row", { hasText: "DEMO-7" });
  await row.hover();
  const sel = row.locator(".rv-assign-select");
  await page.waitForFunction((el) => Number(getComputedStyle(el).opacity) > 0.9, await sel.elementHandle());
  await reset();
  await sel.selectOption({ label: "Lê Chi" });
  const patch = await waitLog((l) => l.m === "PATCH" && l.p === "/api/tasks/DEMO-7");
  assert.equal(patch.b.assigneeAccountId, "chi");
  await page.waitForFunction(() => document.querySelectorAll(".rv-expand .rv-task-row.is-conflict").length === 0);
  assert.equal(await page.locator(".rv-expand .rv-banner").count(), 0, "hết chồng lịch thì hết banner");
});
await step("kéo việc đang gán xuống dải 'Thả vào đây để bỏ gán' (hiện cả khi thẻ chưa gán đang đóng)", async () => {
  assert.equal(await page.locator(".rv-unassigned").count(), 0);
  assert.equal(await page.locator(".rv-un-strip").count(), 0);
  const row = await page.locator(".rv-expand .rv-task-row", { hasText: "DEMO-5" }).locator(".rv-name").boundingBox();
  await reset();
  await page.mouse.move(row.x + 60, row.y + row.height / 2);
  await page.mouse.down();
  await page.mouse.move(row.x + 70, row.y + row.height / 2 + 14, { steps: 4 });
  await page.waitForSelector(".rv-un-strip");
  const strip = await rect(".rv-un-strip");
  await page.mouse.move(strip.x + strip.width / 2, strip.y + strip.height / 2, { steps: 8 });
  // A real drag keeps sending dragover; the driver sends one only on the next move after dragenter.
  await page.mouse.move(strip.x + strip.width / 2 + 3, strip.y + strip.height / 2 + 1);
  await page.waitForSelector(".rv-un-strip.is-drop-target");
  await page.mouse.up();
  const patch = await waitLog((l) => l.m === "PATCH" && l.p === "/api/tasks/DEMO-5");
  assert.equal(patch.b.assigneeAccountId, null);
  await page.waitForSelector(".rv-un-strip", { state: "detached" });
});
await step("bấm lại hàng thì thu gọn", async () => {
  await rowOf("Nguyễn Anh").click();
  assert.equal(await page.locator(".rv-expand").count(), 0);
});

console.log("\n== Hồ sơ & Kỳ nghỉ ==");
await step("nút ✎ trên hàng mở ngăn bên phải: đủ trường, một nút 'Lưu thay đổi', không còn câu hướng dẫn cũ", async () => {
  await rowOf("Lê Chi").hover();
  await rowOf("Lê Chi").locator(".rv-profile-btn").click();
  await page.waitForSelector(".rv-drawer");
  const text = await page.locator(".rv-drawer").innerText();
  for (const t of ["Vai trò", "Công suất (giờ/ngày)", "Từ", "Đến", "Kỹ năng", "Ghi chú"]) assert.ok(text.includes(t), t + " thiếu");
  assert.ok(!text.includes("Bấm “Lưu” ở trên"));
  assert.equal(await page.locator(".rv-drawer button", { hasText: "Lưu thay đổi" }).count(), 1);
  assert.equal(await page.locator(".rv-drawer button", { hasText: /^Lưu$/ }).count(), 0);
  const box = await rect(".rv-drawer");
  assert.ok(box.x + box.width >= 1499 && box.height >= 890, "phải là ngăn kéo sát mép phải, cao hết màn hình");
});
await step("sửa dở rồi Esc: hỏi bỏ thay đổi bằng hộp thoại trong app; 'Tiếp tục sửa' giữ nguyên", async () => {
  await page.locator(".rv-drawer input").first().fill("QA Lead");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".dlg");
  await page.locator(".dlg button", { hasText: "Tiếp tục sửa" }).click();
  assert.equal(await page.locator(".rv-drawer").count(), 1);
  assert.equal(await page.locator(".rv-drawer input").first().inputValue(), "QA Lead");
});
await step("'Lưu thay đổi' ghi hồ sơ rồi đóng ngăn; hàng người hiện vai trò mới", async () => {
  await reset();
  await page.locator(".rv-drawer-foot button.primary").click();
  const put = await waitLog((l) => l.m === "PUT" && l.p.startsWith("/api/resources/"));
  assert.equal(put.b.role, "QA Lead");
  await page.waitForSelector(".rv-drawer", { state: "detached" });
  assert.ok((await rowOf("Lê Chi").innerText()).includes("QA Lead"));
});
await step("Tab không thoát khỏi ngăn kéo; Esc khi chưa sửa đóng ngay", async () => {
  await rowOf("Lê Chi").locator(".rv-profile-btn").click();
  await page.waitForSelector(".rv-drawer");
  for (let i = 0; i < 14; i++) await page.keyboard.press("Tab");
  assert.ok(await page.evaluate(() => document.querySelector(".rv-drawer").contains(document.activeElement)));
  await page.keyboard.press("Escape");
  await page.waitForSelector(".rv-drawer", { state: "detached" });
});

console.log("\n== Tải lại trang (F5): các tab không phải chờ Jira lần nữa ==");
// Jira answers slowly: if the tab only paints once the answer lands, the checks below time out.
const SLOW = 2500;
const slow = (re) => page.route(re, async (route) => { await new Promise((r) => setTimeout(r, SLOW)); route.continue(); });
await step("nhãn 'Nguồn lực' và số quá tải hiện ngay sau F5, không đợi danh sách thành viên", async () => {
  await slow(/\/api\/resources(\?|$)/);
  await page.reload();
  await page.waitForSelector(".toolbar-tabs");
  await page.locator(".toolbar-tabs button", { hasText: "Nguồn lực" }).waitFor({ timeout: 1200 });
  const labels = (await page.locator(".toolbar-tabs button").allTextContents()).map((t) => t.replace(/\d+\s*thành viên.*$/, "").replace(/\d+$/, "").trim());
  assert.deepEqual(labels, ["Gantt / WBS", "Bảng", "Chấm công", "Nguồn lực", "Báo cáo"]);
  await page.unroute(/\/api\/resources(\?|$)/);
});
await step("Báo cáo, Bảng, Chấm công đã xem trước đó hiện ngay sau F5 từ bản lưu của tab", async () => {
  // Visit each once so the tab has something to remember, then reload with Jira slowed down.
  for (const name of ["Báo cáo", "Bảng", "Chấm công"]) {
    await page.locator(".toolbar-tabs button", { hasText: name }).click();
    await page.waitForSelector({ "Báo cáo": ".pr-tile", "Bảng": ".bd-card", "Chấm công": ".ts-grid" }[name]);
  }
  await slow(/\/api\/(progress|board|timesheet)/);
  await page.reload();
  await page.waitForSelector(".toolbar-tabs");
  for (const [name, sel] of [["Báo cáo", ".pr-tile"], ["Bảng", ".bd-card"], ["Chấm công", ".ts-grid"]]) {
    await page.locator(".toolbar-tabs button", { hasText: name }).click();
    await page.waitForSelector(sel, { timeout: 1500 });
  }
  await page.unroute(/\/api\/(progress|board|timesheet)/);
});
console.log(`\n${failed ? failed + " lỗi" : "đạt hết"}`);
console.log("Hộp thoại/console:", problems.length ? problems.join("\n") : "không có");
await browser.close();
process.exit(failed || problems.length ? 1 : 0);
