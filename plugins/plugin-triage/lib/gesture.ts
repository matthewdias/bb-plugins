// What a drag of the top card means. Pure, so the thresholds are tested
// rather than tuned by feel each time the card changes.

export type Direction = "right" | "left" | "up";

/** Distance past which a released card is decided rather than snapped back. */
export const DECIDE_DISTANCE = 120;
/** A quick flick decides from a shorter drag: px per ms at release. */
export const FLICK_VELOCITY = 0.6;
const FLICK_MIN_DISTANCE = 40;

/**
 * The direction a drag leans, or null while it is still ambiguous. Up wins
 * only when the drag is mostly vertical, so a sideways swipe that drifts
 * upward still reads as sideways. Down means nothing.
 */
export function leaning(dx: number, dy: number): Direction | null {
  if (dx === 0 && dy === 0) return null;
  if (-dy > Math.abs(dx)) return "up";
  if (Math.abs(dx) >= Math.abs(dy) || dy > 0) {
    if (dx > 0) return "right";
    if (dx < 0) return "left";
  }
  return null;
}

/** How far toward deciding the drag is, 0..1, for the label's opacity. */
export function progress(dx: number, dy: number): number {
  const direction = leaning(dx, dy);
  if (direction === null) return 0;
  const distance = direction === "up" ? -dy : Math.abs(dx);
  return Math.max(0, Math.min(1, distance / DECIDE_DISTANCE));
}

/**
 * The direction a release would decide by distance alone: the moment the card
 * is "armed", which is when a phone gives a tick.
 */
export function armed(dx: number, dy: number): Direction | null {
  return release(dx, dy, 0);
}

/** The decision a release makes, or null to snap back. */
export function release(dx: number, dy: number, velocity = 0): Direction | null {
  const direction = leaning(dx, dy);
  if (direction === null) return null;
  const distance = direction === "up" ? -dy : Math.abs(dx);
  if (distance >= DECIDE_DISTANCE) return direction;
  if (distance >= FLICK_MIN_DISTANCE && velocity >= FLICK_VELOCITY) return direction;
  return null;
}

export interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

export type KeyCommand = Direction | "details" | "close" | "undo";

/** The deck's keys. Modified presses other than ⌘Z / Ctrl+Z belong to bb. */
export function keyCommand(event: KeyLike): KeyCommand | null {
  const modified = event.metaKey === true || event.ctrlKey === true || event.altKey === true;
  if (event.key === "z" || event.key === "Z") {
    return event.altKey === true ? null : "undo";
  }
  if (modified) return null;
  switch (event.key) {
    case "ArrowRight":
      return "right";
    case "ArrowLeft":
      return "left";
    case "ArrowUp":
      return "up";
    case " ":
    case "Enter":
      return "details";
    case "Escape":
      return "close";
  }
  return null;
}
