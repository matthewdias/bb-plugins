// Where the card goes, and where the phone drawer settles. Pure, so it is
// tested without a DOM: the header measures, these decide.

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const CARD_WIDTH = 260;
export const CARD_MIN_WIDTH = 250;
export const CARD_MAX_WIDTH = 270;
/** Gap between the card and the pane's edges. */
export const INSET = 8;
/** Gap between the header's bottom edge and the card. */
export const GAP = 4;

export interface CardPlacement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

/**
 * The card under the header, against the pane's right edge, inside the pane.
 *
 * `header` is the thread header the button sits in and `pane` the thread's
 * pane; split panes each have their own, so each card stays over its thread.
 * The width is 260 within 250–270, and narrower only when the pane is.
 */
export function placeCard(header: Rect, pane: Rect, preferredWidth: number = CARD_WIDTH): CardPlacement {
  const room = Math.max(0, pane.width - 2 * INSET);
  const wanted = Math.min(CARD_MAX_WIDTH, Math.max(CARD_MIN_WIDTH, preferredWidth));
  const width = Math.min(wanted, room);
  const right = Math.min(header.left + header.width, pane.left + pane.width) - INSET;
  const left = Math.max(pane.left + INSET, right - width);
  const top = header.top + header.height + GAP;
  const maxHeight = Math.max(0, pane.top + pane.height - INSET - top);
  return { left, top, width, maxHeight };
}

/** The drawer's two heights, as a share of the viewport. */
export const DRAWER_HALF = 0.5;
export const DRAWER_FULL = 0.92;
/** Released shorter than this share, the drawer closes. */
export const DRAWER_CLOSE = 0.35;

export type Detent = "half" | "full";

/**
 * Where a drawer released at `height` settles, in a viewport `viewportHeight`
 * tall: closed below 35 %, otherwise whichever detent is nearer. Question
 * Dock's sheet settles the same way.
 */
export function snapDrawer(height: number, viewportHeight: number): Detent | "close" {
  const share = viewportHeight > 0 ? height / viewportHeight : 0;
  if (share < DRAWER_CLOSE) return "close";
  return Math.abs(share - DRAWER_HALF) <= Math.abs(share - DRAWER_FULL) ? "half" : "full";
}
