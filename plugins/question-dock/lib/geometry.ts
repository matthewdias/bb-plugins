// Where a lifted card goes. Pure, so it is tested without a DOM: the
// controller measures the pane and the card, and these decide the rest.

export type Mode = "dock" | "float" | "sheet";
/** What the person asked for on a desktop-sized pane. */
export type DesktopMode = "dock" | "float" | "inline";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A card's top-left as fractions of the room it can move in, 0..1 each way. */
export interface Fraction {
  x: number;
  y: number;
}

/** Gap between a lifted card and the pane's edges. */
export const INSET = 8;
export const DOCK_WIDTH = 380;
/** Narrowest pane that docks: the dock plus a chat column bb still lays out well. */
export const DOCK_MIN_PANE = 960;
export const FLOAT_WIDTH = 380;
/** The tallest a float gets, as a share of the pane, so the chat stays in view. */
export const FLOAT_MAX_SHARE = 0.7;
/** A float this close to the pane's right edge docks on release. */
export const DOCK_ZONE = 48;
/** Below this much room above the composer, a float may cover the composer. */
export const FLOAT_MIN_ROOM = 200;
/** Sheet heights as fractions of the window. */
export const SHEET_HALF = 0.5;
export const SHEET_FULL = 0.9;
/** A sheet released shorter than this collapses back into bb's bar. */
export const SHEET_COLLAPSE = 0.35;
/** Where a float starts before anyone moves it: bottom right, above the composer. */
export const DEFAULT_FRACTION: Fraction = { x: 1, y: 1 };

export interface ModeInput {
  /** Phone-sized window, or touch with no hover. */
  compact: boolean;
  /** bb's own expanded state for the card. */
  expanded: boolean;
  paneWidth: number;
  desktopMode: DesktopMode;
  mobileSheet: boolean;
}

export function canDock(paneWidth: number): boolean {
  return paneWidth >= DOCK_MIN_PANE;
}

/**
 * The mode for one card, or null to leave it where bb draws it.
 *
 * A collapsed card is bb's one-line bar above the composer, which is the
 * right place for it in every mode but float: there it is a small chip that
 * stays where it was put.
 */
export function chooseMode(input: ModeInput): Mode | null {
  if (input.compact) return input.mobileSheet && input.expanded ? "sheet" : null;
  if (input.desktopMode === "inline") return null;
  const mode: Mode =
    input.desktopMode === "dock" && canDock(input.paneWidth) ? "dock" : "float";
  if (mode === "dock" && !input.expanded) return null;
  return mode;
}

/** The dock column: the pane's right edge, bottom-anchored, full height at most. */
export function dockPlacement(pane: Rect): { left: number; bottom: number; width: number; maxHeight: number } {
  return {
    left: pane.left + pane.width - DOCK_WIDTH - INSET,
    bottom: pane.top + pane.height - INSET,
    width: DOCK_WIDTH,
    maxHeight: Math.max(0, pane.height - 2 * INSET),
  };
}

/**
 * The room a float moves in: the pane, minus the composer below it when that
 * leaves enough to be useful, so a float never hides where you type.
 */
export function floatBounds(pane: Rect, composerTop: number | null): Rect {
  const bottom =
    composerTop !== null && composerTop - pane.top >= FLOAT_MIN_ROOM
      ? Math.min(composerTop, pane.top + pane.height)
      : pane.top + pane.height;
  return {
    left: pane.left + INSET,
    top: pane.top + INSET,
    width: Math.max(0, pane.width - 2 * INSET),
    height: Math.max(0, bottom - pane.top - 2 * INSET),
  };
}

export function floatWidth(bounds: Rect): number {
  return Math.min(FLOAT_WIDTH, bounds.width);
}

export function floatMaxHeight(pane: Rect, bounds: Rect): number {
  return Math.min(bounds.height, Math.round(pane.height * FLOAT_MAX_SHARE));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** A fraction to a top-left point, for a card of `size` in `bounds`. */
export function fromFraction(
  bounds: Rect,
  size: { width: number; height: number },
  fraction: Fraction,
): { left: number; top: number } {
  const roomX = Math.max(0, bounds.width - size.width);
  const roomY = Math.max(0, bounds.height - size.height);
  return {
    left: bounds.left + clamp01(fraction.x) * roomX,
    top: bounds.top + clamp01(fraction.y) * roomY,
  };
}

/** A top-left point to a fraction, clamped, so a resize never strands a card. */
export function toFraction(
  bounds: Rect,
  size: { width: number; height: number },
  point: { left: number; top: number },
): Fraction {
  const roomX = Math.max(0, bounds.width - size.width);
  const roomY = Math.max(0, bounds.height - size.height);
  return {
    x: roomX === 0 ? 1 : clamp01((point.left - bounds.left) / roomX),
    y: roomY === 0 ? 1 : clamp01((point.top - bounds.top) / roomY),
  };
}

/** Whether releasing a dragged card at `pointerX` docks it. */
export function inDockZone(pane: Rect, pointerX: number): boolean {
  return canDock(pane.width) && pointerX >= pane.left + pane.width - DOCK_ZONE;
}

/** Where a sheet released at `height` settles, out of `windowHeight`. */
export function snapSheet(height: number, windowHeight: number): "collapse" | "half" | "full" {
  const share = windowHeight > 0 ? height / windowHeight : 0;
  if (share < SHEET_COLLAPSE) return "collapse";
  return Math.abs(share - SHEET_HALF) <= Math.abs(share - SHEET_FULL) ? "half" : "full";
}

export function isFraction(value: unknown): value is Fraction {
  if (typeof value !== "object" || value === null) return false;
  const { x, y } = value as Record<string, unknown>;
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y);
}
