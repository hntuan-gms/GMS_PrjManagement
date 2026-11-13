import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adfMediaIds, adfToRich, richToAdf } from "../src/adf.js";
import { parseBlocks, parseInline } from "../src/richText.js";

const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, ...marks: unknown[]) => (marks.length ? { type: "text", text, marks } : { type: "text", text });
const doc = (...content: unknown[]) => ({ type: "doc", version: 1, content });
const li = (...content: unknown[]) => ({ type: "listItem", content });

/** Text → ADF → text must give the same text back (what an edit in the panel relies on). */
function roundTrips(text: string) {
  assert.equal(adfToRich(richToAdf(text)), text);
}

describe("rich text → ADF", () => {
  it("headings, lists, code, quote and rule become their ADF nodes", () => {
    const adf = richToAdf("# Bối cảnh\n\n- một\n- hai\n\n1. a\n2. b\n\n```ts\nconst x = 1;\n```\n\n> trích\n\n---");
    assert.deepEqual(
      adf.content.map((n) => n.type),
      ["heading", "bulletList", "orderedList", "codeBlock", "blockquote", "rule"]
    );
    assert.deepEqual((adf.content[3] as any).attrs, { language: "ts" });
  });

  it("inline marks: bold, italic, strike, code, links and mentions", () => {
    const adf = richToAdf("**đậm** *nghiêng* ~~gạch~~ `kit.tsx` [tài liệu](https://e.com/a) @[Minh Quang](712:abc)");
    const nodes = (adf.content[0] as any).content;
    assert.deepEqual(nodes[0], t("đậm", { type: "strong" }));
    assert.deepEqual(nodes[2], t("nghiêng", { type: "em" }));
    assert.deepEqual(nodes[4], t("gạch", { type: "strike" }));
    assert.deepEqual(nodes[6], t("kit.tsx", { type: "code" }));
    assert.deepEqual(nodes[8], t("tài liệu", { type: "link", attrs: { href: "https://e.com/a" } }));
    assert.deepEqual(nodes[10], { type: "mention", attrs: { id: "712:abc", text: "@Minh Quang" } });
  });

  it("nested lists stay nested, a continued line stays in its item", () => {
    const adf = richToAdf("1. Chuyển các màn\n   a\n   - BoardView\n   - OkrView\n2. Ưu tiên");
    const list = adf.content[0] as any;
    assert.equal(list.type, "orderedList");
    assert.equal(list.content.length, 2);
    const first = list.content[0].content;
    assert.deepEqual(first[0], p(t("Chuyển các màn"), { type: "hardBreak" }, t("a")));
    assert.equal(first[1].type, "bulletList");
    assert.equal(first[1].content.length, 2);
  });

  it("a lone star, a hashtag and snake_case stay text", () => {
    const adf = richToAdf("5 * 3 #tag tc_code_1");
    assert.deepEqual(adf.content, [p(t("5 * 3 #tag tc_code_1"))]);
  });

  it("a picture on its own line is a media node when resolved, its name when not", () => {
    const resolved = richToAdf("Xem:\n\n![anh.png](attachment:10023)", {
      media: (src) => (src === "attachment:10023" ? { kind: "file", id: "u-u-i-d-1234" } : undefined),
    });
    assert.deepEqual(resolved.content[1], {
      type: "mediaSingle",
      attrs: { layout: "center" },
      content: [{ type: "media", attrs: { type: "file", id: "u-u-i-d-1234", collection: "", alt: "anh.png" } }],
    });
    assert.deepEqual(richToAdf("![anh.png](attachment:1)").content, [p(t("[anh.png]"))]);
  });

  it("code may share a node only with a link", () => {
    const adf = richToAdf("**`x`**");
    assert.deepEqual((adf.content[0] as any).content[0], t("x", { type: "code" }));
  });

  it("an empty text is still a valid document", () => {
    assert.deepEqual(richToAdf("").content, [{ type: "paragraph", content: [] }]);
  });
});

describe("ADF → rich text", () => {
  it("reads what Jira's editor writes", () => {
    const adf = doc(
      { type: "heading", attrs: { level: 2 }, content: [t("Việc cần làm")] },
      { type: "bulletList", content: [li(p(t("Ưu tiên "), t("<Button>", { type: "code" }), t(". Chỗ khó"))), li(p(t("hai")))] },
      { type: "orderedList", attrs: { order: 1 }, content: [li(p(t("BoardView")), { type: "bulletList", content: [li(p(t("con")))] })] },
      { type: "codeBlock", attrs: { language: "js" }, content: [t("a()\nb()")] },
      { type: "panel", attrs: { panelType: "info" }, content: [p(t("Lưu ý"))] }
    );
    assert.equal(
      adfToRich(adf),
      "## Việc cần làm\n\n- Ưu tiên `<Button>`. Chỗ khó\n- hai\n\n1. BoardView\n   - con\n\n```js\na()\nb()\n```\n\n> Lưu ý"
    );
  });

  it("text that looks like formatting is escaped, and reads back as itself", () => {
    const adf = doc(p(t("- không phải danh sách"), { type: "hardBreak" }, t("1. cũng không"), { type: "hardBreak" }, t("a*b `c` ~~d~~ [x](y)")));
    const text = adfToRich(adf);
    assert.deepEqual(richToAdf(text).content, adf.content.map((n: any) => ({ ...n, content: [t("- không phải danh sách"), { type: "hardBreak" }, t("1. cũng không"), { type: "hardBreak" }, t("a*b `c` ~~d~~ [x](y)")] })));
  });

  it("pictures: matched to an attachment when possible, kept as media otherwise", () => {
    const media = (id: string) => ({ type: "mediaSingle", content: [{ type: "media", attrs: { type: "file", id, collection: "jira-1" } }] });
    const adf = doc(media("aaaaaaaa-1111-2222-3333-444444444444"), media("bbbbbbbb-1111-2222-3333-444444444444"));
    assert.deepEqual(adfMediaIds(adf), ["aaaaaaaa-1111-2222-3333-444444444444", "bbbbbbbb-1111-2222-3333-444444444444"]);
    const text = adfToRich(adf, {
      attachmentOf: (id) => (id.startsWith("a") ? { id: "10", filename: "image-2026.png" } : undefined),
    });
    assert.equal(text, "![image-2026.png](attachment:10)\n\n![](media:bbbbbbbb-1111-2222-3333-444444444444)");
  });

  it("a link keeps its address; a bare one stays bare", () => {
    const adf = doc(p(t("xem "), t("spec", { type: "link", attrs: { href: "https://e.com/s" } }), t(" và "), t("https://e.com/b", { type: "link", attrs: { href: "https://e.com/b" } })));
    assert.equal(adfToRich(adf), "xem [spec](https://e.com/s) và https://e.com/b");
  });

  it("tolerates garbage", () => {
    assert.equal(adfToRich(null), "");
    assert.equal(adfToRich("nope"), "");
    assert.equal(adfToRich({ type: "doc", content: [{ type: "weird" }] }), "");
  });
});

describe("round trip", () => {
  for (const text of [
    "Chào @[Minh Quang](712020:abc-123), xem https://x.com/y. nhé\nDòng hai\n\nĐoạn mới",
    "# Bối cảnh\n\nBộ thành phần ở `src/components/ui/kit.tsx`: Button, Input.\n\n## Việc cần làm\n\n- Chuyển lần lượt\n  1. BoardView (105 nút)\n  2. OkrView (59)\n- Ưu tiên **Button** và _Chip_",
    "```\nlet a = 1;\n\nlet b = 2;\n```",
    "> trích dẫn\n> dòng hai",
    "Trước\n\n---\n\nSau",
    "![ảnh dán.png](attachment:10023)",
    "Giá 5 * 3, nhãn tc_1 và #tag",
    "~~bỏ~~ và [tài liệu](https://e.com/a b)",
  ]) {
    it(JSON.stringify(text.slice(0, 40)), () => {
      if (text.includes("attachment:")) {
        const adf = richToAdf(text, { media: () => ({ kind: "file", id: "aaaaaaaa-1111-2222-3333-444444444444" }) });
        assert.equal(adfToRich(adf, { attachmentOf: () => ({ id: "10023", filename: "x" }) }), text);
      } else if (text.includes("e.com/a b")) {
        // A space is not part of a link's address: it ends it.
        assert.ok(adfToRich(richToAdf(text)).startsWith("~~bỏ~~ và "));
      } else roundTrips(text);
    });
  }
});

describe("parse", () => {
  it("escapes make a marker literal", () => {
    assert.deepEqual(parseInline("\\*a\\*"), [{ t: "text", text: "*a*", marks: [] }]);
    assert.deepEqual(parseBlocks("1\\. không phải"), [{ t: "p", content: [{ t: "text", text: "1. không phải", marks: [] }] }]);
  });

  it("a heading keeps a trailing # that is part of a word", () => {
    assert.deepEqual(parseBlocks("# C#"), [{ t: "h", level: 1, content: [{ t: "text", text: "C#", marks: [] }] }]);
  });

  it("a bullet written with • (old comments of this app) is a list", () => {
    assert.equal(parseBlocks("• một\n• hai")[0].t, "ul");
  });
});
