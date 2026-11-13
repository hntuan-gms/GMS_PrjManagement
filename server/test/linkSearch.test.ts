import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isoTime, linkSearchJql, looksLikeUrl, toSuggestions } from "../src/linkSearch.js";

describe("linkSearchJql", () => {
  it("nothing typed lists what the viewer opened last, newest first", () => {
    assert.equal(linkSearchJql(""), "issue in issueHistory() ORDER BY lastViewed DESC");
    assert.equal(linkSearchJql("   "), "issue in issueHistory() ORDER BY lastViewed DESC");
  });

  it("an address is not searched: the box links it as it is", () => {
    assert.equal(linkSearchJql("https://figma.com/file/x"), null);
    assert.equal(linkSearchJql("www.example.com"), null);
    assert.ok(looksLikeUrl("http://a.b"));
    assert.ok(!looksLikeUrl("thiết kế"));
  });

  it("a whole key is looked up exactly, in capitals", () => {
    assert.equal(linkSearchJql("adt-144"), 'key = "ADT-144"');
  });

  it("a title search keeps diacritics and turns JQL/Lucene syntax into spaces", () => {
    assert.equal(linkSearchJql("Thiết kế"), 'summary ~ "Thiết kế*" ORDER BY lastViewed DESC, updated DESC');
    assert.equal(linkSearchJql('a"b\\c (x) OR y'), 'summary ~ "abc x OR y*" ORDER BY lastViewed DESC, updated DESC');
    assert.equal(linkSearchJql("x"), null);
  });
});

describe("toSuggestions", () => {
  it("links to the site's own issue page and reads Jira's colon-less offset", () => {
    const [s] = toSuggestions(
      [{ key: "ADT-1", fields: { summary: "Thiết kế", issuetype: { name: "Task" }, project: { name: "Ai Daily Task" }, lastViewed: "2026-11-13T10:00:00.000+0700" } }],
      "https://x.atlassian.net/"
    );
    assert.deepEqual(s, {
      key: "ADT-1",
      summary: "Thiết kế",
      issueType: "Task",
      projectName: "Ai Daily Task",
      lastViewed: "2026-11-13T03:00:00.000Z",
      url: "https://x.atlassian.net/browse/ADT-1",
    });
  });

  it("an issue never opened has no time", () => {
    assert.equal(isoTime(undefined), null);
    assert.equal(isoTime("garbage"), null);
  });
});
