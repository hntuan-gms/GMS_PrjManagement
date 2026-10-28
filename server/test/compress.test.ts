import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { responseCompression } from "../src/compress.js";

let server: http.Server;
let base = "";

before(async () => {
  const app = express();
  app.use(responseCompression());
  app.get("/json", (_req, res) => {
    res.json({ tasks: Array.from({ length: 2000 }, (_, i) => ({ id: `P-${i}`, summary: "Một việc cần làm " + i })) });
  });
  app.get("/stream", async (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();
    res.write("data: một\n\n");
    // The rest comes much later: a compressor that buffers would hold "một" back until the end.
    await new Promise((r) => setTimeout(r, 400));
    res.write("data: hai\n\n");
    res.end();
  });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

function get(path: string, headers: Record<string, string> = {}): Promise<{ res: http.IncomingMessage; body: Buffer; firstChunkAt: number; endAt: number }> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    http
      .get(base + path, { headers }, (res) => {
        const chunks: Buffer[] = [];
        let firstChunkAt = -1;
        res.on("data", (c: Buffer) => {
          if (firstChunkAt < 0) firstChunkAt = Date.now() - t0;
          chunks.push(c);
        });
        res.on("end", () => resolve({ res, body: Buffer.concat(chunks), firstChunkAt, endAt: Date.now() - t0 }));
      })
      .on("error", reject);
  });
}

describe("responseCompression", () => {
  it("compresses a JSON answer for a client that accepts gzip, and says so", async () => {
    const plain = await get("/json", { "Accept-Encoding": "identity" });
    const gz = await get("/json", { "Accept-Encoding": "gzip" });
    assert.equal(plain.res.headers["content-encoding"], undefined);
    assert.equal(gz.res.headers["content-encoding"], "gzip");
    assert.match(String(gz.res.headers["vary"]), /Accept-Encoding/i);
    assert.ok(gz.body.length < plain.body.length / 4, `${plain.body.length} → ${gz.body.length} bytes`);
  });

  it("does not hold back a Server-Sent Events stream: the first event arrives long before the last", async () => {
    const r = await get("/stream", { "Accept-Encoding": "gzip" });
    assert.equal(r.res.headers["content-encoding"], undefined, "a stream must not be compressed");
    assert.ok(r.firstChunkAt >= 0 && r.firstChunkAt < 250, `first event after ${r.firstChunkAt}ms`);
    assert.ok(r.endAt >= 350, `stream ended after ${r.endAt}ms`);
    assert.match(r.body.toString(), /data: một[\s\S]*data: hai/);
  });
});
