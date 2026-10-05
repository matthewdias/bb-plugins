import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DOCK_MIN_PANE,
  DOCK_WIDTH,
  FLOAT_MIN_ROOM,
  INSET,
  chooseMode,
  dockPlacement,
  floatBounds,
  floatMaxHeight,
  fromFraction,
  inDockZone,
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

test("a collapsed card goes back to bb's bar unless it floats", () => {
  assert.equal(chooseMode({ ...wide, expanded: false }), null);
  assert.equal(chooseMode({ ...wide, expanded: false, desktopMode: "float" }), "float");
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
  const dock = dockPlacement({ left: 300, top: 50, width: 1000, height: 800 });
  assert.equal(dock.left, 300 + 1000 - DOCK_WIDTH - INSET);
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
  assert.equal(snapSheet(600, 800), "full");
  assert.equal(snapSheet(0, 0), "collapse");
});

test("a float is never taller than most of the pane", () => {
  const pane = { left: 0, top: 0, width: 800, height: 1000 };
  assert.equal(floatMaxHeight(pane, floatBounds(pane, 900)), 700);
  // Short of room above the composer, the room wins.
  assert.equal(floatMaxHeight(pane, floatBounds(pane, 400)), 400 - 2 * INSET);
});
