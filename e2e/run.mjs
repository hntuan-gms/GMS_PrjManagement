// One command: starts the stand-in API and the Vite client, runs every *.e2e.mjs
// in this folder in Chrome, then stops both. Exit code is non-zero if any failed.
//
//   cd e2e && npm install && npm test
//
// Needs Google Chrome installed (playwright-core drives it; no browser download)
// and `npm install` done in ../client. It takes the first free ports from 4000 and
// 5173 up, so a `npm run dev` that is already running is left alone.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const client = path.join(here, "..", "client");
const children = [];

/**
 * Whether anything listens on `port`. Tried on each address family separately: Vite
 * binds `localhost` (often ::1 only), and a probe on the wildcard address can succeed
 * right next to it, which would hand out a port that is in fact taken.
 */
async function inUse(port) {
  for (const host of ["127.0.0.1", "::1", "::"]) {
    const busy = await new Promise((resolve) => {
      const s = net.createServer();
      s.once("error", (e) => resolve(e.code === "EADDRINUSE" || e.code === "EACCES"));
      s.once("listening", () => s.close(() => resolve(false)));
      s.listen(port, host);
    });
    if (busy) return true;
  }
  return false;
}

/** The first free port at or after `from`. */
async function freePort(from) {
  for (let p = from; p < from + 100; p++) if (!(await inUse(p))) return p;
  throw new Error(`no free port near ${from}`);
}

async function waitFor(url, label, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${label} did not come up at ${url} within ${ms / 1000}s`);
}

function start(label, args, cwd, env = {}) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${label}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${label}] ${d}`));
  children.push(child);
  return child;
}

function stopAll() {
  for (const c of children) if (!c.killed) c.kill();
}

let failed = 0;
try {
  const apiPort = await freePort(4000);
  const appPort = await freePort(5173);
  const urls = { E2E_API: `http://localhost:${apiPort}`, E2E_APP: `http://localhost:${appPort}/` };
  console.log(`stand-in API :${apiPort}, client :${appPort}`);
  start("mock", ["--import", "tsx", "mock-api.mts"], here, { MOCK_PORT: String(apiPort) });
  start(
    "vite",
    [path.join(client, "node_modules", "vite", "bin", "vite.js"), "--port", String(appPort), "--strictPort"],
    client,
    { VITE_PROXY_TARGET: urls.E2E_API }
  );
  await waitFor(`${urls.E2E_API}/api/auth/me`, "mock API");
  await waitFor(urls.E2E_APP, "client");

  const files = fs.readdirSync(here).filter((f) => f.endsWith(".e2e.mjs")).sort();
  for (const file of files) {
    console.log(`\n##### ${file}`);
    const code = await new Promise((resolve) => {
      const p = spawn(process.execPath, [path.join(here, file)], { cwd: here, env: { ...process.env, ...urls }, stdio: "inherit" });
      p.on("exit", (c) => resolve(c ?? 1));
    });
    if (code !== 0) failed++;
  }
} catch (err) {
  console.error(err.message);
  failed++;
} finally {
  stopAll();
}
process.exit(failed ? 1 : 0);
