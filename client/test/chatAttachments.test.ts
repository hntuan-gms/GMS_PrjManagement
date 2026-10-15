import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addFiles, formatSize, MAX_FILE_BYTES, MAX_FILES, mimeOf } from "../src/chatAttachments";

const file = (name: string, size = 10, type = "image/png") => new File([new Uint8Array(size)], name, { type });

describe("mimeOf", () => {
  it("accepts images, PDF and text by their type", () => {
    assert.equal(mimeOf(file("a.png")), "image/png");
    assert.equal(mimeOf(file("a.pdf", 1, "application/pdf")), "application/pdf");
  });

  it("falls back to the extension when the browser reports no type (.md often has none)", () => {
    assert.equal(mimeOf(file("ghi-chu.md", 1, "")), "text/markdown");
    assert.equal(mimeOf(file("data.CSV", 1, "application/octet-stream")), "text/csv");
  });

  it("rejects what the server would reject", () => {
    assert.equal(mimeOf(file("a.exe", 1, "application/x-msdownload")), null);
    assert.equal(mimeOf(file("a.svg", 1, "image/svg+xml")), null);
    assert.equal(mimeOf(file("noext", 1, "")), null);
  });
});

describe("addFiles", () => {
  it("adds supported files in order", () => {
    const r = addFiles([file("a.png")], [file("b.png")]);
    assert.equal(r.error, null);
    assert.deepEqual(r.files.map((f) => f.name), ["a.png", "b.png"]);
  });

  it("says why a file was refused and keeps the ones already chosen", () => {
    const r = addFiles([file("a.png")], [file("x.exe", 1, "application/x-msdownload")]);
    assert.match(r.error ?? "", /chưa hỗ trợ/);
    assert.deepEqual(r.files.map((f) => f.name), ["a.png"]);
  });

  it("enforces the per-file, count and total limits", () => {
    assert.match(addFiles([], [file("big.png", MAX_FILE_BYTES + 1)]).error ?? "", /lớn hơn/);
    const full = Array.from({ length: MAX_FILES }, (_, i) => file(`${i}.png`));
    assert.match(addFiles(full, [file("extra.png")]).error ?? "", /tối đa/);
    assert.match(addFiles([file("a.png", MAX_FILE_BYTES), file("b.png", MAX_FILE_BYTES)], [file("c.png", MAX_FILE_BYTES)]).error ?? "", /Tổng dung lượng/);
  });
});

describe("formatSize", () => {
  it("KB below a megabyte, MB above", () => {
    assert.equal(formatSize(100), "1 KB");
    assert.equal(formatSize(2048), "2 KB");
    assert.equal(formatSize(1.5 * 1024 * 1024), "1.5 MB");
  });
});
