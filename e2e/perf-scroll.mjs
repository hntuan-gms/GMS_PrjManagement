// A measuring tool, not a test (run.mjs only runs *.e2e.mjs): how the Gantt behaves with
// a big project — time to draw it, and how smooth horizontal and vertical scrolling are.
//
//   node perf-scroll.mjs [rows]        needs the stand-in API and the client already running
//                                      (E2E_API / E2E_APP, defaults :4000 / :5173)
//
// Frames are sampled with requestAnimationFrame while real wheel events scroll the chart;
// a CPU profile of each phase lists where the time went. Numbers depend on the machine —
// compare before/after on the same one.
import { chromium } from "playwright-core";

const API = process.env.E2E_API ?? "http://localhost:4000";
const APP = process.env.E2E_APP ?? "http://localhost:5173/";
const ROWS = Number(process.argv[2] ?? 500);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const cdp = await page.context().newCDPSession(page);
const errors = [];
// A render loop logs one line with no hint of where; keep the stack that logged it.
await page.addInitScript(() => {
  const orig = console.error;
  console.error = (...a) => orig.apply(console, String(a[0]).includes("Maximum update depth") ? [...a, "\n" + new Error().stack] : a);
});
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 2500)));
page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 300)));

await fetch(API + "/api/__restore", { method: "POST" });
await fetch(API + "/api/__tasks/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ n: ROWS }) });

const t0 = Date.now();
await page.goto(APP);
await page.waitForFunction((n) => document.querySelectorAll(".wbs-row").length >= n, Math.floor(ROWS * 0.9), { timeout: 120_000 });
console.log(`(lỗi trình duyệt khi vừa vẽ xong: ${errors.length})`);
console.log(`rows: ${await page.locator(".wbs-row").count()} drawn ${Date.now() - t0}ms after navigation`);
await page.waitForTimeout(Number(process.env.SETTLE_MS ?? 1500));

async function phase(name, wheel) {
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = (now) => {
      window.__frames.push(now - last);
      last = now;
      window.__raf = requestAnimationFrame(tick);
    };
    window.__raf = requestAnimationFrame(tick);
  });
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  await wheel();
  const { profile } = await cdp.send("Profiler.stop");
  console.log(`   (lỗi trình duyệt tới đây: ${errors.length})`);
  const frames = await page.evaluate(() => {
    cancelAnimationFrame(window.__raf);
    return window.__frames.slice(2);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  const slow = frames.filter((f) => f > 33).length;
  console.log(`\n== ${name}: ${frames.length} frames, median ${q(0.5).toFixed(1)}ms, p95 ${q(0.95).toFixed(1)}ms, worst ${sorted.at(-1)?.toFixed(0)}ms, ${slow} over 33ms`);

  // Self time per function from the sampled profile.
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const f = n.callFrame;
    const key = `${f.functionName || "(anonymous)"}  ${f.url.split("/").slice(-1)[0].split("?")[0]}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0));
  });
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`   ${(v / 1000).toFixed(0).padStart(6)}ms ${((v / total) * 100).toFixed(0).padStart(3)}%  ${k}`);
  }
  if (process.env.INCLUSIVE) {
    // Inclusive time (the function and everything it called) — readable on a dev build,
    // where component names survive; says which component a frame's time belongs to.
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const incl = new Map();
    profile.samples.forEach((id, i) => {
      const seen = new Set();
      for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
        const f = byId.get(cur).callFrame;
        const key = `${f.functionName || "(anonymous)"}  ${f.url.split("/").slice(-1)[0].split("?")[0]}:${f.lineNumber + 1}`;
        if (seen.has(key)) continue;
        seen.add(key);
        incl.set(key, (incl.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0));
      }
    });
    console.log("   -- inclusive --");
    for (const [k, v] of [...incl.entries()].sort((a, b) => b[1] - a[1]).slice(0, process.env.ONLY ? 400 : 40)) {
      if (/(root)|(program)|(idle)/.test(k)) continue;
      if (process.env.ONLY && !new RegExp(process.env.ONLY).test(k)) continue;
      console.log(`   ${(v / 1000).toFixed(0).padStart(6)}ms  ${k}`);
    }
  }
}

const chart = page.locator(".gantt-body");
const box = await chart.boundingBox();
await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);

await phase("cuộn ngang", async () => {
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(80, 0);
    await page.waitForTimeout(16);
  }
});
await phase("cuộn dọc", async () => {
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(16);
  }
});

console.log(errors.length ? `\nLỗi trình duyệt (${errors.length}):\n` + errors.slice(0, 5).join("\n---\n") : "\nKhông có lỗi trình duyệt");
// The stand-in API is shared by every file in a run: give back the small seed project.
await fetch(API + "/api/__restore", { method: "POST" });
await browser.close();
