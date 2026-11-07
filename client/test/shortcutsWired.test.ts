import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LOCAL_SHORTCUTS, SEQUENCES, SHORTCUTS, shortcutIdFor, type KeyLike } from "../src/shortcuts";

const key = (k: string, m: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...m });

/** A key press for each id, the way the "?" sheet prints it. */
const PRESS: Record<string, KeyLike> = {
  command: key("k", { ctrlKey: true }),
  projects: key("p", { ctrlKey: true }),
  help: key("?", { shiftKey: true }),
  create: key("c"),
  search: key("/"),
  sync: key("R", { shiftKey: true }),
  "lens-1": key("1"),
  "lens-2": key("2"),
  "lens-3": key("3"),
  "lens-4": key("4"),
  next: key("j"),
  prev: key("k"),
  "select-all": key("a", { ctrlKey: true }),
  status: key("s"),
  assign: key("a"),
  "assign-me": key("i"),
  "shift-back": key("ArrowLeft", { altKey: true }),
  "shift-fwd": key("ArrowRight", { altKey: true }),
  "copy-key": key(".", { ctrlKey: true }),
  delete: key("Delete"),
  today: key("t"),
  draft: key("D", { shiftKey: true }),
  "log-time": key("l"),
  mine: key("m"),
  overdue: key("o"),
  "clear-filter": key("F", { shiftKey: true }),
};

describe("shortcuts are wired", () => {
  it("every id in the list is reached by a key, a sequence or its owner", () => {
    const sequenceIds = new Set(Object.values(SEQUENCES));
    for (const s of SHORTCUTS) {
      if (LOCAL_SHORTCUTS.has(s.id) || sequenceIds.has(s.id)) continue;
      const press = PRESS[s.id];
      assert.ok(press, `no key press known for "${s.id}" (${s.keys}): the sheet promises it, nothing dispatches it`);
      assert.equal(shortcutIdFor(press), s.id, `${s.keys} should mean ${s.id}`);
    }
  });
  it("ids are unique", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });
  it("does not claim keys it should leave alone", () => {
    assert.equal(shortcutIdFor(key("z", { ctrlKey: true })), null);
    assert.equal(shortcutIdFor(key("x")), null);
    assert.equal(shortcutIdFor(key("a", { altKey: true })), null);
  });
});
