// How wide the rail is when it shows names, and what dragging its edge does.
//
// The rail is narrow (bb's own width, icons only) or wide (names, at a width
// the user sets). Dragging its edge does both: from narrow, pulling it out
// past SNAP_WIDE turns names on at the width it reached; from wide, pushing
// it in below SNAP_NARROW turns them off and keeps the last wide width for
// next time. In between, the wide width follows the pointer within bounds.

export const WIDE_DEFAULT = 200;
export const WIDE_MIN = 140;
export const WIDE_MAX = 360;
/** Below this, a wide rail being dragged in becomes narrow. */
export const SNAP_NARROW = 110;
/** Past this, a narrow rail being dragged out becomes wide. */
export const SNAP_WIDE = 100;

export interface RailWidth {
  wide: boolean;
  /** The width the rail takes when wide, kept while it is narrow. */
  width: number;
}

export function clampWide(width: number): number {
  if (!Number.isFinite(width)) return WIDE_DEFAULT;
  return Math.round(Math.min(WIDE_MAX, Math.max(WIDE_MIN, width)));
}

/**
 * Where a drag of the rail's edge leaves it: `start` is how it was when the
 * drag began, `narrowWidth` bb's own rail width, `dx` how far the pointer has
 * moved, right being positive.
 */
export function dragRail(start: RailWidth, narrowWidth: number, dx: number): RailWidth {
  const from = start.wide ? start.width : narrowWidth;
  const target = from + dx;
  if (start.wide ? target < SNAP_NARROW : target < SNAP_WIDE) return { wide: false, width: start.width };
  return { wide: true, width: clampWide(target) };
}
