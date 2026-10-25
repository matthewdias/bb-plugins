import { test } from "node:test";
import assert from "node:assert/strict";
import { rowShift } from "../lib/desktop.ts";

const ROW = { top: 0, bottom: 48 };

test("rowShift: nothing to meet without controls in the row", () => {
  assert.equal(rowShift([], ROW), null);
});

test("rowShift: how far the controls' middle sits below the row's", () => {
  // bb's macOS title bar: the traffic lights' centre, not the row's.
  assert.equal(rowShift([27, 27, 27], ROW), 3);
  assert.equal(rowShift([24], ROW), 0);
  assert.equal(rowShift([20], ROW), -4);
});

test("rowShift: measured from the row below the strip's top padding", () => {
  assert.equal(rowShift([44], { top: 20, bottom: 68 }), 0);
});

test("rowShift: the median control, so one stray control does not pull the row", () => {
  assert.equal(rowShift([27, 27, 40], ROW), 3);
});

test("rowShift: to the half pixel", () => {
  assert.equal(rowShift([26.3], ROW), 2.5);
});
