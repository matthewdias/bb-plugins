import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeMark, tabName } from "../lib/badge.ts";

test("badgeMark: a count, capped at 99+ as bb's lists draw it", () => {
  assert.deepEqual(badgeMark({ count: 3 }), { kind: "count", text: "3" });
  assert.deepEqual(badgeMark({ count: 99 }), { kind: "count", text: "99" });
  assert.deepEqual(badgeMark({ count: 100 }), { kind: "count", text: "99+" });
});

test("badgeMark: a count that is not a positive integer is no count", () => {
  assert.deepEqual(badgeMark({ count: 0 }), { kind: "dot" });
  assert.deepEqual(badgeMark({ count: -2, text: "NEW" }), { kind: "text", text: "NEW" });
  assert.deepEqual(badgeMark({ count: 1.5 }), { kind: "dot" });
});

test("badgeMark: text as given, within bb's eight characters", () => {
  assert.deepEqual(badgeMark({ text: "73%" }), { kind: "text", text: "73%" });
  assert.deepEqual(badgeMark({ text: " 3/5 " }), { kind: "text", text: "3/5" });
  assert.deepEqual(badgeMark({ text: "123456789" }), { kind: "text", text: "12345678" });
});

test("badgeMark: a count wins over text", () => {
  assert.deepEqual(badgeMark({ count: 2, text: "NEW" }), { kind: "count", text: "2" });
});

test("badgeMark: neither is a dot", () => {
  assert.deepEqual(badgeMark({}), { kind: "dot" });
  assert.deepEqual(badgeMark({ text: "  " }), { kind: "dot" });
});

test("tabName: the badge's label joins the tab's name", () => {
  assert.equal(tabName("GitHub", { label: "3 open reviews" }), "GitHub, 3 open reviews");
  assert.equal(tabName("GitHub", null), "GitHub");
  assert.equal(tabName("GitHub", { label: " " }), "GitHub");
});
