import assert from "node:assert/strict";
import { test } from "node:test";
import { findNavState, navKey, readNavState, type FiberLike } from "../lib/rail.ts";

const HOST_ROOT = 3;

function fiber(props: unknown, parent: FiberLike | null, tag = 0): FiberLike {
  return { return: parent, alternate: null, tag, stateNode: null, memoizedProps: props };
}

/** A root whose current tree is `root`, as React's FiberRoot points at it. */
function root(): FiberLike {
  const node = fiber(null, null, HOST_ROOT);
  node.stateNode = { current: node };
  return node;
}

function model(activeItemId: string | null, calls: string[] = []) {
  return {
    state: {
      items: [
        { id: "__bb__/new-thread", label: "New thread", icon: { kind: "host", name: "new-thread" }, action: { kind: "new-thread" }, isVisible: true },
        {
          id: "github/github",
          label: "GitHub",
          icon: { kind: "plugin", pluginId: "github", icon: "Github" },
          action: { kind: "open-plugin-panel", pluginId: "github", panelId: "github" },
          isVisible: false,
          pluginId: "github",
          shortcut: { label: "⌘1", ariaKeyShortcuts: "Meta+1" },
        },
      ],
      activeItemId,
      isShortcutModifierHeld: false,
      actions: {
        activate: (id: string, options: { openInSplit: boolean }) => calls.push(`activate ${id} ${options.openInSplit}`),
        openDetails: (id: string) => calls.push(`details ${id}`),
      },
    },
    arrangement: {},
    rowsById: new Map(),
    splitEnabled: true,
  };
}

test("readNavState: bb's navigation model, with its items normalised", () => {
  const state = readNavState(model("github/github"));
  assert.ok(state);
  assert.equal(state.activeItemId, "github/github");
  assert.deepEqual(
    state.items.map((item) => [item.id, item.action.kind, item.isVisible, item.pluginId, item.isDisabled]),
    [
      ["__bb__/new-thread", "new-thread", true, null, false],
      ["github/github", "open-plugin-panel", false, "github", false],
    ],
  );
  assert.deepEqual(state.items[1]!.action, { kind: "open-plugin-panel", pluginId: "github", panelId: "github" });
  assert.deepEqual(state.items[1]!.shortcut, { label: "⌘1", ariaKeyShortcuts: "Meta+1" });
});

test("readNavState: the actions reach bb's own", () => {
  const calls: string[] = [];
  const state = readNavState(model(null, calls))!;
  state.actions.activate("github/github", { openInSplit: true });
  state.actions.openDetails("github/github");
  assert.deepEqual(calls, ["activate github/github true", "details github/github"]);
});

test("readNavState: anything else is not the model", () => {
  assert.equal(readNavState(null), null);
  assert.equal(readNavState({ open: true, onOpenChange() {} }), null);
  assert.equal(readNavState({ state: { items: [], activeItemId: null } }), null);
  const noDetails = model(null);
  (noDetails.state.actions as Record<string, unknown>).openDetails = undefined;
  assert.equal(readNavState(noDetails), null);
  const badActive = model(null);
  (badActive.state as Record<string, unknown>).activeItemId = 7;
  assert.equal(readNavState(badActive), null);
});

test("readNavState: an item that does not fit is dropped, not trusted", () => {
  const value = model(null);
  (value.state.items as unknown[]).push(
    { id: "x/no-icon", label: "No icon", action: { kind: "open-plugin-panel", pluginId: "x", panelId: "y" } },
    { id: "x/half-panel", label: "Half", icon: { kind: "host", name: "x" }, action: { kind: "open-plugin-panel", pluginId: "x" } },
  );
  assert.deepEqual(readNavState(value)!.items.map((item) => item.id), ["__bb__/new-thread", "github/github"]);
});

test("findNavState: walks up from the rail to the provider", () => {
  const top = root();
  const provider = fiber({ value: model("__bb__/new-thread"), children: null }, top);
  const other = fiber({ value: { open: false } }, provider);
  const rail = fiber({ className: "rail" }, other);
  assert.equal(findNavState(rail)?.activeItemId, "__bb__/new-thread");
  assert.equal(findNavState(fiber({}, root())), null);
  assert.equal(findNavState(null), null);
});

test("findNavState: reads the current copy when the element holds the stale one", () => {
  // React swaps a fiber and its alternate on every commit. The rail's element
  // may point at the copy from an earlier render, whose ancestors no longer
  // lead to the root's current tree.
  const top = root();
  const currentProvider = fiber({ value: model("github/github") }, top);
  const currentRail = fiber({}, currentProvider);
  const staleRoot = fiber(null, null, HOST_ROOT);
  staleRoot.stateNode = top.stateNode;
  const staleProvider = fiber({ value: model("__bb__/new-thread") }, staleRoot);
  const staleRail = fiber({}, staleProvider);
  staleRail.alternate = currentRail;
  currentRail.alternate = staleRail;
  assert.equal(findNavState(staleRail)?.activeItemId, "github/github");
  assert.equal(findNavState(currentRail)?.activeItemId, "github/github");
});

test("navKey: changes with what the strip draws, not with new action closures", () => {
  const a = readNavState(model("github/github"))!;
  const b = readNavState(model("github/github"))!;
  assert.equal(navKey(a), navKey(b));
  assert.notEqual(navKey(a), navKey(readNavState(model(null))!));
  const hidden = model("github/github");
  hidden.state.items[0]!.isVisible = false;
  assert.notEqual(navKey(a), navKey(readNavState(hidden)!));
});
