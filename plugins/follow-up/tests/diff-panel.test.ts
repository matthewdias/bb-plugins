import assert from "node:assert/strict";
import { test } from "node:test";
import { panelOnDiff, panelStateKey } from "../lib/diff-panel.ts";

// Where a thread's panel is pointed, as bb stores it. The entries below are
// what bb 0.45 writes, copied from a browser.

const INFO = { id: "thread-info:thread-info:none", kind: "thread-info" };
const DIFF = { id: "git-diff:git-diff:none", kind: "git-diff" };
const NOW = 1_791_729_300_553;

const entry = (secondary: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 1, secondary, lastUsedAt: 1_791_729_238_881, ...extra });

test("diff panel: the key is bb's, one a thread", () => {
  assert.equal(panelStateKey("thr_hfcneuqdwv"), "bb.thread.fixedPanelTabsState-thr_hfcneuqdwv-1");
  assert.equal(panelStateKey(" thr_a b "), "bb.thread.fixedPanelTabsState-thr_a%20b-1");
});

test("diff panel: a shut panel on Thread info becomes an open one on the diff", () => {
  const next = panelOnDiff(entry({ tabs: [INFO, DIFF], activeTabId: INFO.id, isOpen: false }), NOW);
  assert.deepEqual(JSON.parse(next as string), {
    version: 1,
    secondary: { tabs: [INFO, DIFF], activeTabId: DIFF.id, isOpen: true },
    lastUsedAt: NOW,
  });
});

test("diff panel: a thread this browser never opened gets bb's two tabs, open on the diff", () => {
  assert.deepEqual(JSON.parse(panelOnDiff(null, NOW) as string), {
    version: 1,
    secondary: { tabs: [INFO, DIFF], activeTabId: DIFF.id, isOpen: true },
    lastUsedAt: NOW,
  });
});

test("diff panel: the reader's other tabs, and anything else bb keeps there, stay as they were", () => {
  const terminal = { id: "terminal:term_1:none", kind: "terminal", terminalId: "term_1" };
  const next = JSON.parse(
    panelOnDiff(entry({ tabs: [INFO, DIFF, terminal], activeTabId: terminal.id, isOpen: true, width: 420 }, { later: "kept" }), NOW) as string,
  );
  assert.deepEqual(next.secondary.tabs, [INFO, DIFF, terminal]);
  assert.equal(next.secondary.width, 420);
  assert.equal(next.later, "kept");
  assert.equal(next.secondary.activeTabId, DIFF.id);
});

test("diff panel: an entry without the diff tab gains it, since bb drops an active tab it cannot find", () => {
  const next = JSON.parse(panelOnDiff(entry({ tabs: [INFO], activeTabId: INFO.id, isOpen: true }), NOW) as string);
  assert.deepEqual(next.secondary.tabs, [INFO, DIFF]);
  // And one that has it is not given a second.
  const again = JSON.parse(panelOnDiff(JSON.stringify(next), NOW) as string);
  assert.deepEqual(again.secondary.tabs, [INFO, DIFF]);
});

test("diff panel: an entry that does not read as bb 0.45's is left alone", () => {
  for (const stored of [
    "not json",
    "null",
    "[]",
    JSON.stringify({ version: 2, secondary: { tabs: [INFO, DIFF], activeTabId: INFO.id, isOpen: false }, lastUsedAt: 1 }),
    JSON.stringify({ secondary: { tabs: [INFO, DIFF], activeTabId: INFO.id, isOpen: false }, lastUsedAt: 1 }),
    JSON.stringify({ version: 1, lastUsedAt: 1 }),
    JSON.stringify({ version: 1, secondary: [], lastUsedAt: 1 }),
    JSON.stringify({ version: 1, secondary: { tabs: "all", activeTabId: null, isOpen: false }, lastUsedAt: 1 }),
  ]) {
    assert.equal(panelOnDiff(stored, NOW), null, stored);
  }
});
