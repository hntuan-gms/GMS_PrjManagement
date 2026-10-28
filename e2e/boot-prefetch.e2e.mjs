// Reloading a project the tab already has pinned: the task list and the members are asked for at once,
// not after /auth/me has answered. Slowing /auth/me down makes the order visible: the old sequence (me first,
// then the workspace) cannot have the tasks back before me does.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = process.env.E2E_APP ?? "http://localhost:5173/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.setDefaultTimeout(10000);
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

await fetch(API + "/api/__restore", { method: "POST" });
await page.goto(APP);
await page.waitForSelector(".wbs-row");

console.log("\n== Tải lại: không đợi /auth/me rồi mới hỏi việc và thành viên ==");
const ME_DELAY = 1500;
await step("việc và thành viên được hỏi cùng lúc với /auth/me, không sau nó", async () => {
  const times = {};
  const counts = { tasks: 0, users: 0 };
  page.on("request", (r) => {
    const m = r.url().match(/\/api\/(auth\/me|tasks|users)(\?|$)/);
    if (m && r.method() === "GET") {
      times[m[1]] ??= Date.now();
      if (m[1] in counts) counts[m[1]]++;
    }
  });
  await page.route("**/api/auth/me", async (route) => {
    await new Promise((r) => setTimeout(r, ME_DELAY));
    route.continue();
  });
  const t0 = Date.now();
  await page.reload();
  await page.waitForSelector(".wbs-row");
  const shownAt = Date.now() - t0;
  await page.unroute("**/api/auth/me");
  assert.ok(times["auth/me"] && times["tasks"] && times["users"], JSON.stringify(times));
  assert.ok(times["tasks"] - times["auth/me"] < 400, `việc hỏi sau /auth/me ${times["tasks"] - times["auth/me"]}ms`);
  assert.ok(times["users"] - times["auth/me"] < 400, `thành viên hỏi sau /auth/me ${times["users"] - times["auth/me"]}ms`);
  // The workspace itself still waits for /auth/me — but not for it AND the reads one after the other.
  assert.ok(shownAt < ME_DELAY + 900, `bảng hiện sau ${shownAt}ms`);
  // Handed to the workspace when it asked — not asked for a second time.
  await page.waitForTimeout(500);
  assert.deepEqual(counts, { tasks: 1, users: 1 }, "việc/thành viên bị gọi lặp: " + JSON.stringify(counts));
});

await step("không có lỗi trình duyệt", async () => {
  assert.deepEqual(problems, []);
});

await browser.close();
if (failed) {
  console.log(`\n${failed} lỗi`);
  process.exit(1);
}
console.log("\nđạt hết");
