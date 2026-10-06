import { describe, expect, it } from "vitest";
import { IDENTITY, MAX_SCALE, STEP_SCALE, clamp, isZoomed, pan, pinch, settle, toggleAt, zoomAbout } from "../lib/zoom";

const box = { width: 400, height: 300 };

/** Where a point of the unscaled image (relative to its centre) lands on screen. */
const onScreen = (view: { scale: number; x: number; y: number }, p: { x: number; y: number }) => ({
  x: view.x + p.x * view.scale,
  y: view.y + p.y * view.scale,
});

describe("zoom", () => {
  it("keeps the point under the focus where it is", () => {
    const focal = { x: 100, y: -50 };
    const view = zoomAbout(IDENTITY, 2, focal, box);
    expect(view.scale).toBe(2);
    // The image point that was under the focus (100, -50 at fit) is still there.
    expect(onScreen(view, { x: 100, y: -50 })).toEqual(focal);
  });

  it("stays between fit and the maximum", () => {
    expect(zoomAbout(IDENTITY, 0.2, { x: 0, y: 0 }, box).scale).toBe(1);
    expect(zoomAbout(IDENTITY, 50, { x: 0, y: 0 }, box).scale).toBe(MAX_SCALE);
  });

  it("never pans so far that a gap opens at an edge", () => {
    expect(clamp({ scale: 2, x: 1000, y: -1000 }, box)).toEqual({ scale: 2, x: 200, y: -150 });
    expect(clamp({ scale: 1, x: 40, y: 40 }, box)).toEqual(IDENTITY);
  });

  it("pinches by how far the fingers spread, about the spot between them", () => {
    const view = pinch(IDENTITY, [{ x: -50, y: 0 }, { x: 50, y: 0 }], [{ x: -100, y: 0 }, { x: 100, y: 0 }], box);
    expect(view).toEqual({ scale: 2, x: 0, y: 0 });
    const offCentre = pinch(IDENTITY, [{ x: 50, y: 0 }, { x: 150, y: 0 }], [{ x: 0, y: 0 }, { x: 200, y: 0 }], box);
    // The image point at 100 (between the fingers) stays at 100 on screen.
    expect(onScreen(offCentre, { x: 100, y: 0 }).x).toBe(100);
  });

  it("pans with the fingers as they travel together", () => {
    const start = { scale: 2, x: 0, y: 0 };
    const view = pinch(start, [{ x: -50, y: 0 }, { x: 50, y: 0 }], [{ x: -20, y: 30 }, { x: 80, y: 30 }], box);
    expect(view).toEqual({ scale: 2, x: 30, y: 30 });
  });

  it("pans a zoomed image under one finger, within bounds", () => {
    expect(pan({ scale: 2, x: 0, y: 0 }, 50, -20, box)).toEqual({ scale: 2, x: 50, y: -20 });
    expect(pan({ scale: 2, x: 0, y: 0 }, 900, 0, box).x).toBe(200);
  });

  it("toggles between fit and the step on a double-tap", () => {
    const zoomed = toggleAt(IDENTITY, { x: 40, y: 20 }, box);
    expect(zoomed.scale).toBe(STEP_SCALE);
    expect(onScreen(zoomed, { x: 40, y: 20 })).toEqual({ x: 40, y: 20 });
    expect(toggleAt(zoomed, { x: 0, y: 0 }, box)).toEqual(IDENTITY);
  });

  it("snaps a barely zoomed pinch back to fit", () => {
    expect(settle({ scale: 1.03, x: 4, y: 2 })).toEqual(IDENTITY);
    expect(isZoomed(settle({ scale: 1.5, x: 4, y: 2 }))).toBe(true);
  });
});
