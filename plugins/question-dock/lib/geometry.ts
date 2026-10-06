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
/** The dock's default width, as a share of the pane, between the bounds below. */
export const DOCK_SHARE = 0.45;
export const DOCK_DEFAULT_MIN = 440;
export const DOCK_DEFAULT_MAX = 640;
/** How far the dock's edge can be dragged either way. */
export const DOCK_MIN_WIDTH = 360;
export const DOCK_MAX_WIDTH = 760;
/** The narrowest chat column a dock may leave beside it. */
export const CHAT_MIN_WIDTH = 520;
/** Narrowest pane that docks: the dock plus a chat column bb still lays out well. */
export const DOCK_MIN_PANE = 960;
export const FLOAT_WIDTH = 380;
/** The smallest a float can be resized to. */
export const FLOAT_MIN_WIDTH = 300;
export const FLOAT_MIN_HEIGHT = 120;
/** How near an edge a press resizes, and how big the corners are. */
export const RESIZE_EDGE = 6;
export const RESIZE_CORNER = 16;
/** The tallest a float gets, as a share of the pane, so the chat stays in view. */
export const FLOAT_MAX_SHARE = 0.7;
/** A float this close to the pane's right edge docks on release. */
export const DOCK_ZONE = 48;
/** Below this much room above the composer, a float may cover the composer. */
export const FLOAT_MIN_ROOM = 200;
/** A half sheet, as a share of the thread's pane. */
export const SHEET_HALF = 0.5;
/** Room a full sheet leaves under the top of the pane, below bb's top bar. */
export const SHEET_TOP_GAP = 8;
/** A sheet released shorter than this share of the pane collapses back into bb's bar. */
export const SHEET_COLLAPSE = 0.35;

/**
 * Where a float was left. `x` is a fraction of the room it can move across;
 * `y` is how far its anchored edge sits from the matching edge of the room,
 * as a fraction of the room's height. A card dropped in the lower half is
 * anchored by its bottom and one in the upper half by its top, so a card
 * that changes height (a shorter or longer next question) keeps the edge
 * nearer where it was put instead of jumping.
 */
export interface FloatPosition {
  x: number;
  y: number;
  anchor: "top" | "bottom";
}

/** Where a float starts before anyone moves it: bottom right, above the composer. */
export const DEFAULT_FLOAT: FloatPosition = { x: 1, y: 0, anchor: "bottom" };

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
 * A collapsed card is bb's one-line bar above the composer, in every mode:
 * collapsing puts the card away, and expanding the bar brings it back where
 * it was, docked, floating or as a sheet.
 */
export function chooseMode(input: ModeInput): Mode | null {
  if (!input.expanded) return null;
  if (input.compact) return input.mobileSheet ? "sheet" : null;
  if (input.desktopMode === "inline") return null;
  return input.desktopMode === "dock" && canDock(input.paneWidth) ? "dock" : "float";
}

/**
 * The dock's width in a pane `paneWidth` wide: the width its edge was dragged
 * to, or a share of the pane, and never so wide the chat beside it is cramped.
 */
export function dockWidth(paneWidth: number, preferred: number | null): number {
  const wanted =
    preferred ?? Math.min(DOCK_DEFAULT_MAX, Math.max(DOCK_DEFAULT_MIN, Math.round(paneWidth * DOCK_SHARE)));
  const widest = Math.min(DOCK_MAX_WIDTH, paneWidth - CHAT_MIN_WIDTH - 2 * INSET);
  return Math.round(Math.max(DOCK_MIN_WIDTH, Math.min(wanted, widest)));
}

/** The dock column: the pane's right edge, bottom-anchored, full height at most. */
export function dockPlacement(
  pane: Rect,
  width: number,
): { left: number; bottom: number; width: number; maxHeight: number } {
  return {
    left: pane.left + pane.width - width - INSET,
    bottom: pane.top + pane.height - INSET,
    width,
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

/** A float's width: the one it was resized to, or the default, inside `bounds`. */
export function floatWidth(bounds: Rect, preferred: number | null = null): number {
  const narrowest = Math.min(FLOAT_MIN_WIDTH, bounds.width);
  return Math.max(narrowest, Math.min(preferred ?? FLOAT_WIDTH, bounds.width));
}

/**
 * The tallest a float gets: the height it was resized to, or most of the
 * pane, inside `bounds`. It is a ceiling, not a height: a short question
 * leaves no empty space under bb's buttons.
 */
export function floatMaxHeight(pane: Rect, bounds: Rect, preferred: number | null = null): number {
  if (preferred !== null) return Math.min(bounds.height, Math.max(FLOAT_MIN_HEIGHT, preferred));
  return Math.min(bounds.height, Math.round(pane.height * FLOAT_MAX_SHARE));
}

/**
 * Which edge of a lifted card a press at (x, y) resizes. A dock resizes from
 * its left edge, a float from its left edge, its bottom edge and its two
 * bottom corners. The top is the header, which moves the card, and a float's
 * right edge is where its scrollbar sits.
 */
export type ResizeZone = "w" | "s" | "sw" | "se";

export function resizeZone(rect: Rect, x: number, y: number, mode: "dock" | "float"): ResizeZone | null {
  const fromLeft = x - rect.left;
  const fromRight = rect.left + rect.width - x;
  const fromTop = y - rect.top;
  const fromBottom = rect.top + rect.height - y;
  if (fromLeft < 0 || fromRight < 0 || fromTop < 0 || fromBottom < 0) return null;
  if (mode === "dock") return fromLeft <= RESIZE_EDGE ? "w" : null;
  if (fromBottom <= RESIZE_CORNER && fromRight <= RESIZE_CORNER) return "se";
  if (fromBottom <= RESIZE_CORNER && fromLeft <= RESIZE_CORNER) return "sw";
  if (fromLeft <= RESIZE_EDGE) return "w";
  if (fromBottom <= RESIZE_EDGE) return "s";
  return null;
}

/** A float's box after dragging its `zone` by (dx, dy) from `start`, kept inside `bounds`. */
export function resizeFloat(start: Rect, zone: ResizeZone, dx: number, dy: number, bounds: Rect): Rect {
  const minWidth = Math.min(FLOAT_MIN_WIDTH, bounds.width);
  const minHeight = Math.min(FLOAT_MIN_HEIGHT, bounds.height);
  const right = start.left + start.width;
  let { left, width, height } = start;
  if (zone === "w" || zone === "sw") {
    left = Math.min(Math.max(start.left + dx, bounds.left), right - minWidth);
    width = right - left;
  }
  // Never past the room, but never below the minimum either, even for a card
  // already partly outside it (the room shrank under it).
  if (zone === "se") {
    width = Math.max(minWidth, Math.min(start.width + dx, bounds.left + bounds.width - start.left));
  }
  if (zone === "s" || zone === "sw" || zone === "se") {
    height = Math.max(minHeight, Math.min(start.height + dy, bounds.top + bounds.height - start.top));
  }
  return { left, top: start.top, width, height };
}

export function isFloatSize(value: unknown): value is { width: number; height: number } {
  if (typeof value !== "object" || value === null) return false;
  const { width, height } = value as Record<string, unknown>;
  return typeof width === "number" && typeof height === "number" && Number.isFinite(width) && Number.isFinite(height);
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

/**
 * The tallest a sheet gets: the thread's pane, less a gap. bb keeps the pane
 * between its top bar and the on-screen keyboard, so this is all the room
 * there is to see.
 */
export function sheetRoom(paneHeight: number): number {
  return Math.max(0, paneHeight - SHEET_TOP_GAP);
}

/**
 * A sheet's height in a pane `paneHeight` tall. While its text box has the
 * keyboard, it takes all the room, so what you type is not hidden under the
 * question.
 */
export function sheetHeight(paneHeight: number, detent: "half" | "full", typing: boolean): number {
  const room = sheetRoom(paneHeight);
  if (typing || detent === "full") return room;
  return Math.min(room, Math.round(paneHeight * SHEET_HALF));
}

/** Where a sheet released at `height` settles, in a pane `paneHeight` tall. */
export function snapSheet(height: number, paneHeight: number): "collapse" | "half" | "full" {
  const share = paneHeight > 0 ? height / paneHeight : 0;
  if (share < SHEET_COLLAPSE) return "collapse";
  return Math.abs(share - SHEET_HALF) <= Math.abs(share - 1) ? "half" : "full";
}

export function isFloatPosition(value: unknown): value is FloatPosition {
  if (typeof value !== "object" || value === null) return false;
  const { x, y, anchor } = value as Record<string, unknown>;
  return (
    typeof x === "number" &&
    typeof y === "number" &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    (anchor === "top" || anchor === "bottom")
  );
}

/** The position to remember for a card dropped at `rect`. */
export function floatPositionOf(bounds: Rect, rect: Rect): FloatPosition {
  const roomX = Math.max(0, bounds.width - rect.width);
  const height = Math.max(1, bounds.height);
  const bottom = bounds.top + bounds.height;
  const anchor = rect.top + rect.height / 2 > bounds.top + bounds.height / 2 ? "bottom" : "top";
  return {
    x: roomX === 0 ? 1 : clamp01((rect.left - bounds.left) / roomX),
    y: clamp01(anchor === "top" ? (rect.top - bounds.top) / height : (bottom - (rect.top + rect.height)) / height),
    anchor,
  };
}

/**
 * The left edge, and the y of the anchored edge (the top or the bottom), for
 * a card of `size` at `position`, kept wholly inside `bounds`.
 */
export function placeFloat(
  bounds: Rect,
  size: { width: number; height: number },
  position: FloatPosition,
): { left: number; edge: number } {
  const roomX = Math.max(0, bounds.width - size.width);
  const height = Math.min(size.height, bounds.height);
  const bottom = bounds.top + bounds.height;
  const left = bounds.left + clamp01(position.x) * roomX;
  if (position.anchor === "top") {
    const top = bounds.top + clamp01(position.y) * bounds.height;
    return { left, edge: Math.min(Math.max(top, bounds.top), bottom - height) };
  }
  const edge = bottom - clamp01(position.y) * bounds.height;
  return { left, edge: Math.max(Math.min(edge, bottom), bounds.top + height) };
}
