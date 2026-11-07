import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  atBottom,
  composeMessage,
  filterPeople,
  insertMentions,
  mentionQueryAt,
  nextMarks,
  parseUserMessage,
  suggestionsFor,
} from "../src/chatCompose";
import { dragKeysFor, readTaskDrag, TASK_MIME } from "../src/taskDrag";
import { clampRect, defaultRect, launchOrigin, maximizedRect, resizeRect, MIN_H, MIN_W, parseRect } from "../src/windowGeometry";
import type { JiraUser } from "../src/types";
import type { Mentions } from "../src/mentions";

const people: JiraUser[] = [
  { accountId: "a1", displayName: "Nguyễn An", avatarUrl: null },
  { accountId: "a2", displayName: "Nguyễn An", avatarUrl: null },
  { accountId: "b1", displayName: "Đặng Bình", avatarUrl: null },
  { accountId: "c1", displayName: "Lê Quang", avatarUrl: null },
];

describe("chat message: compose and parse", () => {
  it("a bundle of dragged work becomes a trailer and parses back", () => {
    const msg = composeMessage("Dời các việc này sang tuần sau", [
      { key: "GPM-1", summary: "Thiết kế API" },
      { key: "GPM-2", summary: "Kiểm thử «alpha»" },
    ], new Map());
    assert.equal(msg, "Dời các việc này sang tuần sau\n\nViệc đính kèm: GPM-1 «Thiết kế API»; GPM-2 «Kiểm thử  alpha»");
    const parsed = parseUserMessage(msg);
    assert.deepEqual(parsed.tasks.map((t) => t.key), ["GPM-1", "GPM-2"]);
    assert.equal(parsed.segments.map((s) => (s.kind === "text" ? s.text : "")).join(""), "Dời các việc này sang tuần sau");
  });

  it("no work attached: the text is sent as typed, mentions as tokens", () => {
    const mentions: Mentions = new Map([["Lê Quang", { accountId: "c1", name: "Lê Quang" }]]);
    assert.equal(composeMessage("giao cho @Lê Quang", [], mentions), "giao cho @[Lê Quang](c1)");
  });

  it("keys and mentions inside the text become pieces, a trailer that is not one stays text", () => {
    const p = parseUserMessage("GPM-12 giao @[Lê Quang](c1) nhé");
    assert.deepEqual(p.segments.map((s) => s.kind), ["key", "text", "mention", "text"]);
    const odd = parseUserMessage("hỏi\n\nViệc đính kèm: không phải mã");
    assert.equal(odd.tasks.length, 0);
  });
});

describe("chat: @ people menu", () => {
  it("finds the word being typed after an @, not an @ inside an address", () => {
    assert.deepEqual(mentionQueryAt("giao cho @qu", 12), { start: 9, query: "qu" });
    assert.equal(mentionQueryAt("mail a@b.com", 12), null);
    assert.equal(mentionQueryAt("xong rồi", 4), null);
    assert.deepEqual(mentionQueryAt("@Nguyễn A", 9), { start: 0, query: "Nguyễn A" });
    assert.equal(mentionQueryAt("giao @Trần Bình ", 16), null, "just inserted: the menu stays shut");
  });

  it("matches without diacritics, every word by its start, me first when nothing is typed", () => {
    assert.deepEqual(filterPeople(people, "dang").map((u) => u.accountId), ["b1"]);
    assert.deepEqual(filterPeople(people, "nguyen a").map((u) => u.accountId), ["a1", "a2"]);
    assert.equal(filterPeople(people, "", "c1")[0].accountId, "c1");
  });

  it("Ctrl toggles, Shift extends from the anchor, a plain pick is one person", () => {
    const order = ["a1", "a2", "b1", "c1"];
    assert.deepEqual(nextMarks([], order, "a2", { toggle: true, range: false }, null), ["a2"]);
    assert.deepEqual(nextMarks(["a2"], order, "c1", { toggle: true, range: false }, "a2"), ["a2", "c1"]);
    assert.deepEqual(nextMarks(["a2", "c1"], order, "a2", { toggle: true, range: false }, "a2"), ["c1"]);
    assert.deepEqual(nextMarks(["a1"], order, "b1", { toggle: false, range: true }, "a1"), ["a1", "a2", "b1"]);
    assert.deepEqual(nextMarks(["a1"], order, "c1", { toggle: false, range: false }, "a1"), ["c1"]);
  });

  it("inserting several people keeps two of the same name apart and ends with a space", () => {
    const q = { start: 4, query: "ng" };
    const r = insertMentions("cho @ng", q, 7, [people[0], people[1]], new Map());
    assert.equal(r.text, "cho @Nguyễn An @Nguyễn An (2) ");
    assert.equal(r.caret, r.text.length);
    assert.equal(composeMessage(r.text, [], r.mentions), "cho @[Nguyễn An](a1) @[Nguyễn An](a2)");
  });
});

describe("chat: drag payload and window geometry", () => {
  it("a row inside the selection drags the selection in list order, any other row only itself", () => {
    const order = ["A-1", "A-2", "A-3", "A-4"];
    assert.deepEqual(dragKeysFor("A-3", new Set(["A-3", "A-1"]), order), ["A-1", "A-3"]);
    assert.deepEqual(dragKeysFor("A-2", new Set(["A-3", "A-1"]), order), ["A-2"]);
    assert.deepEqual(dragKeysFor("A-2", new Set(["A-2"]), order), ["A-2"]);
  });

  it("reads only well-formed keys from a drop", () => {
    const dt = { getData: (t: string) => (t === TASK_MIME ? JSON.stringify(["GPM-1", "x", 3, "GPM-22"]) : "") } as unknown as DataTransfer;
    assert.deepEqual(readTaskDrag({ dataTransfer: dt }), ["GPM-1", "GPM-22"]);
    assert.deepEqual(readTaskDrag({ dataTransfer: { getData: () => "{" } as unknown as DataTransfer }), []);
  });

  it("the title bar can never be dragged out of reach, and the size never drops below the minimum", () => {
    const r = clampRect({ x: -5000, y: -40, w: 100, h: 100 }, 1280, 800);
    assert.ok(r.w >= MIN_W && r.h >= MIN_H);
    assert.ok(r.x + r.w >= 260 && r.y === 0);
    const far = clampRect({ x: 9000, y: 9000, w: 400, h: 500 }, 1280, 800);
    assert.ok(far.x <= 1280 - 120 && far.y <= 800 - 40);
  });

  it("opens bottom right inside any viewport, even a small one", () => {
    const r = defaultRect(1280, 800);
    assert.ok(r.x + r.w <= 1280 && r.y + r.h <= 800);
    const small = defaultRect(360, 640);
    assert.ok(small.x >= 0 && small.w <= 360);
  });

  it("resizing from the left edge keeps the right edge where it was", () => {
    const start = { x: 800, y: 100, w: 420, h: 600 };
    const r = resizeRect(start, "w", -100, 0, 1600, 900);
    assert.equal(r.x + r.w, 1220);
    assert.equal(r.w, 520);
    const tiny = resizeRect(start, "w", 400, 0, 1600, 900);
    assert.equal(tiny.w, MIN_W);
    assert.equal(tiny.x + tiny.w, 1220);
  });

  it("maximised fills the area beside the rail, a damaged saved rect is ignored", () => {
    const m = maximizedRect(1400, 900, 56);
    assert.ok(m.x >= 56 && m.x + m.w <= 1400);
    assert.equal(parseRect("{nope"), null);
    assert.deepEqual(parseRect('{"x":1,"y":2,"w":400,"h":500}'), { x: 1, y: 2, w: 400, h: 500 });
  });

  it("the window grows from the middle of the button that opens it, and from its own corner when there is none", () => {
    const win = { x: 1000, y: 200, w: 420, h: 620 };
    const button = { x: 5, y: 700, w: 46, h: 44 };
    const o = launchOrigin(win, button);
    // The button's centre (28, 722) as an offset inside the window.
    assert.deepEqual([o.ox, o.oy], [28 - 1000, 722 - 200]);
    assert.ok(o.scale >= 0.08 && o.scale <= 0.3, String(o.scale));
    assert.ok(Math.abs(o.scale - 46 / 420) < 0.001);
    const alone = launchOrigin(win, null);
    assert.deepEqual([alone.ox, alone.oy], [420, 620]);
  });
});

describe("chat: small rules", () => {
  it("suggestions follow the screen, and a selection changes them", () => {
    assert.ok(suggestionsFor("board", false).some((s) => s.includes("Sprint")));
    assert.ok(suggestionsFor("gantt", true)[0].includes("đang chọn"));
  });

  it("only follows new text while the reader is at the bottom", () => {
    assert.equal(atBottom({ scrollTop: 952, clientHeight: 400, scrollHeight: 1400 }), true);
    assert.equal(atBottom({ scrollTop: 300, clientHeight: 400, scrollHeight: 1400 }), false);
  });
});
