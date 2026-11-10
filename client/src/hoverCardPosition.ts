/*
 * Where a hover card goes: just beside the pointer, kept inside the window. Pure, so the placement rules are
 * tested without a browser.
 *
 * It exists because gantt-task-react places its own hover card from `index × rowHeight − scrollY + headerHeight`
 * and the pane's size; whenever its idea of a row differs from the row we draw, the card lands rows away from
 * the bar it describes (seen: a card several rows below the bar, at the bottom of the pane). The pointer is
 * where the person is looking, so the card follows that instead.
 */

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}

/** Distance between the pointer and the card, and the margin kept from the window's edge. */
export const CARD_GAP = 14;
export const CARD_MARGIN = 8;

/**
 * Below and to the right of the pointer; flipped to the other side of it when that would run past the window's
 * right or bottom edge; and never outside the window even when the card is bigger than the room on both sides.
 */
export function placeHoverCard(pointer: Point, card: Size, viewport: Size): Point {
  let left = pointer.x + CARD_GAP;
  if (left + card.width > viewport.width - CARD_MARGIN) left = pointer.x - CARD_GAP - card.width;
  let top = pointer.y + CARD_GAP;
  if (top + card.height > viewport.height - CARD_MARGIN) top = pointer.y - CARD_GAP - card.height;
  return {
    x: Math.max(CARD_MARGIN, Math.min(left, viewport.width - CARD_MARGIN - card.width)),
    y: Math.max(CARD_MARGIN, Math.min(top, viewport.height - CARD_MARGIN - card.height)),
  };
}
