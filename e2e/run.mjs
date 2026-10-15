// One command: starts the stand-in API and the Vite client, runs every *.e2e.mjs
// in this folder in Chrome, then stops both. Exit code is non-zero if any failed.
//
//   cd e2e && npm install && npm test
//
// Needs Google Chrome installed (playwright-core drives it; no browser download)
// and `npm install` done in ../client. Ports 4000 and 5173 must be free: the
// client's dev proxy is fixed to :4000, so a running `npm run dev` has to stop first.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const client = path.join(here, "..", "client");
const children = [];

function inUse(port) {
  return new Promise((resolve) => {
    const s = net.createServer().once("error", () => resolve(true)).once("listening", () => s.close(() => resolve(false)));
    s.listen(port);
  });
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

function start(label, args, cwd) {
  const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
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
  for (const port of [4000, 5173]) {
    if (await inUse(port)) throw new Error(`port ${port} is already in use — stop whatever is running there first`);
  }
  start("mock", ["--import", "tsx", "mock-api.mts"], here);
  start("vite", [path.join(client, "node_modules", "vite", "bin", "vite.js"), "--port", "5173", "--strictPort"], client);
  await waitFor("http://localhost:4000/api/auth/me", "mock API");
  await waitFor("http://localhost:5173/", "client");

  const files = fs.readdirSync(here).filter((f) => f.endsWith(".e2e.mjs")).sort();
  for (const file of files) {
    console.log(`\n##### ${file}`);
    const code = await new Promise((resolve) => {
      const p = spawn(process.execPath, [path.join(here, file)], { cwd: here, stdio: "inherit" });
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
