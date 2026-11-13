import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { confluencePageId, forgetPageTitles, isGenericTitle, linkTitle, resolvePageTitles, titleFromUrl } from "../src/confluenceLinks.js";

// What Jira's Confluence integration stores for a linked page.
const wiki = (pageId: string, url = `https://x.atlassian.net/wiki/pages/viewpage.action?pageId=${pageId}`) => ({
  object: { url, title: "Wiki Page" },
  globalId: `appId=abc-123&pageId=${pageId}`,
  application: { type: "com.atlassian.confluence", name: "Confluence" },
  relationship: "Wiki Page",
});

describe("confluencePageId", () => {
  it("reads the page from the global id, the viewpage address or a /pages/ path", () => {
    assert.equal(confluencePageId(wiki("123")), "123");
    assert.equal(confluencePageId({ object: { url: "https://x.atlassian.net/wiki/pages/viewpage.action?pageId=77" } }), "77");
    assert.equal(confluencePageId({ object: { url: "https://x.atlassian.net/wiki/spaces/AI/pages/456/Tai+lieu" } }), "456");
  });

  it("is nothing for an ordinary web link", () => {
    assert.equal(confluencePageId({ object: { url: "https://example.com/pages/9?pageId=9", title: "Ví dụ" } }), null);
  });
});

describe("titles", () => {
  it("knows Jira's label says nothing", () => {
    assert.equal(isGenericTitle("Wiki Page", "u"), true);
    assert.equal(isGenericTitle("u", "u"), true);
    assert.equal(isGenericTitle("Biên bản họp 07/10", "u"), false);
  });

  it("reads a title written into the address", () => {
    assert.equal(titleFromUrl("https://x.atlassian.net/wiki/spaces/AI/pages/456/Bi%C3%AAn+b%E1%BA%A3n+h%E1%BB%8Dp"), "Biên bản họp");
    assert.equal(titleFromUrl("https://x.atlassian.net/wiki/pages/viewpage.action?pageId=1"), null);
  });

  it("the real name first, then the address, then the page number; a link with its own title keeps it", () => {
    assert.equal(linkTitle(wiki("1"), "Change Management – PwC"), "Change Management – PwC");
    assert.equal(linkTitle(wiki("456", "https://x.atlassian.net/wiki/spaces/AI/pages/456/CoE+model"), null), "CoE model");
    assert.equal(linkTitle(wiki("1"), null), "Trang Confluence 1");
    assert.equal(linkTitle({ object: { url: "https://example.com", title: "Tài liệu" } }, "khác"), "Tài liệu");
  });
});

describe("resolvePageTitles", () => {
  beforeEach(() => forgetPageTitles());

  it("asks once per viewer and page, and remembers a page it could not read", async () => {
    const asked: string[] = [];
    const read = async (id: string) => {
      asked.push(id);
      return id === "2" ? null : `Trang ${id}`;
    };
    const me = { cloudId: "c", accountId: "a" };
    const first = await resolvePageTitles(["1", "2", "1"], me, read);
    assert.equal(first.get("1"), "Trang 1");
    assert.equal(first.get("2"), null);
    await resolvePageTitles(["1", "2"], me, read);
    assert.deepEqual(asked.sort(), ["1", "2"]);
    // Someone else may see other pages: their own question.
    await resolvePageTitles(["2"], { cloudId: "c", accountId: "b" }, read);
    assert.deepEqual(asked.sort(), ["1", "2", "2"]);
  });

  it("a read that throws is a page it could not read", async () => {
    const out = await resolvePageTitles(["9"], { cloudId: "c", accountId: "a" }, async () => {
      throw new Error("401 scope does not match");
    });
    assert.equal(out.get("9"), null);
  });
});
