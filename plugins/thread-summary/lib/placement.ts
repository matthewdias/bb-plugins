// Where the card goes, and when the phone drawer lets go. Pure, so it is
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

/** The tallest the drawer gets, as a share of the viewport; past it, it scrolls. */
export const DRAWER_FULL = 0.92;
/**
 * How far the drawer must be dragged down to close, as a share of its own
 * height. Its height fits its contents, so a share of the viewport would
 * close a short drawer on any drag at all. A quarter is bb's own drawer's
 * rule (PERSISTENT_DRAWER_CLOSE_RATIO in components/ui/responsive-overlay).
 */
export const DRAWER_CLOSE = 0.25;

/**
 * Whether a drawer `height` tall, dragged down by `dragged`, closes on
 * release. Short of that it springs back to where it started.
 */
export function dismissesAt(dragged: number, height: number): boolean {
  return dragged > 0 && dragged >= height * DRAWER_CLOSE;
}
