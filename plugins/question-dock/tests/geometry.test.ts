import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DOCK_MIN_PANE,
  FLOAT_MIN_ROOM,
  INSET,
  chooseMode,
  dockPlacement,
  dockWidth,
  floatBounds,
  floatMaxHeight,
  floatPositionOf,
  placeFloat,
  resizeFloat,
  resizeZone,
  fromFraction,
  inDockZone,
  sheetHeight,
  snapSheet,
  toFraction,
  type ModeInput,
} from "../lib/geometry.ts";

const wide: ModeInput = { compact: false, expanded: true, paneWidth: 1200, desktopMode: "dock", mobileSheet: true };

test("a wide pane docks an open card", () => {
  assert.equal(chooseMode(wide), "dock");
});

test("a pane too narrow to dock floats instead", () => {
  assert.equal(chooseMode({ ...wide, paneWidth: DOCK_MIN_PANE - 1 }), "float");
  assert.equal(chooseMode({ ...wide, paneWidth: DOCK_MIN_PANE }), "dock");
});

test("a collapsed card goes back to bb's bar, docked or floating", () => {
  assert.equal(chooseMode({ ...wide, expanded: false }), null);
  assert.equal(chooseMode({ ...wide, expanded: false, desktopMode: "float" }), null);
  assert.equal(chooseMode({ ...wide, expanded: false, paneWidth: 800 }), null);
});

test("float and inline are honoured on a wide pane", () => {
  assert.equal(chooseMode({ ...wide, desktopMode: "float" }), "float");
  assert.equal(chooseMode({ ...wide, desktopMode: "inline" }), null);
});

test("a phone gets the sheet while the card is open, and bb's bar while it is not", () => {
  const phone = { ...wide, compact: true, paneWidth: 390 };
  assert.equal(chooseMode(phone), "sheet");
  assert.equal(chooseMode({ ...phone, expanded: false }), null);
  assert.equal(chooseMode({ ...phone, mobileSheet: false }), null);
  // The desktop setting does not reach a phone.
  assert.equal(chooseMode({ ...phone, desktopMode: "inline" }), "sheet");
});

test("the dock hugs the pane's right edge, bottom-anchored", () => {
  const dock = dockPlacement({ left: 300, top: 50, width: 1000, height: 800 }, 420);
  assert.equal(dock.left, 300 + 1000 - 420 - INSET);
  assert.equal(dock.width, 420);
  assert.equal(dock.bottom, 850 - INSET);
  assert.equal(dock.maxHeight, 800 - 2 * INSET);
});

test("a float stays above the composer when there is room for it", () => {
  const pane = { left: 0, top: 0, width: 800, height: 600 };
  assert.equal(floatBounds(pane, 450).height, 450 - 2 * INSET);
  // Too little room above the composer: the float may cover it.
  assert.equal(floatBounds(pane, FLOAT_MIN_ROOM - 1).height, 600 - 2 * INSET);
  assert.equal(floatBounds(pane, null).height, 600 - 2 * INSET);
});

test("fractions round-trip and clamp inside the bounds", () => {
  const bounds = { left: 10, top: 20, width: 500, height: 400 };
  const size = { width: 100, height: 100 };
  const point = fromFraction(bounds, size, { x: 0.25, y: 0.5 });
  assert.deepEqual(point, { left: 110, top: 170 });
  assert.deepEqual(toFraction(bounds, size, point), { x: 0.25, y: 0.5 });
  assert.deepEqual(toFraction(bounds, size, { left: -999, top: 9999 }), { x: 0, y: 1 });
  assert.deepEqual(fromFraction(bounds, size, { x: 7, y: -3 }), { left: 410, top: 20 });
});

test("a card as big as its bounds pins to the far corner", () => {
  const bounds = { left: 0, top: 0, width: 100, height: 100 };
  assert.deepEqual(toFraction(bounds, { width: 100, height: 200 }, { left: 0, top: 0 }), { x: 1, y: 1 });
});

test("the dock zone is the right edge of a pane wide enough to dock", () => {
  const pane = { left: 0, top: 0, width: 1200, height: 800 };
  assert.equal(inDockZone(pane, 1190), true);
  assert.equal(inDockZone(pane, 1000), false);
  assert.equal(inDockZone({ ...pane, width: 800 }, 790), false);
});

test("a released sheet snaps to the nearer height, or collapses when short", () => {
  assert.equal(snapSheet(100, 800), "collapse");
  assert.equal(snapSheet(420, 800), "half");
  assert.equal(snapSheet(700, 800), "full");
  assert.equal(snapSheet(0, 0), "collapse");
});

test("a float is never taller than most of the pane", () => {
  const pane = { left: 0, top: 0, width: 800, height: 1000 };
  assert.equal(floatMaxHeight(pane, floatBounds(pane, 900)), 700);
  // Short of room above the composer, the room wins.
  assert.equal(floatMaxHeight(pane, floatBounds(pane, 400)), 400 - 2 * INSET);
});

test("a float dropped low keeps its bottom edge when it shrinks", () => {
  const bounds = { left: 0, top: 0, width: 1000, height: 600 };
  const position = floatPositionOf(bounds, { left: 200, top: 300, width: 380, height: 250 });
  assert.equal(position.anchor, "bottom");
  // Full height, it comes back exactly where it was dropped.
  assert.deepEqual(placeFloat(bounds, { width: 380, height: 250 }, position), { left: 200, edge: 550 });
  // Collapsed to bb's bar, its bottom edge stays put.
  assert.deepEqual(placeFloat(bounds, { width: 380, height: 38 }, position), { left: 200, edge: 550 });
});

test("a float dropped high keeps its top edge when it shrinks", () => {
  const bounds = { left: 0, top: 100, width: 1000, height: 600 };
  const position = floatPositionOf(bounds, { left: 0, top: 150, width: 380, height: 200 });
  assert.equal(position.anchor, "top");
  assert.deepEqual(placeFloat(bounds, { width: 380, height: 38 }, position), { left: 0, edge: 150 });
});

test("a float that grows is pushed back inside the room", () => {
  const bounds = { left: 0, top: 0, width: 1000, height: 600 };
  // Anchored by its top near the bottom, then a taller question arrives.
  assert.equal(placeFloat(bounds, { width: 380, height: 500 }, { x: 0, y: 0.5, anchor: "top" }).edge, 100);
  // Anchored by its bottom near the top: the bottom moves down to fit it.
  assert.equal(placeFloat(bounds, { width: 380, height: 500 }, { x: 0, y: 0.9, anchor: "bottom" }).edge, 500);
});

test("a sheet fits under the top of the pane, and takes all of it while typing", () => {
  assert.equal(sheetHeight(796, "half", false), 398);
  assert.equal(sheetHeight(796, "full", false), 788);
  // The keyboard is up and bb has shrunk the pane to what is visible.
  assert.equal(sheetHeight(300, "half", true), 292);
  assert.equal(sheetHeight(4, "full", false), 0);
});

test("the dock grows with the pane, within bounds, and leaves the chat room", () => {
  // A share of the pane, never narrower than 440 by default or wider than 640.
  assert.equal(dockWidth(1000, null), 450);
  assert.equal(dockWidth(1300, null), 585);
  assert.equal(dockWidth(2400, null), 640);
  // A dragged width is honoured, up to what leaves the chat its minimum.
  assert.equal(dockWidth(2400, 700), 700);
  assert.equal(dockWidth(1200, 700), 1200 - 520 - 2 * INSET);
  assert.equal(dockWidth(1200, 100), 360);
  // At the narrowest pane that docks, the chat keeps its minimum.
  assert.ok(DOCK_MIN_PANE - dockWidth(DOCK_MIN_PANE, null) - 2 * INSET >= 520);
});

test("a dock resizes from its left edge only", () => {
  const rect = { left: 100, top: 100, width: 400, height: 500 };
  assert.equal(resizeZone(rect, 103, 300, "dock"), "w");
  assert.equal(resizeZone(rect, 120, 300, "dock"), null);
  assert.equal(resizeZone(rect, 495, 595, "dock"), null);
});

test("a float resizes from its left and bottom edges and bottom corners, not its header or scrollbar", () => {
  const rect = { left: 100, top: 100, width: 400, height: 500 };
  assert.equal(resizeZone(rect, 103, 300, "float"), "w");
  assert.equal(resizeZone(rect, 300, 597, "float"), "s");
  assert.equal(resizeZone(rect, 490, 590, "float"), "se");
  assert.equal(resizeZone(rect, 108, 590, "float"), "sw");
  // The right edge, where the card's scrollbar is, and the middle.
  assert.equal(resizeZone(rect, 497, 300, "float"), null);
  assert.equal(resizeZone(rect, 300, 300, "float"), null);
  // Outside the card.
  assert.equal(resizeZone(rect, 90, 300, "float"), null);
});

test("resizing a float keeps the opposite edges, its minimum size and the room", () => {
  const bounds = { left: 0, top: 0, width: 1000, height: 700 };
  const start = { left: 400, top: 100, width: 380, height: 300 };
  // The corner grows right and down.
  assert.deepEqual(resizeFloat(start, "se", 100, 50, bounds), { left: 400, top: 100, width: 480, height: 350 });
  // The left edge moves, the right edge stays.
  assert.deepEqual(resizeFloat(start, "w", -100, 0, bounds), { left: 300, top: 100, width: 480, height: 300 });
  // Never smaller than the minimum, never out of the room.
  assert.deepEqual(resizeFloat(start, "sw", 500, -500, bounds), { left: 480, top: 100, width: 300, height: 120 });
  assert.deepEqual(resizeFloat(start, "se", 900, 900, bounds), { left: 400, top: 100, width: 600, height: 600 });
  // A card already below the room's floor keeps its minimum rather than inverting.
  const low = { left: 400, top: 650, width: 380, height: 300 };
  assert.equal(resizeFloat(low, "s", 0, 10, bounds).height, 120);
});
