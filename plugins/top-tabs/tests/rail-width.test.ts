import { test } from "node:test";
import assert from "node:assert/strict";
import { SNAP_NARROW, SNAP_WIDE, WIDE_DEFAULT, WIDE_MAX, WIDE_MIN, clampWide, dragRail } from "../lib/rail-width.ts";

const NARROW = 48;

test("dragging a wide rail's edge follows the pointer, within bounds", () => {
  const start = { wide: true, width: 200 };
  assert.deepEqual(dragRail(start, NARROW, 40), { wide: true, width: 240 });
  assert.deepEqual(dragRail(start, NARROW, -40), { wide: true, width: 160 });
  assert.deepEqual(dragRail(start, NARROW, 400), { wide: true, width: WIDE_MAX });
  assert.deepEqual(dragRail(start, NARROW, -70), { wide: true, width: WIDE_MIN });
});

test("pushing a wide rail in far enough hides the names and keeps the width for next time", () => {
  const start = { wide: true, width: 220 };
  assert.deepEqual(dragRail(start, NARROW, SNAP_NARROW - 220 - 1), { wide: false, width: 220 });
  assert.equal(dragRail(start, NARROW, SNAP_NARROW - 220).wide, true);
});

test("pulling a narrow rail out shows the names at the width it reached", () => {
  const start = { wide: false, width: 260 };
  assert.deepEqual(dragRail(start, NARROW, 20), { wide: false, width: 260 });
  assert.deepEqual(dragRail(start, NARROW, SNAP_WIDE - NARROW), { wide: true, width: WIDE_MIN });
  assert.deepEqual(dragRail(start, NARROW, 180), { wide: true, width: 228 });
});

test("a stored width is kept within bounds", () => {
  assert.equal(clampWide(90), WIDE_MIN);
  assert.equal(clampWide(9999), WIDE_MAX);
  assert.equal(clampWide(Number.NaN), WIDE_DEFAULT);
  assert.equal(clampWide(233.6), 234);
});
