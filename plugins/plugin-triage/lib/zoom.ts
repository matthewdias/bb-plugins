// Zoom and pan for the screenshot gallery. Pure, so the geometry is tested
// rather than tuned by eye.
//
// A view is `translate(x, y) scale(scale)` applied to an image whose layout
// box is `box`, centred on the stage, with the default transform origin (the
// image's centre). Points are given relative to that centre.

export interface View {
  scale: number;
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  width: number;
  height: number;
}

export const IDENTITY: View = { scale: 1, x: 0, y: 0 };
export const MIN_SCALE = 1;
export const MAX_SCALE = 5;
/** Where a double-tap or the + key lands from fit. */
export const STEP_SCALE = 2.5;

export const isZoomed = (view: View) => view.scale > 1.001;

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Keep the image covering its own box: it may not be dragged so far that a
 * gap opens on a side it overflows. At fit it sits centred.
 */
export function clamp(view: View, box: Box): View {
  const scale = clampScale(view.scale);
  const maxX = (box.width * scale - box.width) / 2;
  const maxY = (box.height * scale - box.height) / 2;
  const x = Math.min(maxX, Math.max(-maxX, view.x));
  const y = Math.min(maxY, Math.max(-maxY, view.y));
  return { scale, x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

/** Zoom to `scale` keeping whatever is under `focal` where it is. */
export function zoomAbout(view: View, scale: number, focal: Point, box: Box): View {
  const next = clampScale(scale);
  const ratio = next / view.scale;
  return clamp(
    {
      scale: next,
      x: focal.x - (focal.x - view.x) * ratio,
      y: focal.y - (focal.y - view.y) * ratio,
    },
    box,
  );
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * A pinch from two starting points to two current ones: scaled by how far
 * the fingers spread, and moved so the spot that began between them stays
 * between them, which pans with the fingers as they travel.
 */
export function pinch(start: View, from: [Point, Point], to: [Point, Point], box: Box): View {
  const spread = distance(from[0], from[1]);
  const scale = clampScale(spread === 0 ? start.scale : start.scale * (distance(to[0], to[1]) / spread));
  const a = midpoint(from[0], from[1]);
  const b = midpoint(to[0], to[1]);
  const ratio = scale / start.scale;
  return clamp({ scale, x: b.x - (a.x - start.x) * ratio, y: b.y - (a.y - start.y) * ratio }, box);
}

/** A one-finger drag of a zoomed image. */
export function pan(start: View, dx: number, dy: number, box: Box): View {
  return clamp({ ...start, x: start.x + dx, y: start.y + dy }, box);
}

/** Double-tap: in to the step at the tapped spot, or back out to fit. */
export function toggleAt(view: View, focal: Point, box: Box): View {
  return isZoomed(view) ? IDENTITY : zoomAbout(view, STEP_SCALE, focal, box);
}

/** Snap a pinch that ends barely zoomed back to fit. */
export function settle(view: View): View {
  return view.scale < 1.05 ? IDENTITY : view;
}
