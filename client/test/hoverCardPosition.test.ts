import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CARD_GAP, CARD_MARGIN, placeHoverCard } from "../src/hoverCardPosition";

const view = { width: 1200, height: 800 };
const card = { width: 300, height: 100 };

describe("placeHoverCard", () => {
  it("opens below and to the right of the pointer", () => {
    assert.deepEqual(placeHoverCard({ x: 200, y: 300 }, card, view), { x: 200 + CARD_GAP, y: 300 + CARD_GAP });
  });

  it("flips to the left of the pointer near the right edge", () => {
    const p = placeHoverCard({ x: 1100, y: 300 }, card, view);
    assert.equal(p.x, 1100 - CARD_GAP - card.width);
    assert.equal(p.y, 300 + CARD_GAP);
  });

  it("flips above the pointer near the bottom edge", () => {
    const p = placeHoverCard({ x: 200, y: 760 }, card, view);
    assert.equal(p.y, 760 - CARD_GAP - card.height);
    assert.equal(p.x, 200 + CARD_GAP);
  });

  it("flips on both axes in the bottom-right corner", () => {
    assert.deepEqual(placeHoverCard({ x: 1190, y: 790 }, card, view), { x: 1190 - CARD_GAP - card.width, y: 790 - CARD_GAP - card.height });
  });

  it("stays inside the window when neither side has room", () => {
    const tiny = { width: 200, height: 120 };
    const p = placeHoverCard({ x: 100, y: 60 }, { width: 400, height: 300 }, tiny);
    assert.ok(p.x >= CARD_MARGIN && p.y >= CARD_MARGIN, JSON.stringify(p));
  });

  it("never goes past the left or top edge", () => {
    const p = placeHoverCard({ x: 5, y: 5 }, card, view);
    assert.ok(p.x >= CARD_MARGIN && p.y >= CARD_MARGIN);
  });
});
