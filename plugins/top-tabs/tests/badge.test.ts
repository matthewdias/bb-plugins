import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeMark, tabName } from "../lib/badge.ts";

test("badgeMark: with names showing, a count capped at 99+ as bb's lists draw it", () => {
  assert.deepEqual(badgeMark({ count: 3 }, "list"), { kind: "count", text: "3" });
  assert.deepEqual(badgeMark({ count: 99 }, "list"), { kind: "count", text: "99" });
  assert.deepEqual(badgeMark({ count: 100 }, "list"), { kind: "count", text: "99+" });
});

test("badgeMark: a count that is not a positive integer is no count", () => {
  assert.deepEqual(badgeMark({ count: 0 }, "list"), { kind: "dot" });
  assert.deepEqual(badgeMark({ count: -2, text: "NEW" }, "list"), { kind: "text", text: "NEW" });
  assert.deepEqual(badgeMark({ count: 1.5 }, "list"), { kind: "dot" });
});

test("badgeMark: text as given, within bb's eight characters", () => {
  assert.deepEqual(badgeMark({ text: "73%" }, "list"), { kind: "text", text: "73%" });
  assert.deepEqual(badgeMark({ text: " 3/5 " }, "list"), { kind: "text", text: "3/5" });
  assert.deepEqual(badgeMark({ text: "123456789" }, "list"), { kind: "text", text: "12345678" });
});

test("badgeMark: a count wins over text", () => {
  assert.deepEqual(badgeMark({ count: 2, text: "NEW" }, "list"), { kind: "count", text: "2" });
});

test("badgeMark: neither is a dot", () => {
  assert.deepEqual(badgeMark({}, "list"), { kind: "dot" });
  assert.deepEqual(badgeMark({ text: "  " }, "list"), { kind: "dot" });
});

test("badgeMark: on the narrow rail, a count caps at 9+ and text is a dot, as on bb's Rail", () => {
  assert.deepEqual(badgeMark({ count: 9 }, "rail"), { kind: "count", text: "9" });
  assert.deepEqual(badgeMark({ count: 10 }, "rail"), { kind: "count", text: "9+" });
  assert.deepEqual(badgeMark({ text: "NEW" }, "rail"), { kind: "dot" });
  assert.deepEqual(badgeMark({ count: 2, text: "NEW" }, "rail"), { kind: "count", text: "2" });
});

test("tabName: the badge's label joins the tab's name", () => {
  assert.equal(tabName("GitHub", { label: "3 open reviews" }), "GitHub, 3 open reviews");
  assert.equal(tabName("GitHub", null), "GitHub");
  assert.equal(tabName("GitHub", { label: " " }), "GitHub");
});
