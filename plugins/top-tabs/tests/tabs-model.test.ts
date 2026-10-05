import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOSED_LIMIT,
  EMPTY_STATE,
  SETTINGS,
  THREADS,
  activeTabFor,
  ago,
  adopt,
  close,
  closeCommandAction,
  closeOrderOf,
  closeOthers,
  closeToRight,
  cycle,
  groupThreads,
  defaultPathFor,
  isAppPath,
  isDestinationAction,
  isPinned,
  leavesSettings,
  move,
  moveBefore,
  panesOf,
  panesOnScreen,
  pathFits,
  pin,
  parseState,
  recordPath,
  recordRecent,
  recordRecentThread,
  rememberSidebar,
  reopen,
  reopenable,
  resetPinned,
  seed,
  sidebarStep,
  splitPartner,
  pageCloseAction,
  successorAfterClose,
  successorAfterPinClose,
  threadGroup,
  threadIdFromPath,
  threadPaneFor,
  unpin,
  type RouteTarget,
  type SplitPane,
  type ThreadFacts,
  type TabsState,
} from "../lib/tabs-model.ts";

const state = (patch: Partial<TabsState>): TabsState => ({ ...EMPTY_STATE, ...patch });
const targets: RouteTarget[] = [
  { id: "gh/gh", kind: "open-plugin-panel", pluginId: "gh", panelId: "gh" },
  { id: "usage/usage", kind: "open-plugin-panel", pluginId: "usage", panelId: "usage" },
  { id: "usage/activity", kind: "open-plugin-panel", pluginId: "usage", panelId: "activity" },
  { id: "__bb__/extensions", kind: "open-extensions", pluginId: null, panelId: null },
  { id: "__bb__/skills", kind: "open-skills", pluginId: null, panelId: null },
];
const target = (id: string) => targets.find((t) => t.id === id)!;
const settingsTarget: RouteTarget = { id: SETTINGS, kind: "open-settings", pluginId: null, panelId: null };

test("bb's reported active item wins", () => {
  assert.equal(
    activeTabFor({ activeItemId: "gh/gh", pathname: "/plugins/gh/gh/pulls/4" }, targets),
    "gh/gh",
  );
});

test("a reported active item that the route does not fit is ignored", () => {
  // bb still reports the panel the user just left, one render behind the URL.
  assert.equal(
    activeTabFor({ activeItemId: "gh/gh", pathname: "/plugins" }, targets),
    "__bb__/extensions",
  );
  assert.equal(activeTabFor({ activeItemId: "gh/gh", pathname: "/projects/p" }, targets), THREADS);
});

test("an item kind this plugin does not know is trusted as reported", () => {
  const extra: RouteTarget = { id: "__bb__/new", kind: "open-new-thing", pluginId: null, panelId: null };
  assert.equal(
    activeTabFor({ activeItemId: "__bb__/new", pathname: "/new-thing" }, [...targets, extra]),
    "__bb__/new",
  );
});

test("threads, compose and project routes belong to Threads", () => {
  for (const pathname of ["/", "/projects/p/threads/t", "/projects/p"]) {
    assert.equal(activeTabFor({ activeItemId: null, pathname }, targets), THREADS);
  }
  // bb marks the compose screen with its New thread item, which is an action.
  assert.equal(activeTabFor({ activeItemId: "__bb__/new-thread", pathname: "/" }, targets), THREADS);
});

test("bb's own pages are recognised by route", () => {
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/plugins" }, targets), "__bb__/extensions");
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/skills" }, targets), "__bb__/skills");
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/skills/x" }, targets), "__bb__/skills");
});

test("a plugin's page in the marketplace belongs to the Plugins tab", () => {
  // bb routes `/plugins/<id>` to the plugin's page and `/plugins/<id>/<panel>`
  // to its panels; a marketplace listing adds only a query.
  for (const pathname of ["/plugins/some-plugin", "/plugins/some-plugin/"]) {
    assert.equal(activeTabFor({ activeItemId: null, pathname }, targets), "__bb__/extensions");
  }
  // bb may still report Plugins as the active item there.
  assert.equal(
    activeTabFor({ activeItemId: "__bb__/extensions", pathname: "/plugins/some-plugin" }, targets),
    "__bb__/extensions",
  );
  assert.equal(pathFits("__bb__/extensions", target("__bb__/extensions"), "/plugins/some-plugin"), true);
  assert.equal(pathFits("__bb__/extensions", target("__bb__/extensions"), "/plugins/gh/gh"), false);
});

test("an installed plugin's page is not its panel", () => {
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/plugins/gh" }, targets), "__bb__/extensions");
  // With Plugins hidden from the nav, the page belongs to no tab rather than
  // to the plugin's only panel.
  const withoutPlugins = targets.filter((t) => t.kind !== "open-extensions");
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/plugins/gh" }, withoutPlugins), null);
});

test("a panel route without an active item finds its panel", () => {
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/plugins/gh/gh/pulls/4" }, targets), "gh/gh");
  assert.equal(
    activeTabFor({ activeItemId: null, pathname: "/plugins/usage/activity" }, targets),
    "usage/activity",
  );
  // A one-panel plugin owns its routes whatever the segment says.
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/plugins/gh/board" }, targets), "gh/gh");
  // Two panels and no match: no guess.
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/plugins/usage/other" }, targets), null);
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/plugins/unknown/x" }, targets), null);
});

test("settings belongs to no tab unless the strip offers one", () => {
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/settings" }, targets), null);
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/settings/appearance" }, targets), null);
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/settingsish" }, targets), THREADS);
  const withSettings = [...targets, settingsTarget];
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/settings" }, withSettings), SETTINGS);
  assert.equal(
    activeTabFor({ activeItemId: null, pathname: "/settings/plugins/x" }, withSettings),
    SETTINGS,
  );
});

test("the Settings tab remembers which settings page it was on", () => {
  assert.equal(pathFits(SETTINGS, settingsTarget, "/settings/appearance"), true);
  assert.equal(pathFits(SETTINGS, settingsTarget, "/projects/p"), false);
  assert.equal(defaultPathFor(settingsTarget), "/settings");
});

test("adopting appends once and never adds Threads", () => {
  const once = adopt(state({ open: ["gh/gh"] }), "usage/usage");
  assert.deepEqual(once.open, ["gh/gh", "usage/usage"]);
  assert.equal(adopt(once, "usage/usage"), once);
  assert.equal(adopt(once, THREADS), once);
});

test("seeding fills the strip once", () => {
  const seeded = seed(EMPTY_STATE, ["gh/gh", "usage/usage"]);
  assert.deepEqual(seeded.open, ["gh/gh", "usage/usage"]);
  assert.equal(seeded.seeded, true);
  assert.equal(seed(close(seeded, ["gh/gh"]), ["gh/gh"]).open.includes("gh/gh"), false);
});

test("recording a path ignores anything that is not an in-app path", () => {
  const s = recordPath(EMPTY_STATE, "gh/gh", "/plugins/gh/gh/pulls/4");
  assert.equal(s.paths["gh/gh"], "/plugins/gh/gh/pulls/4");
  assert.equal(recordPath(s, "gh/gh", "//evil.example/x"), s);
  assert.equal(recordPath(s, "gh/gh", "https://evil.example/"), s);
  assert.equal(recordPath(s, "gh/gh", "/plugins/gh/gh/pulls/4"), s);
});

test("a location only fits the tab that owns it", () => {
  assert.equal(pathFits(THREADS, null, "/projects/p/threads/t"), true);
  assert.equal(pathFits(THREADS, null, "/plugins/gh/gh"), false);
  assert.equal(pathFits(THREADS, null, "/plugins"), false);
  assert.equal(pathFits(THREADS, null, "/settings"), false);
  assert.equal(pathFits("gh/gh", target("gh/gh"), "/plugins/gh/gh/pulls/4"), true);
  assert.equal(pathFits("gh/gh", target("gh/gh"), "/plugins/usage/usage"), false);
  assert.equal(pathFits("gh/gh", target("gh/gh"), "/plugins/ghost/x"), false);
  assert.equal(pathFits("__bb__/extensions", target("__bb__/extensions"), "/plugins"), true);
  assert.equal(pathFits("__bb__/extensions", target("__bb__/extensions"), "/projects/p"), false);
  assert.equal(pathFits("gone/gone", null, "/plugins/gone/gone"), false);
});

test("New thread and Search are actions, everything else is a destination", () => {
  assert.equal(isDestinationAction("new-thread"), false);
  assert.equal(isDestinationAction("search-threads"), false);
  assert.equal(isDestinationAction("open-plugin-panel"), true);
  assert.equal(isDestinationAction("open-extensions"), true);
  assert.equal(isDestinationAction("open-automations"), true);
});

test("the Threads tab knows which thread it will return to", () => {
  assert.equal(threadIdFromPath("/projects/p/threads/thr_ab12"), "thr_ab12");
  assert.equal(threadIdFromPath("/threads/thr_ab12?x=1"), "thr_ab12");
  assert.equal(threadIdFromPath("/projects/p"), null);
  assert.equal(threadIdFromPath("/"), null);
  assert.equal(threadIdFromPath(undefined), null);
});

test("a destination has a fallback path for when bb cannot open it", () => {
  assert.equal(defaultPathFor(target("gh/gh")), "/plugins/gh/gh");
  assert.equal(defaultPathFor(target("__bb__/extensions")), "/plugins");
  assert.equal(defaultPathFor(target("__bb__/skills")), "/skills");
  assert.equal(defaultPathFor({ id: "x", kind: "open-automations", pluginId: null, panelId: null }), null);
  assert.equal(
    defaultPathFor({ id: "x", kind: "open-plugin-panel", pluginId: "a/b", panelId: "c" }),
    "/plugins/a%2Fb/c",
  );
});

test("isAppPath rejects protocol-relative and backslash paths", () => {
  assert.equal(isAppPath("/a"), true);
  assert.equal(isAppPath("//a"), false);
  assert.equal(isAppPath("/\\a"), false);
  assert.equal(isAppPath("a"), false);
  assert.equal(isAppPath(1), false);
});

test("closing the tab in view moves right, then left, then to Threads", () => {
  const open = ["a", "b", "c"];
  assert.equal(successorAfterClose(open, "b", "b"), "c");
  assert.equal(successorAfterClose(open, "c", "c"), "b");
  assert.equal(successorAfterClose(["a"], "a", "a"), THREADS);
});

test("closing a background tab keeps the tab in view", () => {
  assert.equal(successorAfterClose(["a", "b"], "a", "b"), "b");
  assert.equal(successorAfterClose(["a", "b"], "a", THREADS), THREADS);
  assert.equal(successorAfterClose(["a", "b"], "a", "b", "recent", ["b", "a"]), "b");
});

test("in recent order, closing the tab in view goes back to the one before it", () => {
  const open = ["a", "b", "c"];
  assert.equal(successorAfterClose(open, "b", "b", "recent", ["b", "a", "c"]), "a");
  assert.equal(successorAfterClose(open, "b", "b", "recent", ["b", THREADS, "c"]), THREADS);
  // Tabs that have since closed, or whose plugin is not loaded, are passed over.
  assert.equal(successorAfterClose(open, "b", "b", "recent", ["b", "gone", "c"]), "c");
  // With nothing remembered still open, it falls back to the neighbour.
  assert.equal(successorAfterClose(open, "b", "b", "recent", ["b", "gone"]), "c");
  assert.equal(successorAfterClose(open, "c", "c", "recent", []), "b");
});

test("the recentAfterClose setting picks the close order", () => {
  assert.equal(closeOrderOf(true), "recent");
  assert.equal(closeOrderOf(false), "position");
  assert.equal(closeOrderOf(undefined), "position");
  assert.equal(closeOrderOf("yes"), "position");
});

test("leaving a pinned tab moves past the other pins", () => {
  const open = ["p", "q", "a", "b"];
  const pinned = ["p", "q"];
  assert.equal(successorAfterPinClose(open, pinned, "p"), "a");
  assert.equal(successorAfterPinClose(open, pinned, "q"), "a");
  assert.equal(successorAfterPinClose(["p", "q"], pinned, "p"), THREADS);
});

test("in recent order, leaving a pinned tab goes to the ordinary tab used last", () => {
  const open = ["p", "q", "a", "b"];
  const pinned = ["p", "q"];
  assert.equal(successorAfterPinClose(open, pinned, "p", "recent", ["p", "q", "b", "a"]), "b");
  assert.equal(successorAfterPinClose(open, pinned, "p", "recent", ["p", "q", THREADS, "a"]), THREADS);
  assert.equal(successorAfterPinClose(open, pinned, "p", "recent", ["p", "q", "gone"]), "a");
});

test("resetting a pinned tab forgets its location and keeps it pinned", () => {
  const s = state({ open: ["p", "a"], pinned: ["p"], paths: { p: "/plugins/p/p/deep", a: "/x" } });
  const reset = resetPinned(s, "p");
  assert.deepEqual(reset.open, ["p", "a"]);
  assert.deepEqual(reset.pinned, ["p"]);
  assert.deepEqual(reset.paths, { a: "/x" });
  assert.deepEqual(reset.closed, [{ id: "p", path: "/plugins/p/p/deep", index: 0, reset: true }]);
  // Only pinned tabs reset, and a pin already at its start is left alone.
  assert.equal(resetPinned(s, "a"), s);
  assert.equal(resetPinned(reset, "p"), reset);
});

test("reopening after a reset gives the pin back its location", () => {
  const s = state({
    open: ["p", "a"],
    pinned: ["p"],
    paths: { p: "/plugins/p/p/deep" },
    closed: [{ id: "b", path: null, index: 2 }],
  });
  const { state: back, tab } = reopen(resetPinned(s, "p"), () => true);
  assert.equal(tab?.id, "p");
  assert.equal(back.paths.p, "/plugins/p/p/deep");
  assert.deepEqual(back.open, ["p", "a"]);
  assert.deepEqual(back.pinned, ["p"]);
  // The tab closed before the reset is next.
  assert.deepEqual(back.closed, [{ id: "b", path: null, index: 2 }]);
  assert.equal(reopen(back, () => true).tab?.id, "b");
});

test("going back to a reset pin takes the reset, so reopening skips it", () => {
  const s = state({
    open: ["p", "a"],
    pinned: ["p"],
    paths: { p: "/plugins/p/p/deep" },
    closed: [{ id: "b", path: null, index: 2 }],
  });
  const visited = recordPath(resetPinned(s, "p"), "p", "/plugins/p/p");
  assert.deepEqual(visited.closed, [{ id: "b", path: null, index: 2 }]);
  assert.equal(reopen(visited, () => true).tab?.id, "b");
  // Recording another tab's location leaves the reset to undo.
  const elsewhere = recordPath(resetPinned(s, "p"), "a", "/plugins/a/a");
  assert.equal(reopenable(elsewhere, () => true)?.id, "p");
});

test("a reset is undoable only while its tab is open", () => {
  const entry = { id: "p", path: "/plugins/p/p/deep", index: 0, reset: true as const };
  assert.equal(reopenable(state({ open: ["p"], pinned: ["p"], closed: [entry] }), () => true), entry);
  assert.equal(reopenable(state({ open: [], closed: [entry] }), () => true), undefined);
  assert.equal(reopenable(state({ open: ["p"], pinned: ["p"], closed: [entry] }), () => false), undefined);
  // A closed tab opened again another way is still passed over.
  assert.equal(reopenable(state({ open: ["a"], closed: [{ id: "a", path: null, index: 0 }] }), () => true), undefined);
});

test("a reset survives a reload", () => {
  const entry = { id: "p", path: "/plugins/p/p/deep", index: 0, reset: true };
  const parsed = parseState({ open: ["p"], pinned: ["p"], closed: [entry, { id: "b", path: null, index: 1, reset: "yes" }] });
  assert.deepEqual(parsed.closed, [entry, { id: "b", path: null, index: 1 }]);
});

test("bb's Close on a lone page closes the tab in view", () => {
  assert.equal(pageCloseAction("gh/gh", []), "tab");
  assert.equal(pageCloseAction(SETTINGS, []), "tab");
});

test("bb's Close on a pinned tab resets it, as the close-tab command does", () => {
  assert.equal(pageCloseAction("gh/gh", ["gh/gh"]), "pin");
  assert.equal(pageCloseAction(SETTINGS, [SETTINGS]), "pin");
  assert.equal(pageCloseAction("gh/gh", ["gh/gh"]), closeCommandAction("gh/gh", ["gh/gh"], true));
});

test("bb keeps its own Close on Threads and pages no tab holds", () => {
  // bb opens New Thread, which is where Threads should go anyway.
  assert.equal(pageCloseAction(THREADS, []), null);
  assert.equal(pageCloseAction(null, []), null);
});

test("the close-tab command closes a destination tab", () => {
  assert.equal(closeCommandAction("gh/gh", [], false), "tab");
  assert.equal(closeCommandAction("gh/gh", [], true), "tab");
});

test("on a pinned tab, the close-tab command resets it instead", () => {
  assert.equal(closeCommandAction("gh/gh", ["gh/gh"], true), "pin");
  assert.equal(closeCommandAction("gh/gh", ["gh/gh"], false), "pin");
  assert.equal(closeCommandAction(SETTINGS, [SETTINGS], false), "pin");
});

test("on Threads, the close-tab command closes the thread page instead", () => {
  // Threads cannot close, so the command presses bb's Close, which opens
  // New Thread. With no Close to press (a split, or the compose screen
  // itself) there is nothing to do.
  assert.equal(closeCommandAction(THREADS, [], true), "page");
  assert.equal(closeCommandAction(THREADS, [], false), null);
  assert.equal(closeCommandAction(null, [], true), null);
});

test("closing forgets the location and remembers it for reopening", () => {
  const s = close(state({ open: ["a", "b"], paths: { a: "/plugins/a/a/x" } }), ["a"]);
  assert.deepEqual(s.open, ["b"]);
  assert.equal(s.paths.a, undefined);
  assert.deepEqual(s.closed[0], { id: "a", path: "/plugins/a/a/x", index: 0 });
});

test("reopening restores position and location", () => {
  const closed = close(state({ open: ["a", "b", "c"], paths: { b: "/plugins/b/b/deep" } }), ["b"]);
  const { state: s, tab } = reopen(closed, () => true);
  assert.equal(tab?.id, "b");
  assert.deepEqual(s.open, ["a", "b", "c"]);
  assert.equal(s.paths.b, "/plugins/b/b/deep");
  assert.equal(s.closed.length, 0);
});

test("reopening skips destinations that are gone", () => {
  const closed = close(state({ open: ["a", "b"] }), ["a", "b"]);
  const { tab } = reopen(closed, (id) => id === "a");
  assert.equal(tab?.id, "a");
  assert.equal(reopen(closed, () => false).tab, null);
});

test("a closed batch reopens left to right", () => {
  let s = closeOthers(state({ open: ["a", "b", "c", "d"] }), "c");
  assert.deepEqual(s.open, ["c"]);
  s = reopen(s, () => true).state;
  assert.deepEqual(s.open, ["a", "c"]);
  s = reopen(s, () => true).state;
  assert.deepEqual(s.open, ["a", "b", "c"]);
  s = reopen(s, () => true).state;
  assert.deepEqual(s.open, ["a", "b", "c", "d"]);
});

test("a batch reopens left to right whatever order it was closed in", () => {
  let s = close(state({ open: ["a", "b", "c"] }), ["c", "a"]);
  assert.deepEqual(s.open, ["b"]);
  s = reopen(s, () => true).state;
  assert.deepEqual(s.open, ["a", "b"]);
});

test("closed history is capped and deduplicated", () => {
  let s = state({ open: Array.from({ length: CLOSED_LIMIT + 3 }, (_, i) => `t${i}`) });
  for (const id of [...s.open]) s = close(s, [id]);
  assert.equal(s.closed.length, CLOSED_LIMIT);
  s = adopt(s, "t12");
  s = close(s, ["t12"]);
  assert.equal(s.closed.filter((c) => c.id === "t12").length, 1);
});

test("close to the right of Threads closes everything", () => {
  assert.deepEqual(closeToRight(state({ open: ["a", "b"] }), THREADS).open, []);
  assert.deepEqual(closeToRight(state({ open: ["a", "b", "c"] }), "a").open, ["a"]);
  const s = state({ open: ["a"] });
  assert.equal(closeToRight(s, "missing"), s);
});

test("move clamps and keeps every tab", () => {
  const s = state({ open: ["a", "b", "c"] });
  assert.deepEqual(move(s, "a", 2).open, ["b", "c", "a"]);
  assert.deepEqual(move(s, "c", -5).open, ["c", "a", "b"]);
  assert.equal(move(s, "b", 1), s);
});

test("cycle wraps in both directions", () => {
  const order = [THREADS, "a", "b"];
  assert.equal(cycle(order, "b", 1), THREADS);
  assert.equal(cycle(order, THREADS, -1), "b");
  assert.equal(cycle(order, null, 1), THREADS);
  assert.equal(cycle(order, null, -1), "b");
});

const step = (
  previous: string | null | undefined,
  next: string | null,
  sidebarOpen: boolean,
  sidebar: Record<string, boolean> = {},
) => sidebarStep({ previous, next, sidebarOpen, sidebar });

test("leaving a tab remembers whether the sidebar was open there", () => {
  assert.deepEqual(step(THREADS, "a", true).sidebar, { [THREADS]: true });
  assert.deepEqual(step(THREADS, "a", false, { [THREADS]: true }).sidebar, { [THREADS]: false });
  assert.deepEqual(step("a", "b", true).sidebar, { a: true });
});

test("arriving on a tab restores the sidebar it had there", () => {
  assert.equal(step("a", THREADS, false, { [THREADS]: true }).action, "expand");
  assert.equal(step("a", THREADS, true, { [THREADS]: false }).action, "collapse");
  assert.equal(step(THREADS, "a", false, { a: true }).action, "expand");
  assert.equal(step(THREADS, "a", true, { a: false }).action, "collapse");
  assert.equal(step("a", THREADS, true, { [THREADS]: true }).action, null);
});

test("each tab keeps its own sidebar", () => {
  // Opened by hand on a, then off to b, which keeps its own collapsed.
  const memory = { [THREADS]: true, b: false };
  const toB = step("a", "b", true, memory);
  assert.deepEqual(toB, { action: "collapse", sidebar: { [THREADS]: true, a: true, b: false } });
  // And back on a, it opens again.
  assert.equal(step("b", "a", false, toB.sidebar).action, "expand");
});

test("a tab the strip has not seen collapses the sidebar", () => {
  assert.equal(step(THREADS, "a", true).action, "collapse");
  assert.equal(step(undefined, "a", true).action, "collapse");
  assert.equal(step("b", "a", false).action, null);
});

test("loading the app on a tab restores its sidebar, recording nothing", () => {
  // Reloaded on a thread after a tab had collapsed the sidebar.
  assert.deepEqual(step(undefined, THREADS, false, { [THREADS]: true }), {
    action: "expand",
    sidebar: { [THREADS]: true },
  });
  assert.equal(step(undefined, THREADS, false, { [THREADS]: false }).action, null);
  assert.equal(step(undefined, "a", false, { a: true }).action, "expand");
  assert.deepEqual(step(null, "a", true, {}).sidebar, {});
});

test("the first sight of Threads learns the preference instead of imposing one", () => {
  assert.deepEqual(step(undefined, THREADS, false), { action: null, sidebar: { [THREADS]: false } });
  assert.deepEqual(step("a", THREADS, true), { action: null, sidebar: { a: true, [THREADS]: true } });
});

test("a route no tab holds, or the same tab, leaves the sidebar alone", () => {
  const memory = { [THREADS]: false };
  assert.deepEqual(step(THREADS, null, true, memory), { action: null, sidebar: memory });
  assert.deepEqual(step("a", "a", true, { a: false }), { action: null, sidebar: { a: false } });
});

test("rememberSidebar keeps the same object when nothing changes", () => {
  const memory = { a: true };
  assert.equal(rememberSidebar(memory, "a", true), memory);
  assert.deepEqual(rememberSidebar(memory, "a", false), { a: false });
  assert.deepEqual(rememberSidebar(memory, "b", false), { a: true, b: false });
});

test("parseState keeps the well-formed parts of hostile input", () => {
  assert.deepEqual(parseState(null), EMPTY_STATE);
  assert.deepEqual(parseState("x"), EMPTY_STATE);
  const parsed = parseState({
    open: ["a", "a", THREADS, 4, "", "b"],
    paths: { a: "/plugins/a/a", b: "//evil", c: 3 },
    closed: [{ id: "c", path: "https://x", index: -1 }, { id: THREADS }, "junk"],
    sidebar: { a: true, b: "yes", [""]: false },
    threadsSidebarOpen: false,
    seeded: true,
    recent: ["a", "a", 3, "b"],
  });
  assert.deepEqual(parsed, {
    open: ["a", "b"],
    pinned: [],
    paths: { a: "/plugins/a/a" },
    closed: [{ id: "c", path: null, index: 0 }],
    sidebar: { a: true, [THREADS]: false },
    seeded: true,
    recent: ["a", "b"],
    recentThreads: [],
  });
});

const half = (x: number) => ({ x, y: 0, width: 0.5, height: 1 });
const pane = (paneId: string, x: number, threadId: string | null, isFocused = false): SplitPane => ({
  paneId,
  rect: half(x),
  threadId,
  isFocused,
});

test("no split, no panes", () => {
  assert.equal(panesOnScreen(null, new Map(), THREADS), null);
  assert.equal(panesOnScreen([pane("p1", 0, "t1", true)], new Map(), THREADS), null);
});

test("each pane belongs to the tab it shows", () => {
  const screen = panesOnScreen(
    [pane("p1", 0, "t1"), pane("p2", 0.5, null, true), pane("p3", 0.5, null)],
    new Map([["gh/gh", ["p2"]]]),
    "gh/gh",
  );
  assert.deepEqual(
    screen?.map((p) => p.tab),
    [THREADS, "gh/gh", null],
  );
  assert.deepEqual(panesOf(screen, "gh/gh").map((p) => p.paneId), ["p2"]);
  assert.deepEqual(panesOf(null, THREADS), []);
});

test("Threads focuses the thread it last showed, else the first thread pane", () => {
  const screen = panesOnScreen([pane("p1", 0, "t1"), pane("p2", 0.5, "t2", true)], new Map(), THREADS);
  assert.equal(threadPaneFor(screen, "t2")?.paneId, "p2");
  assert.equal(threadPaneFor(screen, "t9")?.paneId, "p1");
  assert.equal(threadPaneFor(screen, null)?.paneId, "p1");
  const noThreads = panesOnScreen([pane("p1", 0, null), pane("p2", 0.5, null)], new Map(), "gh/gh");
  assert.equal(threadPaneFor(noThreads, "t1"), null);
});

test("a split bb is holding while another page has the view is not on screen", () => {
  const layout = [pane("p1", 0, "t1", true), pane("p2", 0.5, null)];
  const destinations = new Map([["gh/gh", ["p2"]]]);
  assert.notEqual(panesOnScreen(layout, destinations, THREADS), null);
  // bb's Plugins page took the whole view; the split waits in memory, and
  // the page has taken over the focused pane's slot.
  assert.equal(panesOnScreen(layout, destinations, "__bb__/extensions"), null);
  const taken = [pane("p1", 0, "t1"), pane("p2", 0.5, null, true)];
  assert.equal(panesOnScreen(taken, new Map(), "__bb__/extensions"), null);
  assert.equal(panesOnScreen(layout, destinations, null), null);
});

test("a split stays on screen while bb's focus catches up with the route", () => {
  // The route already shows gh/gh; bb still calls the thread pane focused.
  const layout = [pane("p1", 0, "t1", true), pane("p2", 0.5, null)];
  assert.notEqual(panesOnScreen(layout, new Map([["gh/gh", ["p2"]]]), "gh/gh"), null);
});

test("recent tabs move to the front and are capped", () => {
  let s = EMPTY_STATE;
  for (const id of ["a", "b", "a", THREADS]) s = recordRecent(s, id);
  assert.deepEqual(s.recent, [THREADS, "a", "b"]);
  assert.equal(recordRecent(s, THREADS), s);
  for (let i = 0; i < 20; i++) s = recordRecent(s, `t${i}`);
  assert.equal(s.recent.length, 10);
});

test("splitting the tab in view pairs it with the tab before it", () => {
  const can = () => true;
  assert.equal(splitPartner("gh/gh", ["gh/gh", "usage/usage", THREADS], [THREADS], can), "usage/usage");
  // Nothing usable in the history: the fallbacks, in order.
  assert.equal(splitPartner("gh/gh", ["gh/gh"], [THREADS], can), THREADS);
  assert.equal(splitPartner(THREADS, [THREADS], ["gh/gh", "usage/usage"], can), "gh/gh");
});

test("a partner that cannot sit in a pane is skipped", () => {
  const can = (id: string) => id !== "__bb__/extensions";
  assert.equal(splitPartner("gh/gh", ["__bb__/extensions", THREADS], [], can), THREADS);
  assert.equal(splitPartner("gh/gh", ["__bb__/extensions"], [], can), null);
});

test("pinning moves a tab to the end of the pinned group", () => {
  let s = state({ open: ["a", "b", "c"] });
  s = pin(s, "c");
  assert.deepEqual(s.open, ["c", "a", "b"]);
  s = pin(s, "b");
  assert.deepEqual(s.open, ["c", "b", "a"]);
  assert.deepEqual(s.pinned, ["c", "b"]);
  assert.equal(isPinned(s, "b"), true);
  // Pinning a destination that is not open opens it.
  assert.deepEqual(pin(state({ open: [] }), "x").open, ["x"]);
  assert.equal(pin(s, THREADS), s);
});

test("unpinning puts a tab first among the ordinary tabs", () => {
  let s = pin(pin(state({ open: ["a", "b", "c"] }), "a"), "b");
  s = unpin(s, "a");
  assert.deepEqual(s.open, ["b", "a", "c"]);
  assert.deepEqual(s.pinned, ["b"]);
  assert.equal(unpin(s, "c"), s);
});

test("pinned tabs survive every close", () => {
  const s = pin(state({ open: ["a", "b", "c"] }), "a");
  assert.deepEqual(close(s, ["a"]).open, ["a", "b", "c"]);
  assert.deepEqual(closeOthers(s, "c").open, ["a", "c"]);
  assert.deepEqual(closeToRight(s, THREADS).open, ["a"]);
  assert.equal(close(s, ["a"]).closed.length, 0);
});

test("reopening never lands a tab among the pinned", () => {
  let s = state({ open: ["a", "b"] });
  s = close(s, ["a"]); // remembered at index 0
  s = pin(s, "b");
  assert.deepEqual(reopen(s, () => true).state.open, ["b", "a"]);
});

test("moving keeps a tab inside its group", () => {
  const s = pin(state({ open: ["a", "b", "c", "d"] }), "a");
  assert.deepEqual(move(s, "d", 0).open, ["a", "d", "b", "c"]);
  assert.deepEqual(move(s, "a", 3).open, ["a", "b", "c", "d"]);
  const two = pin(s, "b");
  assert.deepEqual(move(two, "b", 0).open, ["b", "a", "c", "d"]);
});

test("parseState keeps pinned tabs that are open, and puts them first", () => {
  const parsed = parseState({ open: ["a", "b", "c"], pinned: ["c", "zzz", 4] });
  assert.deepEqual(parsed.open, ["c", "a", "b"]);
  assert.deepEqual(parsed.pinned, ["c"]);
});

test("moveBefore places a tab in front of another in its group, or at the group's end", () => {
  const s = pin(state({ open: ["p", "a", "b", "c"] }), "p");
  assert.deepEqual(moveBefore(s, "c", "a").open, ["p", "c", "a", "b"]);
  assert.deepEqual(moveBefore(s, "a", null).open, ["p", "b", "c", "a"]);
  // A pinned tab is not a valid target for an ordinary one: end of its group.
  assert.deepEqual(moveBefore(s, "c", "p").open, ["p", "a", "b", "c"]);
  assert.equal(moveBefore(s, "b", "c"), s);
  const two = pin(s, "a");
  assert.deepEqual(moveBefore(two, "a", "p").open, ["a", "p", "b", "c"]);
  assert.deepEqual(moveBefore(two, "p", null).open, ["a", "p", "b", "c"]);
});

test("Settings opens the sidebar its sections live in, until told otherwise", () => {
  assert.equal(step("a", SETTINGS, false).action, "expand");
  assert.equal(step(undefined, SETTINGS, true).action, null);
  // Collapsed there by hand, it stays collapsed there.
  assert.equal(step("a", SETTINGS, true, { [SETTINGS]: false }).action, "collapse");
});

test("leaving Settings gives the next tab back its own sidebar", () => {
  assert.deepEqual(step(SETTINGS, "a", true), { action: "collapse", sidebar: { [SETTINGS]: true } });
  assert.equal(step(SETTINGS, THREADS, true, { [THREADS]: false }).action, "collapse");
  assert.equal(step(SETTINGS, THREADS, true, { [THREADS]: true }).action, null);
});

test("leaving Settings by bb's own way out closes its tab; a tab switch does not", () => {
  assert.equal(leavesSettings(SETTINGS, THREADS, false), true);
  assert.equal(leavesSettings(SETTINGS, "gh/gh", false), true);
  assert.equal(leavesSettings(SETTINGS, null, false), true);
  assert.equal(leavesSettings(SETTINGS, THREADS, true), false);
  assert.equal(leavesSettings(SETTINGS, SETTINGS, false), false);
  assert.equal(leavesSettings(THREADS, "gh/gh", false), false);
  assert.equal(leavesSettings(undefined, THREADS, false), false);
});

const thread = (id: string, patch: Partial<ThreadFacts> = {}): ThreadFacts => ({
  id,
  status: "idle",
  indicator: "none",
  hasPendingInteraction: false,
  isArchived: false,
  isHidden: false,
  updatedAt: 0,
  latestAttentionAt: null,
  ...patch,
});

test("a thread's group is what it wants from you, most urgent first", () => {
  assert.equal(threadGroup(thread("a", { hasPendingInteraction: true, status: "active" })), "needs-you");
  assert.equal(threadGroup(thread("a", { indicator: "waiting-for-input" })), "needs-you");
  assert.equal(threadGroup(thread("a", { status: "active" })), "running");
  assert.equal(threadGroup(thread("a", { status: "starting" })), "running");
  assert.equal(threadGroup(thread("a", { indicator: "unread-success" })), "finished");
  assert.equal(threadGroup(thread("a", { indicator: "unread-error" })), "finished");
  assert.equal(threadGroup(thread("a")), null);
  assert.equal(threadGroup(thread("a", { status: "active", isArchived: true })), null);
  assert.equal(threadGroup(thread("a", { status: "active", isHidden: true })), null);
});

test("sections list the most recently stirred thread first", () => {
  const groups = groupThreads(
    [
      thread("old", { status: "active", updatedAt: 1 }),
      thread("new", { status: "active", updatedAt: 5 }),
      thread("loud", { status: "active", updatedAt: 2, latestAttentionAt: 9 }),
    ],
    [],
  );
  assert.deepEqual(groups.running.map((t) => t.id), ["loud", "new", "old"]);
});

test("recent keeps visit order, skips what is listed above, and is capped", () => {
  const threads = ["a", "b", "c", "d", "e", "f", "g"].map((id) => thread(id));
  threads[1] = thread("b", { status: "active" });
  threads[2] = thread("c", { isArchived: true });
  const groups = groupThreads(threads, ["g", "b", "c", "zzz", "a", "d", "e", "f"], 4);
  assert.deepEqual(groups.recent.map((t) => t.id), ["g", "a", "d", "e"]);
  assert.deepEqual(groups.running.map((t) => t.id), ["b"]);
});

test("recent threads move to the front and are capped", () => {
  let s = EMPTY_STATE;
  for (const id of ["a", "b", "a"]) s = recordRecentThread(s, id);
  assert.deepEqual(s.recentThreads, ["a", "b"]);
  assert.equal(recordRecentThread(s, "a"), s);
  for (let i = 0; i < 20; i++) s = recordRecentThread(s, `t${i}`);
  assert.equal(s.recentThreads.length, 8);
});

test("ago is brief", () => {
  const now = 10 * 24 * 3_600_000;
  assert.equal(ago(now - 10_000, now), "now");
  assert.equal(ago(now - 5 * 60_000, now), "5m");
  assert.equal(ago(now - 3 * 3_600_000, now), "3h");
  assert.equal(ago(now - 2 * 24 * 3_600_000, now), "2d");
  assert.equal(ago(now + 60_000, now), "now");
});

test("a Threads-only sidebar from before carries over", () => {
  assert.deepEqual(parseState({ threadsSidebarOpen: true }).sidebar, { [THREADS]: true });
  assert.deepEqual(parseState({ threadsSidebarOpen: "yes" }).sidebar, {});
  // The per-tab record wins over the old field.
  assert.deepEqual(
    parseState({ threadsSidebarOpen: true, sidebar: { [THREADS]: false } }).sidebar,
    { [THREADS]: false },
  );
});
