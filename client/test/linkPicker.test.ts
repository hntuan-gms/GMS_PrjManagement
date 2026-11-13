import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeUrl, normalizeUrl, pickLink, viewedAgo, type LinkSuggestion } from "../src/linkPicker";

const row = (key: string, summary: string): LinkSuggestion => ({
  key,
  summary,
  issueType: "Task",
  projectName: "Ai Daily Task",
  lastViewed: null,
  url: `https://x.atlassian.net/browse/${key}`,
});
const rows = [row("ADT-1", "Thiết kế lại"), row("ADT-2", "Trang chủ")];

describe("pickLink", () => {
  it("an address typed wins over the list, with its display text or itself", () => {
    assert.deepEqual(pickLink("www.figma.com/f", "", rows, 1), { url: "https://www.figma.com/f", text: "https://www.figma.com/f" });
    assert.deepEqual(pickLink("https://a.b", " Figma ", rows, 0), { url: "https://a.b", text: "Figma" });
  });

  it("a highlighted issue reads as 'KEY: summary' unless display text was typed", () => {
    assert.deepEqual(pickLink("", "", rows, 1), { url: rows[1].url, text: "ADT-2: Trang chủ" });
    assert.deepEqual(pickLink("", "xem đây", rows, 0), { url: rows[0].url, text: "xem đây" });
  });

  it("typed words with nothing highlighted take the first match; nothing typed and nothing highlighted links nothing", () => {
    assert.equal(pickLink("thiết", "", rows, -1)?.url, rows[0].url);
    assert.equal(pickLink("", "", rows, -1), null);
    assert.equal(pickLink("không có", "", [], -1), null);
  });
});

describe("looksLikeUrl / normalizeUrl", () => {
  it("only addresses, and they get https://", () => {
    assert.ok(looksLikeUrl("http://x"));
    assert.ok(looksLikeUrl("mailto:a@b.c"));
    assert.ok(!looksLikeUrl("trang chủ"));
    assert.equal(normalizeUrl("mailto:a@b.c"), "mailto:a@b.c");
  });
});

describe("viewedAgo", () => {
  const now = Date.parse("2026-11-13T12:00:00Z");
  it("says it the way Jira does, in Vietnamese", () => {
    assert.equal(viewedAgo("2026-11-13T11:59:50Z", now), "Vừa xem");
    assert.equal(viewedAgo("2026-11-13T11:59:00Z", now), "Đã xem 1 phút trước");
    assert.equal(viewedAgo("2026-11-13T09:00:00Z", now), "Đã xem khoảng 3 giờ trước");
    assert.equal(viewedAgo("2026-11-12T10:00:00Z", now), "Đã xem hôm qua");
    assert.equal(viewedAgo("2026-11-01T12:00:00Z", now), "Đã xem 12 ngày trước");
    assert.equal(viewedAgo(null, now), null);
  });
});
