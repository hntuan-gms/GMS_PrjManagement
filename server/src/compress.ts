import compression from "compression";
import type { RequestHandler } from "express";

/**
 * Response compression. Cloud Run does not compress what the container sends: the 694 KB bundle and
 * a 4000-task `/api/tasks` (2.7 MB of JSON, ~10x smaller gzipped) went down the wire as they were.
 *
 * Streams are the exception that makes a blanket `app.use(compression())` wrong here: the assistant
 * and the KBKT import answer as Server-Sent Events, and a compressor buffers until it has a block to
 * emit, which delivers the whole answer in one lump at the end — the exact failure `X-Accel-Buffering: no`
 * exists to prevent. They are recognised by their content type, which is set before the first byte
 * is written (the filter runs at header time), so no route has to opt out one by one.
 */
export function responseCompression(): RequestHandler {
  return compression({
    filter: (req, res) => {
      if (/text\/event-stream/i.test(String(res.getHeader("Content-Type") ?? ""))) return false;
      return compression.filter(req, res);
    },
  });
}
