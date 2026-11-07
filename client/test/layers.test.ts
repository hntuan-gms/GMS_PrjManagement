import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dismissForNavigation, escape, isOpen, openIds, pop, push, resetLayers, top } from "../src/layers";

afterEach(() => resetLayers());

describe("layers", () => {
  it("the last pushed layer is on top, and removing it exposes the one below", () => {
    const a = push("a");
    push("b");
    assert.equal(top()?.id, "b");
    assert.deepEqual(openIds(), ["a", "b"]);
    pop("b");
    assert.equal(top()?.id, "a");
    a();
    assert.equal(isOpen(), false);
    assert.equal(top(), null);
  });

  it("popping an id that is not open does nothing", () => {
    push("a");
    pop("zzz");
    assert.deepEqual(openIds(), ["a"]);
  });

  it("a stale disposer cannot remove a newer layer with the same id", () => {
    const first = push("a");
    pop("a");
    push("a");
    first();
    assert.deepEqual(openIds(), ["a"]);
  });

  it("Esc closes only the top layer", () => {
    const calls: string[] = [];
    push("under", { onEscape: () => calls.push("under") });
    push("over", { onEscape: () => calls.push("over") });
    assert.equal(escape(), true);
    assert.deepEqual(calls, ["over"]);
  });

  it("a layer without onEscape blocks shortcuts but leaves Esc to others", () => {
    const calls: string[] = [];
    push("under", { onEscape: () => calls.push("under") });
    push("modal");
    assert.equal(isOpen(), true);
    assert.equal(escape(), false);
    assert.deepEqual(calls, []);
  });

  it("isOpen can ignore one id (Ctrl K toggles the command bar itself)", () => {
    push("cmdk");
    assert.equal(isOpen("cmdk"), false);
    push("picker");
    assert.equal(isOpen("cmdk"), true);
  });

  it("navigation closes sheets that agree to it, topmost first, and leaves dialogs", () => {
    const calls: string[] = [];
    push("dialog", { onEscape: () => calls.push("dialog") });
    push("sheet-1", { onEscape: () => calls.push("sheet-1"), dismissOnNav: true });
    push("sheet-2", { onEscape: () => calls.push("sheet-2"), dismissOnNav: true });
    dismissForNavigation();
    assert.deepEqual(calls, ["sheet-2", "sheet-1"]);
  });
});
