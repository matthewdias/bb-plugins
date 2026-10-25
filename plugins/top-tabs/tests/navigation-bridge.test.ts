import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRACE_MS,
  HIDE_DELAY_MS,
  createNavigationBridge,
  parseSnapshot,
  type NavItem,
  type NavState,
} from "../lib/navigation-bridge.ts";

/** A bridge over an in-memory storage and timers that run when told to. */
function harness(stored: Record<string, string> = {}) {
  const storage = new Map(Object.entries(stored));
  const timers = new Map<number, { run: () => void; ms: number }>();
  let next = 1;
  const bridge = createNavigationBridge({
    storage: () => ({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => void storage.set(key, value),
      removeItem: (key) => void storage.delete(key),
    }),
    setTimer: (run, ms) => {
      const id = next++;
      timers.set(id, { run, ms });
      return id;
    },
    clearTimer: (id) => void timers.delete(id as number),
  });
  /** Run every pending timer of `ms`. */
  const elapse = (ms: number) => {
    for (const [id, timer] of [...timers]) {
      if (timer.ms !== ms) continue;
      timers.delete(id);
      timer.run();
    }
  };
  return { bridge, storage, timers, elapse };
}

function item(id: string): NavItem {
  return {
    id,
    label: id,
    icon: { kind: "plugin", pluginId: id, icon: null },
    action: { kind: "open-plugin-panel", pluginId: id, panelId: id },
    isVisible: true,
    isDisabled: false,
    isLoading: false,
    pluginId: id,
    shortcut: null,
    badge: null,
  };
}

function state(...ids: string[]): NavState {
  return {
    items: ids.map(item),
    activeItemId: null,
    isShortcutModifierHeld: false,
    actions: { activate() {}, openDetails() {} },
  };
}

const SNAPSHOT = JSON.stringify([{ ...item("gh"), badge: undefined }]);

test("the strip is not drawn until Top Tabs' navigation publishes", () => {
  const { bridge } = harness();
  bridge.restore("top-tabs");
  assert.equal(bridge.get(), null);
  const unmount = bridge.providerMounted();
  bridge.publish(state("gh"));
  assert.equal(bridge.get()?.live, true);
  assert.deepEqual(bridge.get()?.state.items.map((i) => i.id), ["gh"]);
  unmount();
});

test("a publish with no provider mounted is ignored", () => {
  const { bridge } = harness();
  bridge.restore("top-tabs");
  bridge.publish(state("gh"));
  assert.equal(bridge.get(), null);
});

test("another navigation chosen: the strip goes once the provider unmounts, and stays gone next load", () => {
  const { bridge, storage, elapse } = harness();
  bridge.restore("top-tabs");
  const unmount = bridge.providerMounted();
  bridge.publish(state("gh"));
  assert.equal(storage.get("top-tabs:nav-active:v1"), "1");
  unmount();
  // Not at once: bb may be swapping one mount for another.
  assert.notEqual(bridge.get(), null);
  elapse(HIDE_DELAY_MS);
  assert.equal(bridge.get(), null);
  assert.equal(storage.has("top-tabs:nav-active:v1"), false);

  const reload = harness(Object.fromEntries(storage));
  reload.bridge.restore("top-tabs");
  assert.equal(reload.bridge.get(), null);
});

test("an unmount followed by a mount within the delay keeps the strip", () => {
  const { bridge, elapse } = harness();
  bridge.restore("top-tabs");
  const unmount = bridge.providerMounted();
  bridge.publish(state("gh"));
  unmount();
  const again = bridge.providerMounted();
  elapse(HIDE_DELAY_MS);
  assert.notEqual(bridge.get(), null);
  again();
});

test("first paint: the last list, if Top Tabs was the navigation last time", () => {
  const { bridge } = harness({ "top-tabs:nav-active:v1": "1", "top-tabs:nav:v1": SNAPSHOT });
  bridge.restore("top-tabs");
  const restored = bridge.get();
  assert.equal(restored?.live, false);
  assert.deepEqual(restored?.state.items.map((i) => i.id), ["gh"]);
});

test("first paint: no list when Top Tabs was not the navigation last time", () => {
  const { bridge } = harness({ "top-tabs:nav:v1": SNAPSHOT });
  bridge.restore("top-tabs");
  assert.equal(bridge.get(), null);
});

test("first paint: the restored list goes if no provider mounts in time", () => {
  const { bridge, storage, elapse } = harness({ "top-tabs:nav-active:v1": "1", "top-tabs:nav:v1": SNAPSHOT });
  bridge.restore("top-tabs");
  elapse(GRACE_MS);
  assert.equal(bridge.get(), null);
  assert.equal(storage.has("top-tabs:nav-active:v1"), false);
});

test("first paint: a provider mounting in time keeps the strip and goes live", () => {
  const { bridge, elapse } = harness({ "top-tabs:nav-active:v1": "1", "top-tabs:nav:v1": SNAPSHOT });
  bridge.restore("top-tabs");
  bridge.providerMounted();
  elapse(GRACE_MS);
  assert.equal(bridge.get()?.live, false);
  bridge.publish(state("gh", "usage"));
  assert.equal(bridge.get()?.live, true);
  assert.deepEqual(bridge.get()?.state.items.map((i) => i.id), ["gh", "usage"]);
});

test("the provider mounting before the strip restores still records the flag", () => {
  const { bridge, storage } = harness();
  bridge.providerMounted();
  bridge.restore("top-tabs");
  assert.equal(storage.get("top-tabs:nav-active:v1"), "1");
});

test("splits: published with the state, and unchanged reports do not notify", () => {
  const { bridge } = harness();
  bridge.restore("top-tabs");
  bridge.providerMounted();
  bridge.publish(state("gh"));
  let notified = 0;
  bridge.subscribe(() => notified++);
  bridge.setSplit("gh", { isAvailable: true, paneIds: ["p2"] });
  assert.deepEqual(bridge.get()?.splits.get("gh"), { isAvailable: true, paneIds: ["p2"] });
  bridge.setSplit("gh", { isAvailable: true, paneIds: ["p2"] });
  assert.equal(notified, 1);
  bridge.setSplit("gh", null);
  assert.equal(bridge.get()?.splits.has("gh"), false);
  assert.equal(notified, 2);
});

test("parseSnapshot: keeps well-formed items and drops the rest", () => {
  const items = parseSnapshot([
    { ...item("gh") },
    { id: "bad", label: "Bad", icon: { kind: "host", name: "nope" }, action: { kind: "open-skills" } },
    { id: "skills", label: "Skills", icon: { kind: "host", name: "skills" }, action: { kind: "open-skills" } },
    "junk",
  ]);
  assert.deepEqual(items.map((i) => i.id), ["gh", "skills"]);
  assert.equal(items[0]!.badge, null);
});
